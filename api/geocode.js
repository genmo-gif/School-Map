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

  // ── 최종 폴백: 서버사이드 Nominatim + 도시 viewbox ──────
  try {
    const PFXS = ['서울','부산','대구','인천','광주','대전','울산','세종',
                  '경기','강원','충북','충남','전북','전남','경북','경남','제주'];
    const shortName = PFXS.reduce((n,p) => n.startsWith(p) ? n.slice(p.length) : n, searchName);

    // 광역시/도별 bounding box (lon_min,lat_max,lon_max,lat_min)
    const VIEWBOXES = {
      '서울특별시':'126.7,37.7,127.3,37.4','부산광역시':'128.7,35.4,129.3,34.9',
      '대구광역시':'128.3,36.2,129.0,35.6','인천광역시':'126.4,37.8,126.9,37.2',
      '광주광역시':'126.7,35.3,127.0,34.9','대전광역시':'127.2,36.5,127.6,36.2',
      '울산광역시':'129.0,35.7,129.5,35.3','세종특별자치시':'127.2,36.6,127.5,36.4',
      '경기도':'126.7,38.0,127.9,36.9','강원도':'127.5,38.7,129.4,37.0',
      '충청북도':'127.3,37.2,128.5,36.2','충청남도':'126.3,37.0,127.5,36.0',
      '전라북도':'126.4,35.9,127.9,35.3','전라남도':'125.9,35.0,127.5,34.2',
      '경상북도':'128.3,37.2,129.6,35.9','경상남도':'127.6,35.7,129.3,34.7',
      '제주특별자치도':'126.1,33.6,126.9,33.1',
    };
    const cityKey = Object.keys(VIEWBOXES).find(k => searchAddr.startsWith(k)) || '';
    const viewboxParams = cityKey ? { viewbox: VIEWBOXES[cityKey], bounded: '1' } : {};

    async function nominatimSearch(params) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const r = await fetch(
          'https://nominatim.openstreetmap.org/search?' + new URLSearchParams(params),
          { headers: { 'User-Agent': 'DGESchoolApp/1.0', 'Accept-Language': 'ko' }, signal: ctrl.signal },
        );
        return await r.json();
      } finally { clearTimeout(timer); }
    }

    // 1순위: 학교명 그대로 검색 (OSM에 "대구대산초등학교"처럼 시/도 접두어가
    // 포함된 채로 등록된 경우 대응 — 접두어를 떼면 오히려 매칭이 안 됨)
    let nomData = await nominatimSearch({ q: searchName, format: 'json', limit: '1', countrycodes: 'kr', ...viewboxParams });

    // 2순위: 시/도 접두어를 뗀 이름으로 검색 (OSM에 접두어 없이 등록된 일반적인 경우)
    if (!nomData.length && shortName !== searchName) {
      nomData = await nominatimSearch({ q: shortName, format: 'json', limit: '1', countrycodes: 'kr', ...viewboxParams });
    }

    // 3순위: amenity=school(유치원은 kindergarten) 구조화 검색으로 주변 학교 목록을 받아
    // 이름이 일치하는 항목을 직접 매칭 (인근 학교 검색과 동일한 방식 — 가장 신뢰도 높음)
    if (!nomData.length && cityKey) {
      const amenity = searchName.includes('유치원') ? 'kindergarten' : 'school';
      const amenityResults = await nominatimSearch({
        amenity, format: 'json', limit: '50', countrycodes: 'kr', ...viewboxParams,
      });
      const match = amenityResults.find((item) => {
        const poiName = (item.display_name || '').split(',')[0].trim();
        return poiName === searchName || poiName === shortName
          || poiName.includes(shortName) || shortName.includes(poiName);
      });
      if (match) nomData = [match];
    }

    if (nomData.length > 0) {
      return res.status(200).json({
        result: { lat: parseFloat(nomData[0].lat), lon: parseFloat(nomData[0].lon) },
        source: 'nominatim',
      });
    }
  } catch (_) {}

  res.status(200).json({ result: null, error: 'API 키 미설정 또는 주소 조회 실패' });
};
