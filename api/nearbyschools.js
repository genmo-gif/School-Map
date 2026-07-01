'use strict';

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const TYPE_KEYWORDS = {
  '초등학교': '초등',
  '중학교':   '중학',
  '고등학교': '고등',
  '유치원':   '유치',
  '특수학교': '특수',
};

module.exports = async (req, res) => {
  const { lat, lon, radius = '2000', schoolType = '' } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat, lon 필요', schools: [] });
  }

  const r = parseInt(radius, 10) || 2000;

  const isKindergarten = schoolType.includes('유치');
  const amenity = isKindergarten ? 'kindergarten' : 'school';

  const query = [
    '[out:json][timeout:20];',
    '(',
    `  node["amenity"="${amenity}"](around:${r},${lat},${lon});`,
    `  way["amenity"="${amenity}"](around:${r},${lat},${lon});`,
    `  relation["amenity"="${amenity}"](around:${r},${lat},${lon});`,
    ');',
    'out center;',
  ].join('\n');

  const filterKeyword = Object.entries(TYPE_KEYWORDS).find(([k]) =>
    schoolType.includes(k)
  )?.[1] ?? null;

  const OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  let data = null;
  for (const endpoint of OVERPASS_MIRRORS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!resp.ok) continue;
      data = await resp.json();
      break;
    } catch (_) {}
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    if (!data) throw new Error('all mirrors failed');

    const seenNames = new Set();
    const schools = (data.elements || [])
      .map((el) => {
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        if (!elLat || !elLon) return null;
        const name = el.tags?.['name:ko'] || el.tags?.name || '';
        if (!name) return null;
        if (filterKeyword && !name.includes(filterKeyword)) return null;
        return {
          name,
          lat: elLat,
          lon: elLon,
          distance: haversine(parseFloat(lat), parseFloat(lon), elLat, elLon),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)
      .filter((s) => {
        if (seenNames.has(s.name)) return false;
        seenNames.add(s.name);
        return true;
      });

    res.status(200).json({ schools });
  } catch (err) {
    res.status(500).json({ error: err.message, schools: [] });
  }
};
