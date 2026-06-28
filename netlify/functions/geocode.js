'use strict';
const fetch = require('node-fetch');

const JUSO_KEY  = process.env.JUSO_CONFM_KEY;
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
const NAVER_ID  = process.env.NAVER_CLIENT_ID;
const NAVER_SEC = process.env.NAVER_CLIENT_SECRET;

exports.handler = async (event) => {
  const { address } = event.queryStringParameters || {};
  if (!address) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: null, error: 'address 파라미터 필요' }),
    };
  }

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // ── 1순위: 행정안전부 도로명주소 API (2단계) ──────
  // Step 1: addrLinkApi.do → admCd, rnMgtSn 등 코드 획득
  // Step 2: addrCoordApi.do → entX(경도), entY(위도) 획득
  if (JUSO_KEY) {
    try {
      const searchUrl = 'https://business.juso.go.kr/addrlink/addrLinkApi.do?' +
        new URLSearchParams({
          confmKey: JUSO_KEY,
          keyword: address,
          resultType: 'json',
          countPerPage: '1',
          currentPage: '1',
        });
      const searchRes  = await fetch(searchUrl);
      const searchData = await searchRes.json();
      const juso = searchData?.results?.juso;

      if (juso && juso.length > 0) {
        const j = juso[0];

        // ① 좌표 API 시도 (별도 승인 필요 - 실패해도 ② 로 진행)
        try {
          const coordUrl = 'https://business.juso.go.kr/addrlink/addrCoordApi.do?' +
            new URLSearchParams({
              confmKey: JUSO_KEY,
              admCd:    j.admCd,
              rnMgtSn:  j.rnMgtSn,
              udrtYn:   j.udrtYn,
              buldMnnm: String(j.buldMnnm).padStart(4, '0'),
              buldSlno: String(j.buldSlno).padStart(4, '0'),
              resultType: 'json',
            });
          const coordRes  = await fetch(coordUrl);
          const coordData = await coordRes.json();
          const coord = coordData?.results?.juso;
          if (coord && coord.length > 0 && coord[0].entX && coord[0].entY) {
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                result: { lat: parseFloat(coord[0].entY), lon: parseFloat(coord[0].entX) },
                source: 'juso',
              }),
            };
          }
        } catch (_) {}

        // ② Nominatim으로 학교 이름 직접 검색 (OSM POI - 가장 정확한 폴백)
        if (j.bdNm) {
          try {
            const nameQuery = j.bdNm + ' ' + j.siNm;
            const nomNameRes = await fetch(
              'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(nameQuery) +
              '&format=json&limit=1&countrycodes=kr',
              { headers: { 'Accept-Language': 'ko', 'User-Agent': 'DGESchoolApp/1.0' } },
            );
            const nomNameData = await nomNameRes.json();
            if (nomNameData.length > 0) {
              return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                  result: { lat: parseFloat(nomNameData[0].lat), lon: parseFloat(nomNameData[0].lon) },
                  source: 'nominatim-name',
                }),
              };
            }
          } catch (_) {}
        }

        // ③ 카카오 주소 검색 (Kakao)
        if (KAKAO_KEY) {
          try {
            const kakaoRes  = await fetch(
              'https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(address),
              { headers: {
                  Authorization: 'KakaoAK ' + KAKAO_KEY,
                  KA: 'sdk/2.0 os/nodejs',
              } },
            );
            const kakaoData = await kakaoRes.json();
            const doc = kakaoData?.documents?.[0];
            if (doc) {
              return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ result: { lat: parseFloat(doc.y), lon: parseFloat(doc.x) }, source: 'kakao' }),
              };
            }
          } catch (_) {}
        }

        // ④ 지번 주소로 Nominatim (최후 폴백)
        const jibunBase = (j.jibunAddr || '').replace(/\s+\S+학교\s*$/, '').trim();
        if (jibunBase) {
          try {
            const nomUrl = 'https://nominatim.openstreetmap.org/search?q=' +
              encodeURIComponent(jibunBase) +
              '&format=json&limit=1&countrycodes=kr';
            const nomRes  = await fetch(nomUrl, {
              headers: { 'Accept-Language': 'ko', 'User-Agent': 'DGESchoolApp/1.0' },
            });
            const nomData = await nomRes.json();
            if (nomData.length > 0) {
              return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                  result: { lat: parseFloat(nomData[0].lat), lon: parseFloat(nomData[0].lon) },
                  source: 'juso-nominatim',
                }),
              };
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // ── 3순위: 네이버 지오코딩 API ────────────────
  if (NAVER_ID && NAVER_SEC) {
    try {
      const res  = await fetch(
        'https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=' + encodeURIComponent(address),
        { headers: { 'X-NCP-APIGW-API-KEY-ID': NAVER_ID, 'X-NCP-APIGW-API-KEY': NAVER_SEC } },
      );
      const data = await res.json();
      const addr = data?.addresses?.[0];
      if (addr) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ result: { lat: parseFloat(addr.y), lon: parseFloat(addr.x) }, source: 'naver' }),
        };
      }
    } catch (_) {}
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ result: null, error: '지오코딩 API 키 미설정 또는 주소 조회 실패' }),
  };
};
