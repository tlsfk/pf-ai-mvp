/**
 * 분석 결과 저장 구조 — 아직 백엔드/DB가 없는 클라이언트 전용 앱이라, 실행할 때마다
 * 브라우저 localStorage에 이력을 쌓아둡니다(서버 저장은 아님). 향후 백엔드가 생기면
 * saveAnalysisResult 내부만 API 호출로 교체하면 됩니다.
 */
const STORAGE_KEY = "pf_analysis_history";
const MAX_HISTORY = 50;

/** 분석 1회 실행분을 저장 가능한 형태로 직렬화 */
export function buildAnalysisRecord({ form, result, dataNote, modelVersion }) {
  return {
    createdAt: new Date().toISOString(),
    modelVersion,
    input: { ...form },
    score: { total: result.scoreModel.totalScore, grade: result.grade },
    result: {
      totalCost: result.totalCost,
      salesRevenue: result.salesRevenue,
      profit: result.profit,
      margin: result.margin,
      ltv: result.ltv,
      dscr: result.dscr,
      loanAmount: result.loanAmount,
    },
    usingRealData: result.usingRealData,
    dataNoteOk: dataNote?.ok ?? false,
  };
}

export function saveAnalysisResult(record) {
  if (typeof localStorage === "undefined") return;
  const existing = loadAnalysisHistory();
  existing.push(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(-MAX_HISTORY)));
}

export function loadAnalysisHistory() {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

/** index는 loadAnalysisHistory()가 반환한 배열에서의 위치(고유 id 없음 — 항상 최신 목록을 다시 불러온 뒤 그 위치 기준으로 삭제) */
export function deleteAnalysisResult(index) {
  if (typeof localStorage === "undefined") return;
  const existing = loadAnalysisHistory();
  existing.splice(index, 1);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}
