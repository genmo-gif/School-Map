'use strict';
const fetch = require('node-fetch');

const NEIS_KEY = process.env.NEIS_API_KEY || '39c4ee821e8e4134b89a7ea8d0115de5';
const NEIS_BASE = 'https://open.neis.go.kr/hub';

async function searchSchools(eduCode, schoolName) {
  const params = new URLSearchParams({
    KEY: NEIS_KEY,
    Type: 'json',
    pIndex: '1',
    pSize: '100',
    SCHUL_NM: schoolName,
    ATPT_OFCDC_SC_CODE: eduCode,
  });

  const res = await fetch(`${NEIS_BASE}/schoolInfo?${params}`);
  const data = await res.json();

  // NEIS returns { RESULT: ... } when no data found
  if (data.RESULT) return [];

  const rows = data.schoolInfo?.[1]?.row ?? [];
  return rows.map((r) => ({
    code: r.SD_SCHUL_CODE,
    name: r.SCHUL_NM,
  }));
}

test('searchSchools("B10", "오금중학교") 결과에 { code: "7130197", name: "오금중학교" } 포함', async () => {
  const results = await searchSchools('B10', '오금중학교');
  expect(results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: '7130197', name: '오금중학교' }),
    ])
  );
}, 15000);
