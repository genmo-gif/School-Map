'use strict';

const JUSO_KEY  = process.env.JUSO_CONFM_KEY;
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
const NAVER_ID  = process.env.NAVER_CLIENT_ID;
const NAVER_SEC = process.env.NAVER_CLIENT_SECRET;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

module.exports = async (req, res) => {
  const { address, name } = req.query;
  if (!address && !name) {
    return res.status(400).json({ result: null, error: 'address 파라미터 필요' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const searchAddr = address || name;
  const searchName = name || address;

  if (KAKAO_KEY) {
    const kakaoHeaders = { Authorization: 'KakaoAK ' + KAKAO_KEY };

    // Kakao 키워드 검색과 주소 검색을 동시에 실행해 교차검증
    let kwDoc = null;
    let addrDoc = null;

    await Promise.all([
      // 키워드 검색: SC4(학교) 카테고리, 후보 5개
      fetch(
        'https://dapi.kakao.com/v2/local/search/keyword.json?' +
        new URLSearchParams({ query: searchName, size: '5', category_group_code: 'SC4' }),
        { headers: kakaoHeaders },
      ).then(r => r.json()).then(d => { kwDoc = (d.documents || [])[0] || null; }).catch(() => {}),

      // 주소 검색: NEIS 도로명주소
      fetch(
        'https://dapi.kakao.com/v2/local/search/address.json?' +
        new URLSearchParams({ query: searchAddr }),
        { headers: kakaoHeaders },
      ).then(r => r.json()).then(d => {
        const doc = (d.documents || [])[0];
        // REGION 타입(행정구역 중심점)은 정확도 낮아 제외
        addrDoc = (doc && doc.address_type !== 'REGION') ? doc : null;
      }).catch(() => {}),
    ]);

    if (kwDoc && addrDoc) {
      // 두 결과가 모두 있으면 거리 교차검증
      const kwLat = parseFloat(kwDoc.y), kwLon = parseFloat(kwDoc.x);
      const adLat = parseFloat(addrDoc.y), adLon = parseFloat(addrDoc.x);
      const gap = haversine(kwLat, kwLon, adLat, adLon);

      if (gap <= 2000) {
        // 2km 이내 → 키워드(학교 POI) 우선 (건물 입구 좌표로 더 정확)
        return res.status(200).json({ result: { lat: kwLat, lon: kwLon }, source: 'kakao-keyword-verified' });
      } else {
        // 2km 초과 → 키워드가 다른 도시를 가리킴 → NEIS 주소 사용
        return res.status(200).json({ result: { lat: adLat, lon: adLon }, source: 'kakao-address-verified' });
      }
    }

    if (kwDoc) {
      return res.status(200).json({
        result: { lat: parseFloat(kwDoc.y), lon: parseFloat(kwDoc.x) },
        source: 'kakao-keyword',
      });
    }

    if (addrDoc) {
      return res.status(200).json({
        result: { lat: parseFloat(addrDoc.y), lon: parseFloat(addrDoc.x) },
        source: 'kakao-address',
      });
    }
  }

  // ── 3순위: 행정안전부 도로명주소 API ──────────────
  if (JUSO_KEY) {
    try {
      const searchRes = await fetch(
        'https://business.juso.go.kr/addrlink/addrLinkApi.do?' +
        new URLSearchParams({
          confmKey: JUSO_KEY,
          keyword: searchAddr,
          resultType: 'json',
          countPerPage: '1',
          currentPage: '1',
        }),
      );
      const searchData = await searchRes.json();
      const juso = searchData?.results?.juso;

      if (juso && juso.length > 0) {
        const j = juso[0];
        try {
          const coordRes = await fetch(
            'https://business.juso.go.kr/addrlink/addrCoordApi.do?' +
            new URLSearchParams({
              confmKey: JUSO_KEY,
              admCd:    j.admCd,
              rnMgtSn:  j.rnMgtSn,
              udrtYn:   j.udrtYn,
              buldMnnm: String(j.buldMnnm).padStart(4, '0'),
              buldSlno: String(j.buldSlno).padStart(4, '0'),
              resultType: 'json',
            }),
          );
          const coordData = await coordRes.json();
          const coord = coordData?.results?.juso;
          if (coord && coord.length > 0 && coord[0].entX && coord[0].entY) {
            return res.status(200).json({
              result: { lat: parseFloat(coord[0].entY), lon: parseFloat(coord[0].entX) },
              source: 'juso',
            });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // ── 4순위: 네이버 지오코딩 ────────────────────────
  if (NAVER_ID && NAVER_SEC) {
    try {
      const r = await fetch(
        'https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=' + encodeURIComponent(searchAddr),
        { headers: { 'X-NCP-APIGW-API-KEY-ID': NAVER_ID, 'X-NCP-APIGW-API-KEY': NAVER_SEC } },
      );
      const data = await r.json();
      const addr = data?.addresses?.[0];
      if (addr) {
        return res.status(200).json({
          result: { lat: parseFloat(addr.y), lon: parseFloat(addr.x) },
          source: 'naver',
        });
      }
    } catch (_) {}
  }

  res.status(200).json({ result: null, error: 'API 키 미설정 또는 주소 조회 실패' });
};
