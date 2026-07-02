'use strict';
const fetch = require('node-fetch');

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// OSM 태그에서 호선 정보 추출
function lineLabel(tags) {
  const raw = (tags.line || tags.ref || '').trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw + '호선';
  const m = raw.match(/\d+호선/);
  return m ? m[0] : '';
}

exports.handler = async (event) => {
  const { lat, lon, radius } = event.queryStringParameters || {};
  if (!lat || !lon) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'lat, lon 파라미터가 필요합니다', stations: [] }),
    };
  }

  // 요청한 반경(m)을 존중한다. 지정이 없으면 3km, 최대 5km로 제한.
  const r = Math.min(Math.max(parseInt(radius, 10) || 3000, 100), 5000);

  const query = [
    '[out:json][timeout:15];',
    '(',
    `  node["railway"="station"](around:${r},${lat},${lon});`,
    `  node["railway"="halt"](around:${r},${lat},${lon});`,
    `  way["railway"="station"](around:${r},${lat},${lon});`,
    `  node["public_transport"="stop_position"]["subway"="yes"](around:${r},${lat},${lon});`,
    ');',
    'out center;',
  ].join('\n');

  const OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  let data = null;
  for (const endpoint of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'DGESchoolApp/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) continue;
      data = await res.json();
      break;
    } catch (_) {}
  }

  try {
    if (!data) throw new Error('all mirrors failed');

    const seen = new Set();
    const stations = (data.elements || [])
      .map((el) => {
        const tags = el.tags || {};
        const elat = el.lat ?? el.center?.lat;
        const elon = el.lon ?? el.center?.lon;
        const isSubway = ['subway', 'light_rail', 'monorail'].includes(tags.station)
          || tags.subway === 'yes'
          || tags['public_transport'] === 'stop_position';
        return {
          name: tags['name:ko'] || tags.name || '이름 없음',
          lat: elat,
          lon: elon,
          type: isSubway ? 'subway' : 'railway',
          line: lineLabel(tags),
          distance: haversine(parseFloat(lat), parseFloat(lon), elat, elon),
        };
      })
      .filter((s) => s.lat != null && s.lon != null)
      .filter((s) => {
        if (seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ stations }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, stations: [] }),
    };
  }
};
