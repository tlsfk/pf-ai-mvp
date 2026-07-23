// 로컬(Node 18+)에서 실행해서 API 키가 실제로 동작하는지 바로 확인하는 스크립트
// 사용법: node test-api.mjs
// (Claude의 작업 환경은 apis.data.go.kr 접속이 네트워크 정책상 막혀 있어 여기서는 검증하지 못했습니다.)

import { readFileSync } from "fs";

function loadEnvLocal() {
  try {
    const text = readFileSync(new URL("./.env.local", import.meta.url), "utf-8");
    const map = {};
    text.split("\n").forEach((line) => {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) map[m[1]] = m[2].trim();
    });
    return map;
  } catch {
    return {};
  }
}

const env = loadEnvLocal();
const KEY = env.MOLIT_API_KEY;

if (!KEY) {
  console.error("MOLIT_API_KEY가 .env.local에 없습니다.");
  process.exit(1);
}

// 서울 성동구(11200), 2026년 6월 거래 — 아파트매매 상세
const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${KEY}&LAWD_CD=11200&DEAL_YMD=202606&numOfRows=5&pageNo=1`;

const res = await fetch(url);
const text = await res.text();
console.log("HTTP status:", res.status);
console.log(text.slice(0, 1500));
