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

  // ── 2: Overpass 철도역 (subway 아닌 railway=station) ──
  const overpassQuery = [
    '[out:json][timeout:8];',
    '(',
    `  node["railway"="station"]["station"!="subway"](around:${r},${lat},${lon});`,
    `  node["railway"="halt"](around:${r},${lat},${lon});`,
    ');',
    'out body;',
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
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const data = await resp.json();
      const seen = new Set(subwayStations.map(s => s.name));
      (data.elements || []).forEach(el => {
        const tags = el.tags || {};
        const name = tags['name:ko'] || tags.name || '';
        if (!name || seen.has(name)) return;
        seen.add(name);
        railwayStations.push({
          name,
          lat: el.lat,
          lon: el.lon,
          type: 'railway',
          distance: haversine(parseFloat(lat), parseFloat(lon), el.lat, el.lon),
        });
      });
      break;
    } catch (_) {}
  }

  const stations = [...subwayStations, ...railwayStations]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10);

  res.status(200).json({ stations });
};
