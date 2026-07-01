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

    // ── Step 1: NEIS 도로명주소로 대략 위치 확보 ──────────────────
    let addrLat = null, addrLon = null;
    try {
      const addrRes = await fetch(
        'https://dapi.kakao.com/v2/local/search/address.json?' +
        new URLSearchParams({ query: searchAddr }),
        { headers: kakaoHeaders },
      );
      const addrData = await addrRes.json();
      const doc = (addrData.documents || [])[0];
      // REGION 타입(행정구역 중심점)은 너무 넓어서 제외
      if (doc && doc.address_type !== 'REGION') {
        addrLat = parseFloat(doc.y);
        addrLon = parseFloat(doc.x);
      }
    } catch (_) {}

    // ── Step 2: 주소 근처 500m 안에서 학교 POI 키워드 검색 ─────────
    // → 주소로 위치를 확정한 뒤 반경을 제한하므로 타 도시 오매칭 불가
    if (addrLat !== null) {
      try {
        const kwRes = await fetch(
          'https://dapi.kakao.com/v2/local/search/keyword.json?' +
          new URLSearchParams({
            query: searchName,
            size: '3',
            category_group_code: 'SC4',
            x: String(addrLon),
            y: String(addrLat),
            radius: '500',
          }),
          { headers: kakaoHeaders },
        );
        const kwData = await kwRes.json();
        const kwDoc = (kwData.documents || [])[0];
        if (kwDoc) {
          // 주소 반경 500m 내 학교 POI → 건물 입구 좌표로 가장 정확
          return res.status(200).json({
            result: { lat: parseFloat(kwDoc.y), lon: parseFloat(kwDoc.x) },
            source: 'kakao-keyword-near-addr',
          });
        }
      } catch (_) {}

      // POI 없으면 주소 좌표 그대로 사용
      return res.status(200).json({
        result: { lat: addrLat, lon: addrLon },
        source: 'kakao-address',
      });
    }

    // ── Step 3: 주소 검색 실패 시 키워드만 단독 시도 (마지막 수단) ──
    try {
      const kwRes = await fetch(
        'https://dapi.kakao.com/v2/local/search/keyword.json?' +
        new URLSearchParams({ query: searchName, size: '1', category_group_code: 'SC4' }),
        { headers: kakaoHeaders },
      );
      const kwData = await kwRes.json();
      const kwDoc = (kwData.documents || [])[0];
      if (kwDoc) {
        return res.status(200).json({
          result: { lat: parseFloat(kwDoc.y), lon: parseFloat(kwDoc.x) },
          source: 'kakao-keyword-only',
        });
      }
    } catch (_) {}
  }

  // ── 4순위: 행정안전부 도로명주소 API ──────────────
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

  // ── 5순위: 네이버 지오코딩 ────────────────────────
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
