'use strict';

const JUSO_KEY  = process.env.JUSO_CONFM_KEY;
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
const NAVER_ID  = process.env.NAVER_CLIENT_ID;
const NAVER_SEC = process.env.NAVER_CLIENT_SECRET;

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

    // ── 1순위: 카카오 주소 검색 (NEIS 공식 도로명 주소 → 정확도 높음) ──
    try {
      const addrRes = await fetch(
        'https://dapi.kakao.com/v2/local/search/address.json?' +
        new URLSearchParams({ query: searchAddr }),
        { headers: kakaoHeaders },
      );
      const addrData = await addrRes.json();
      const doc = addrData?.documents?.[0];
      if (doc) {
        return res.status(200).json({
          result: { lat: parseFloat(doc.y), lon: parseFloat(doc.x) },
          source: 'kakao-address',
        });
      }
    } catch (_) {}

    // ── 2순위: 카카오 키워드 검색 (학교 POI, 주소 검색 실패 시 폴백) ──
    try {
      const kwRes = await fetch(
        'https://dapi.kakao.com/v2/local/search/keyword.json?' +
        new URLSearchParams({ query: searchName, size: '1', category_group_code: 'SC4' }),
        { headers: kakaoHeaders },
      );
      const kwData = await kwRes.json();
      const doc = kwData?.documents?.[0];
      if (doc) {
        return res.status(200).json({
          result: { lat: parseFloat(doc.y), lon: parseFloat(doc.x) },
          source: 'kakao-keyword',
        });
      }
    } catch (_) {}
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
