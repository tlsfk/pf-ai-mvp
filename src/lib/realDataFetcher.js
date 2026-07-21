/**
 * 실거래가 실데이터 연동 — 7종 전체
 * -------------------------------------------------
 * data.go.kr에서 발급받은 서비스키가 .env.local의 VITE_MOLIT_API_KEY에 이미 채워져 있습니다.
 * (7개 데이터셋 모두 동일한 일반 인증키 하나로 호출됩니다 — data.go.kr은 데이터셋별이 아니라
 *  계정 단위로 키를 발급하기 때문입니다.)
 *
 * 참고: 이 키는 본인 계정에 물려있는 인증키이니 공개 저장소(GitHub 등)에 올리지 마시고,
 * .env.local은 .gitignore에 반드시 포함하세요 (아래 .gitignore 파일에 이미 추가해뒀습니다).
 */

const MOLIT_API_KEY = import.meta.env.VITE_MOLIT_API_KEY || "";
const VWORLD_API_KEY = import.meta.env.VITE_VWORLD_API_KEY || "";

// 서비스명 + 오퍼레이션명 매핑 (data.go.kr 요청주소 기준: /1613000/{서비스명}/{오퍼레이션명})
const TRADE_ENDPOINTS = {
  apt: { service: "RTMSDataSvcAptTrade", op: "getRTMSDataSvcAptTrade", label: "아파트매매(기본)" },
  aptDev: { service: "RTMSDataSvcAptTradeDev", op: "getRTMSDataSvcAptTradeDev", label: "아파트매매(상세, 동·층 포함)" },
  rowHouse: { service: "RTMSDataSvcRHTrade", op: "getRTMSDataSvcRHTrade", label: "연립다세대매매" },
  officetel: { service: "RTMSDataSvcOffiTrade", op: "getRTMSDataSvcOffiTrade", label: "오피스텔매매" },
  singleHouse: { service: "RTMSDataSvcSHTrade", op: "getRTMSDataSvcSHTrade", label: "단독/다가구매매" },
  commercial: { service: "RTMSDataSvcNrgTrade", op: "getRTMSDataSvcNrgTrade", label: "상업업무용 부동산매매" },
  land: { service: "RTMSDataSvcLandTrade", op: "getRTMSDataSvcLandTrade", label: "토지매매" },
};

/**
 * @param {keyof typeof TRADE_ENDPOINTS} type
 * @param {{ lawdCd: string, dealYmd: string }} params  LAWD_CD: 법정동코드 5자리, DEAL_YMD: 'YYYYMM'
 */
export async function fetchTrade(type, { lawdCd, dealYmd, numOfRows = 100, pageNo = 1 }) {
  if (!MOLIT_API_KEY) {
    throw new Error("MOLIT_API_KEY가 없습니다. .env.local의 VITE_MOLIT_API_KEY를 확인하세요.");
  }
  const endpoint = TRADE_ENDPOINTS[type];
  if (!endpoint) throw new Error(`알 수 없는 거래유형: ${type}`);

  // vite.config.js의 프록시(/api/molit → https://apis.data.go.kr)를 경유해 CORS를 우회합니다.
  const base = `/api/molit/1613000/${endpoint.service}/${endpoint.op}`;
  const params = new URLSearchParams({
    serviceKey: MOLIT_API_KEY,
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    numOfRows: String(numOfRows),
    pageNo: String(pageNo),
  });

  const res = await fetch(`${base}?${params.toString()}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${endpoint.label} API 호출 실패 (${res.status}): ${text.slice(0, 200)}`);
  return { type, label: endpoint.label, items: parseMolitXml(text) };
}

/** 여러 거래유형을 한 번에 조회 (사업유형에 맞는 유형만 골라서 넘기면 됩니다) */
export async function fetchTrades(types, params) {
  const results = await Promise.allSettled(types.map((t) => fetchTrade(t, params)));
  return results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { type: types[i], error: r.reason?.message || "실패" }
  );
}

function parseMolitXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");

  const resultCode = doc.querySelector("resultCode")?.textContent;
  const resultMsg = doc.querySelector("resultMsg")?.textContent;
  if (resultCode && resultCode !== "00" && resultCode !== "000") {
    throw new Error(`API 응답 오류 [${resultCode}] ${resultMsg}`);
  }

  const items = Array.from(doc.querySelectorAll("item"));
  return items.map((item) => {
    const get = (tag) => item.querySelector(tag)?.textContent?.trim() || null;
    return {
      name: get("aptNm") || get("아파트") || get("연립다세대") || get("건물명") || get("지번") || null,
      dealAmount: get("dealAmount") || get("거래금액"),
      dealYear: get("dealYear") || get("년"),
      dealMonth: get("dealMonth") || get("월"),
      dealDay: get("dealDay") || get("일"),
      area: get("excluUseAr") || get("totalFloorAr") || get("dealArea") || get("전용면적") || get("대지면적") || get("연면적"),
      floor: get("floor") || get("층"),
      buildYear: get("buildYear") || get("건축년도"),
      dong: get("umdNm") || get("법정동"),
    };
  });
}

// ---- V-World 지오코딩 + 토지특성정보 ----
// 2026-07-21: 실제 키로 직접 호출해 검증한 엔드포인트/파라미터입니다 (test-vworld*.mjs로 확인).
// vite.config.js의 /api/vworld 프록시(→ https://api.vworld.kr)를 경유합니다.

/** 주소 → PNU(19자리 필지고유번호) 변환. 못 찾으면 null. */
export async function geocodeToPnu(address) {
  if (!VWORLD_API_KEY) {
    throw new Error("VWORLD_API_KEY가 없습니다. .env.local의 VITE_VWORLD_API_KEY를 확인하세요.");
  }
  const params = new URLSearchParams({
    service: "address", request: "getcoord", crs: "epsg:4326",
    address, type: "PARCEL", key: VWORLD_API_KEY,
  });
  const res = await fetch(`/api/vworld/req/address?${params.toString()}`);
  const data = await res.json();
  if (data?.response?.status !== "OK") {
    throw new Error(data?.response?.error?.text || "주소를 찾을 수 없습니다(브이월드 지오코딩 실패).");
  }
  return data.response.refined?.structure?.level4LC || null; // PNU
}

/**
 * PNU로 토지특성정보(용도지역·개별공시지가) 조회. 연도별 이력이 여러 건 오므로 최신 연도 값만 사용합니다.
 * ⚠️ 건폐율·용적률은 이 API(토지 자체 정보)에는 없습니다 — 건축물대장 소관이라 별도 데이터가 필요합니다.
 */
export async function fetchLandCharacteristics(pnu) {
  if (!VWORLD_API_KEY) {
    throw new Error("VWORLD_API_KEY가 없습니다. .env.local의 VITE_VWORLD_API_KEY를 확인하세요.");
  }
  const domain = typeof window !== "undefined" ? window.location.host : "localhost";
  const params = new URLSearchParams({
    pnu, format: "json", numOfRows: "20", pageNo: "1", key: VWORLD_API_KEY, domain,
  });
  const res = await fetch(`/api/vworld/ned/data/getLandCharacteristics?${params.toString()}`);
  const data = await res.json();
  const rows = data?.landCharacteristicss?.field;
  if (!rows || rows.length === 0) {
    throw new Error("해당 필지의 토지특성정보를 찾을 수 없습니다.");
  }
  const latest = [...rows].sort((a, b) => Number(b.stdrYear) - Number(a.stdrYear))[0];
  return {
    zone: latest.prposArea1Nm || null, // 용도지역1 (예: "준주거지역")
    zone2: latest.prposArea2Nm && latest.prposArea2Nm !== "지정되지않음" ? latest.prposArea2Nm : null,
    officialLandPricePerM2: Number(latest.pblntfPclnd) || null, // 개별공시지가(원/㎡)
    standardYear: latest.stdrYear,
    lotAreaM2: Number(latest.lndpclAr) || null, // 대장상 지목 필지면적(㎡, 사용자가 입력한 대지면적과 다를 수 있음)
  };
}

export { TRADE_ENDPOINTS };

/**
 * 다음 이어서 할 작업:
 * 1. 사업유형별로 어떤 거래유형을 조회할지 매핑
 *    - 재건축 → apt, aptDev
 *    - 재개발 → rowHouse, singleHouse, land
 *    - 신축개발 → land, officetel
 *    - 상가 개발 → commercial, land
 * 2. fetchTrades 결과의 dealAmount(만원, 콤마 포함 문자열) 평균을 내서
 *    PFReportMVP.jsx의 runAnalysis()에서 landPricePerPy/salesPricePerPy 가정치를 대체
 * 3. 주소 → 법정동코드(LAWD_CD) 변환기가 아직 없음 — 카카오/네이버 지오코딩 API
 *    또는 V-World 지오코딩 API로 주소를 좌표/PNU로 바꾼 뒤, code.go.kr 법정동코드표와 매칭 필요
 */
