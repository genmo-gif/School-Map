'use strict';

const NEIS_KEY = process.env.NEIS_API_KEY || '39c4ee821e8e4134b89a7ea8d0115de5';
const NEIS_BASE = 'https://open.neis.go.kr/hub';

const AVG_CLASS_SIZE = {
  '초등학교': 21,
  '중학교': 26,
  '고등학교': 25,
  '특수학교': 6,
};

module.exports = async (req, res) => {
  const { edu, code, schoolType } = req.query;
  if (!edu || !code) {
    return res.status(400).json({ error: 'edu, code 필요' });
  }

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
    const r = await fetch(`${NEIS_BASE}/classInfo?${params}`);
    const data = await r.json();
    if (data.RESULT) return null;
    return data.classInfo?.[1]?.row ?? null;
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

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!rows || rows.length === 0) {
    return res.status(200).json({ classes: null, students: null, year: null });
  }

  const totalClasses = rows.length;

  const typeKey = Object.keys(AVG_CLASS_SIZE).find((k) =>
    (schoolType || '').includes(k.replace('학교', ''))
  );
  const avgSize = AVG_CLASS_SIZE[typeKey] ?? AVG_CLASS_SIZE['중학교'];
  const estimatedStudents = totalClasses * avgSize;

  const gradeMap = {};
  for (const r of rows) {
    gradeMap[r.GRADE] = (gradeMap[r.GRADE] || 0) + 1;
  }
  const gradeBreakdown = Object.entries(gradeMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([g, n]) => `${g}학년 ${n}반`)
    .join(', ');

  res.status(200).json({ classes: totalClasses, gradeBreakdown, students: estimatedStudents, year: usedYear });
};
