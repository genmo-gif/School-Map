'use strict';

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

module.exports = async (req, res) => {
  const { lat, lon, radius = '3000' } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat, lon 파라미터 필요', stations: [] });
  }

  const r = Math.min(parseInt(radius, 10) || 3000, 5000);
  res.setHeader('Access-Control-Allow-Origin', '*');

  const subwayStations = [];
  const railwayStations = [];

  // ── 1: Kakao SW8(지하철역) 카테고리 검색 ──────────
  if (KAKAO_KEY) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const kakaoRes = await fetch(
        'https://dapi.kakao.com/v2/local/search/category.json?' +
        new URLSearchParams({ category_group_code: 'SW8', x: lon, y: lat, radius: String(r), size: '15' }),
        { headers: { Authorization: 'KakaoAK ' + KAKAO_KEY }, signal: ctrl.signal },
      );
      clearTimeout(timer);
      if (kakaoRes.ok) {
        const kakaoData = await kakaoRes.json();
        const seen = new Set();
        (kakaoData.documents || []).forEach(doc => {
          const name = doc.place_name || '';
          if (!name || seen.has(name)) return;
          seen.add(name);
          const sLat = parseFloat(doc.y), sLon = parseFloat(doc.x);
          subwayStations.push({
            name,
            lat: sLat,
            lon: sLon,
            type: 'subway',
            distance: haversine(parseFloat(lat), parseFloat(lon), sLat, sLon),
          });
        });
      }
    } catch (_) {}
  }

  // ── 2: Overpass 전체 철도역 (지하철·경전철·모노레일·일반철도 모두 포함, 태그로 분류) ──
  const overpassQuery = [
    '[out:json][timeout:8];',
    '(',
    `  node["railway"="station"](around:${r},${lat},${lon});`,
    `  way["railway"="station"](around:${r},${lat},${lon});`,
    `  node["railway"="halt"](around:${r},${lat},${lon});`,
    `  node["public_transport"="stop_position"]["subway"="yes"](around:${r},${lat},${lon});`,
    ');',
    'out center;',
  ].join('\n');

  const MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const endpoint of MIRRORS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'DGESchoolApp/1.0',
        },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const data = await resp.json();
      const seen = new Set(subwayStations.map(s => s.name));
      (data.elements || []).forEach(el => {
        const tags = el.tags || {};
        const elat = el.lat ?? el.center?.lat;
        const elon = el.lon ?? el.center?.lon;
        const name = tags['name:ko'] || tags.name || '';
        if (!name || elat == null || elon == null || seen.has(name)) return;
        seen.add(name);
        // 지하철·경전철·모노레일(도시철도) = 지하철로, 그 외 일반철도 = 철도로 분류
        const isSubway = ['subway', 'light_rail', 'monorail'].includes(tags.station)
          || tags.subway === 'yes'
          || tags['public_transport'] === 'stop_position';
        (isSubway ? subwayStations : railwayStations).push({
          name,
          lat: elat,
          lon: elon,
          type: isSubway ? 'subway' : 'railway',
          distance: haversine(parseFloat(lat), parseFloat(lon), elat, elon),
        });
      });
      break;
    } catch (_) {}
  }

  // ── 3: Kakao·Overpass 모두 실패 시 Nominatim으로 역 검색 ──
  if (subwayStations.length === 0 && railwayStations.length === 0) {
    try {
      const dlat = r / 111000, dlon = r / (111000 * Math.cos(parseFloat(lat) * Math.PI / 180));
      const vb = `${parseFloat(lon)-dlon},${parseFloat(lat)+dlat},${parseFloat(lon)+dlon},${parseFloat(lat)-dlat}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const nomRes = await fetch(
        'https://nominatim.openstreetmap.org/search?' +
        new URLSearchParams({ q: '역', format: 'json', limit: '20', viewbox: vb, bounded: '1', countrycodes: 'kr' }),
        { headers: { 'User-Agent': 'DGESchoolApp/1.0', 'Accept-Language': 'ko' }, signal: ctrl.signal },
      );
      clearTimeout(timer);
      const nomData = await nomRes.json();
      const seen = new Set();
      nomData.forEach(item => {
        const name = item.name || item.display_name?.split(',')[0] || '';
        if (!name || seen.has(name)) return;
        if (!/역$/.test(name)) return;
        seen.add(name);
        const sLat = parseFloat(item.lat), sLon = parseFloat(item.lon);
        const isSubway = (item.type === 'station' && item.class === 'railway') || name.includes('지하철');
        const dist = haversine(parseFloat(lat), parseFloat(lon), sLat, sLon);
        (isSubway ? subwayStations : railwayStations).push({
          name, lat: sLat, lon: sLon,
          type: isSubway ? 'subway' : 'railway',
          distance: dist,
        });
      });
    } catch (_) {}
  }

  const stations = [...subwayStations, ...railwayStations]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10);

  res.status(200).json({ stations });
};
