'use strict';
const fetch = require('node-fetch');

const NEIS_KEY = process.env.NEIS_API_KEY || '39c4ee821e8e4134b89a7ea8d0115de5';
const NEIS_BASE = 'https://open.neis.go.kr/hub';

// Average students per class by school type (Korean national average)
const AVG_CLASS_SIZE = {
  '초등학교': 21,
  '중학교': 26,
  '고등학교': 25,
  '특수학교': 6,
};

exports.handler = async (event) => {
  const { edu, code, schoolType } = event.queryStringParameters || {};
  if (!edu || !code) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'edu, code 필요' }),
    };
  }

  // Get current year first, fallback to previous year if no data
  const thisYear = new Date().getFullYear().toString();
  const prevYear = (new Date().getFullYear() - 1).toString();

  async function fetchClassInfo(ay) {
    const params = new URLSearchParams({
      KEY: NEIS_KEY,
      Type: 'json',
      pIndex: '1',
      pSize: '1000',
      ATPT_OFCDC_SC_CODE: edu,
      SD_SCHUL_CODE: code,
      AY: ay,
    });
    const res = await fetch(`${NEIS_BASE}/classInfo?${params}`);
    const data = await res.json();
    if (data.RESULT) return null;
    const rows = data.classInfo?.[1]?.row;
    if (!rows) return null;
    return Array.isArray(rows) ? rows : [rows];
  }

  let rows = null;
  let usedYear = null;

  try {
    rows = await fetchClassInfo(thisYear);
    if (rows && rows.length > 0) {
      usedYear = thisYear;
    } else {
      rows = await fetchClassInfo(prevYear);
      if (rows && rows.length > 0) usedYear = prevYear;
    }
  } catch (_) {}

  if (!rows || rows.length === 0) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ classes: null, students: null, year: null }),
    };
  }

  const totalClasses = rows.length;

  // Estimate student count from class count × average class size
  const typeKey = Object.keys(AVG_CLASS_SIZE).find((k) =>
    (schoolType || '').includes(k.replace('학교', ''))
  );
  const avgSize = AVG_CLASS_SIZE[typeKey] ?? AVG_CLASS_SIZE['중학교'];
  const estimatedStudents = totalClasses * avgSize;

  // Grade breakdown
  const gradeMap = {};
  for (const r of rows) {
    gradeMap[r.GRADE] = (gradeMap[r.GRADE] || 0) + 1;
  }
  const gradeBreakdown = Object.entries(gradeMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([g, n]) => `${g}학년 ${n}반`)
    .join(', ');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      classes: totalClasses,
      gradeBreakdown,
      students: estimatedStudents,
      year: usedYear,
    }),
  };
};
