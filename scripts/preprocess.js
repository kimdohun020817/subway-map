import fs from "fs";
import path from "path";
import Papa from "papaparse";
import iconv from "iconv-lite";

const INPUT_CONGESTION = path.resolve("data", "하철혼잡도 정dd보.csv");
const INPUT_COORDS = path.resolve(
  "data",
  "서울교통공사_1_8호선 역사 좌표(위경도) 정보_20250814.csv"
);

const OUTPUT_JSON = path.resolve("public", "data", "merged.json");

function normStationName(name) {
  if (!name) return "";
  const s = String(name).trim().replace(/\s+/g, "");
  return s.endsWith("역") ? s.slice(0, -1) : s;
}

function parseCsv(text) {
  const res = Papa.parse(text, { header: true, skipEmptyLines: true });
  return res.data;
}

function mean(nums) {
  const v = nums.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function main() {
  // 1) 좌표 CSV: 보통 EUC-KR
  const coordsBuf = fs.readFileSync(INPUT_COORDS);
  const coordsText = iconv.decode(coordsBuf, "euc-kr");
  const coordsRows = parseCsv(coordsText)
    .map((r) => ({
      line: Number(r["호선"]),
      name: String(r["역명"] ?? "").trim(),
      nameNorm: normStationName(r["역명"]),
      lat: Number(r["위도"]),
      lon: Number(r["경도"]),
    }))
    .filter((r) => Number.isFinite(r.line) && Number.isFinite(r.lat) && Number.isFinite(r.lon) && r.nameNorm);

  const coordMap = new Map();
  for (const r of coordsRows) {
    coordMap.set(`${r.line}-${r.nameNorm}`, { lat: r.lat, lon: r.lon, name: r.name });
  }

  // 2) 혼잡도 CSV: UTF-8
  const congestionText = fs.readFileSync(INPUT_CONGESTION, "utf-8");
  const conRows = parseCsv(congestionText);

  // 시간대 컬럼 찾기 (예: "7:30~ (%)")
  const sample = conRows[0] || {};
  const timeCols = Object.keys(sample).filter((k) => /^\d{1,2}:\d{2}~ \(%\)$/.test(k));

  if (!timeCols.length) {
    console.log("❌ 시간대 컬럼을 자동으로 못 찾았어.");
    console.log("컬럼명을 확인해줘. 예: 7:30~ (%) 형태여야 함");
    console.log("현재 컬럼 예시:", Object.keys(sample).slice(0, 30));
    process.exit(1);
  }

  // group: 호선-역번호-역명
  const group = new Map();

  for (const r of conRows) {
    const line = Number(r["호선"]);
    const stationNo = String(r["역번호"] ?? "").trim();
    const stationName = String(r["역명"] ?? "").trim();
    const stationNameNorm = normStationName(stationName);

    if (!Number.isFinite(line) || !stationNo || !stationNameNorm) continue;

    const key = `${line}-${stationNo}-${stationNameNorm}`;
    if (!group.has(key)) {
      group.set(key, {
        line,
        stationNo,
        stationName,
        stationNameNorm,
        values: Object.fromEntries(timeCols.map((c) => [c, []])),
      });
    }

    const g = group.get(key);
    for (const c of timeCols) {
      const v = Number(r[c]);
      if (Number.isFinite(v)) g.values[c].push(v);
    }
  }

  const stations = [];
  let missing = 0;

  for (const [, g] of group) {
    const coord = coordMap.get(`${g.line}-${g.stationNameNorm}`);
    if (!coord) {
      missing++;
      continue;
    }

    const avgByTime = {};
    for (const c of timeCols) {
      const m = mean(g.values[c]);
      if (m !== null) avgByTime[c] = Number(m.toFixed(2));
    }

    stations.push({
      id: `${g.line}-${g.stationNo}`,
      line: g.line,
      stationNo: g.stationNo,
      name: g.stationName,
      nameNorm: g.stationNameNorm,
      lat: coord.lat,
      lon: coord.lon,
      congestion: avgByTime,
    });
  }

  stations.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name, "ko"));

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ timeCols, stations }, null, 2), "utf-8");

  console.log(`✅ merged.json 생성 완료: ${OUTPUT_JSON}`);
  console.log(`- timeCols: ${timeCols.length}개`);
  console.log(`- stations(좌표 매칭 성공): ${stations.length}개`);
  console.log(`- stations(좌표 매칭 실패): ${missing}개`);
}

main();
