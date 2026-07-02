'use strict';
const fetch = require('node-fetch');

const NEIS_KEY = process.env.NEIS_API_KEY || '39c4ee821e8e4134b89a7ea8d0115de5';
const NEIS_BASE = 'https://open.neis.go.kr/hub';

exports.handler = async (event) => {
  const { edu, name } = event.queryStringParameters || {};

  const params = new URLSearchParams({
    KEY: NEIS_KEY,
    Type: 'json',
    pIndex: '1',
    pSize: '100',
    SCHUL_NM: name || '',
  });
  if (edu) params.set('ATPT_OFCDC_SC_CODE', edu);

  try {
    const res = await fetch(`${NEIS_BASE}/schoolInfo?${params}`);
    const data = await res.json();

    // NEIS API returns { RESULT: { CODE, MESSAGE } } when no data / error
    const rows = data.schoolInfo?.[1]?.row;
    const normalizedRows = rows ? (Array.isArray(rows) ? rows : [rows]) : [];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ schools: rows }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, schools: [] }),
    };
  }
};
