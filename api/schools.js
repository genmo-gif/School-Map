'use strict';

const NEIS_KEY = process.env.NEIS_API_KEY || '39c4ee821e8e4134b89a7ea8d0115de5';
const NEIS_BASE = 'https://open.neis.go.kr/hub';

module.exports = async (req, res) => {
  const { edu, name } = req.query;

  const params = new URLSearchParams({
    KEY: NEIS_KEY,
    Type: 'json',
    pIndex: '1',
    pSize: '100',
    SCHUL_NM: name || '',
  });
  if (edu) params.set('ATPT_OFCDC_SC_CODE', edu);

  try {
    const r = await fetch(`${NEIS_BASE}/schoolInfo?${params}`);
    const data = await r.json();

    const rows = data.schoolInfo?.[1]?.row ?? [];

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ schools: rows });
  } catch (err) {
    res.status(500).json({ error: err.message, schools: [] });
  }
};
