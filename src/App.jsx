import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  Polyline,
  Tooltip,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const LINES = ["1호선", "2호선", "3호선", "4호선", "5호선", "6호선", "7호선", "8호선"];

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// 🔥 더 타이트한 4단계 색상 기준
function congestionColor(pct) {
  const p = clamp(pct ?? 0, 0, 100);
  if (p >= 70) return "#e53935"; // 빨강(혼잡)
  if (p >= 50) return "#fb8c00"; // 주황(주의)
  if (p >= 30) return "#fdd835"; // 노랑(적정)
  return "#43a047"; // 초록(원활)
}

export default function App() {
  const [selectedLine, setSelectedLine] = useState("2호선");
  const [merged, setMerged] = useState(null);
  const [lineData, setLineData] = useState(null);
  const [selectedTime, setSelectedTime] = useState("");

  // ✅ 시간 재생 상태
  const [isPlaying, setIsPlaying] = useState(false);
  const playRef = useRef(null);

  // ✅ timeCols는 merged에서 바로 뽑기
  const timeCols = merged?.timeCols || [];

  // ✅ 데이터 로드 (GitHub Pages용 BASE_URL 경로)
  useEffect(() => {
    (async () => {
      const mergedRes = await fetch(import.meta.env.BASE_URL + "data/merged.json");
      const mergedJson = await mergedRes.json();
      setMerged(mergedJson);

      if (mergedJson?.timeCols?.length) {
        setSelectedTime(mergedJson.timeCols[0]);
      }

      const lineRes = await fetch(import.meta.env.BASE_URL + "data/metro-line.json");
      const lineJson = await lineRes.json();
      setLineData(lineJson);
    })();
  }, []);

  // ✅ 현재 시간 index
  const timeIndex = useMemo(() => {
    const idx = timeCols.indexOf(selectedTime);
    return idx >= 0 ? idx : 0;
  }, [timeCols, selectedTime]);

  // ✅ 다음 시간으로
  const goNextTime = useCallback(() => {
    if (!timeCols.length) return;
    const next = (timeIndex + 1) % timeCols.length;
    setSelectedTime(timeCols[next]);
  }, [timeCols, timeIndex]);

  // ✅ 재생 로직
  useEffect(() => {
    if (!isPlaying) {
      if (playRef.current) clearInterval(playRef.current);
      playRef.current = null;
      return;
    }

    playRef.current = setInterval(goNextTime, 900);

    return () => {
      if (playRef.current) clearInterval(playRef.current);
      playRef.current = null;
    };
  }, [isPlaying, goNextTime]);

  // ✅ 선택 노선 정보
  const selectedLineEntry = useMemo(() => {
    if (!lineData?.DATA) return null;
    return lineData.DATA.find((d) => d.line === selectedLine) || null;
  }, [lineData, selectedLine]);

  const lineColor = selectedLineEntry?.color || "#111";

  const lineSegments = useMemo(() => {
    if (!selectedLineEntry?.node) return [];
    return selectedLineEntry.node
      .map((seg) => seg?.via)
      .filter(Boolean)
      .map((via) => via.map(([lat, lng]) => [lat, lng]));
  }, [selectedLineEntry]);

  // ✅ 역 필터링
  const stationsForLine = useMemo(() => {
    if (!merged?.stations || !selectedTime) return [];

    const lineNum = Number(selectedLine.replace("호선", ""));

    return merged.stations
      .filter((s) => Number(s.line) === lineNum)
      .map((s) => {
        const val = s?.congestion?.[selectedTime];
        const pct = typeof val === "number" ? val : Number(val);
        return { ...s, pct: Number.isFinite(pct) ? pct : 0 };
      })
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  }, [merged, selectedLine, selectedTime]);

  const top10 = useMemo(() => {
    return [...stationsForLine]
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 10);
  }, [stationsForLine]);

  if (!merged || !lineData) {
    return <div className="loading">데이터 불러오는 중...</div>;
  }

  return (
    <div className="layout">
      {/* 사이드바 */}
      <aside className="sidebar">
        <h1 className="title">지하철 혼잡도</h1>
        <p className="subtitle">호선 + 시간 선택 시 자동 재생 가능</p>

        <div className="lineButtons">
          {LINES.map((l) => (
            <button
              key={l}
              className={`lineBtn ${selectedLine === l ? "active" : ""}`}
              onClick={() => {
                setSelectedLine(l);
                setIsPlaying(false);
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="section">
          <div className="timeHeader">
            <div className="sectionTitle">시간대</div>

            <button
              className={`playBtn ${isPlaying ? "on" : ""}`}
              onClick={() => setIsPlaying((v) => !v)}
              disabled={!timeCols.length}
              title="시간대 재생"
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
          </div>

          <select
            className="select"
            value={selectedTime}
            onChange={(e) => {
              setSelectedTime(e.target.value);
              setIsPlaying(false);
            }}
          >
            {timeCols.map((t) => (
              <option key={t} value={t}>
                {t}~
              </option>
            ))}
          </select>
        </div>

        <div className="section">
          <div className="sectionTitle">{selectedLine} 혼잡 Top 10</div>
          <div className="list">
            {top10.map((s, idx) => (
              <div key={idx} className="listItem">
                <div>
                  {idx + 1}. {s.name}
                </div>
                <div style={{ color: congestionColor(s.pct) }}>
                  {s.pct.toFixed(2)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* 지도 */}
      <main className="mapWrap">
        <MapContainer center={[37.5665, 126.978]} zoom={11} className="map">
          <TileLayer
            className="map-tiles-dim"
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* 노선 */}
          {lineSegments.map((seg, i) => (
            <div key={i}>
              <Polyline positions={seg} pathOptions={{ color: "white", weight: 10 }} />
              <Polyline positions={seg} pathOptions={{ color: lineColor, weight: 6 }} />
            </div>
          ))}

          {/* 역 */}
          {stationsForLine.map((s, i) => (
            <CircleMarker
              key={i}
              center={[s.lat, s.lon]}
              radius={5}
              pathOptions={{
                color: "#111",
                weight: 1,
                fillColor: congestionColor(s.pct),
                fillOpacity: 0.9,
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -6]}>
                {s.name}
              </Tooltip>

              <Popup>
                <b>{s.name}</b>
                <br />
                {selectedTime}~
                <br />
                혼잡도: {s.pct.toFixed(2)}%
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </main>
    </div>
  );
}
