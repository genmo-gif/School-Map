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
  const { lat, lon } = event.queryStringParameters || {};
  if (!lat || !lon) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'lat, lon 파라미터가 필요합니다', stations: [] }),
    };
  }

  const query = [
    '[out:json][timeout:15];',
    '(',
    `  node["railway"="station"](around:1000,${lat},${lon});`,
    `  node["railway"="halt"](around:1000,${lat},${lon});`,
    `  node["public_transport"="stop_position"]["subway"="yes"](around:1000,${lat},${lon});`,
    ');',
    'out body;',
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
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
        const isSubway = tags.station === 'subway' || tags.subway === 'yes'
          || tags['public_transport'] === 'stop_position';
        return {
          name: tags['name:ko'] || tags.name || '이름 없음',
          lat: el.lat,
          lon: el.lon,
          type: isSubway ? 'subway' : 'railway',
          line: lineLabel(tags),
          distance: haversine(parseFloat(lat), parseFloat(lon), el.lat, el.lon),
        };
      })
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
