import { runAnalysis } from "./analysis.js";

const HIGH_BANDS = new Set(["high", "good"]);
const LOW_BANDS = new Set(["speculative", "weak", "default"]);

/**
 * 실제 사업결과(actual.outcome)와 AI 등급(gradeBand)을 규칙 기반으로 비교한다.
 * success/default만 명확히 일치·불일치를 가릴 수 있고, delayed/unknown은 판정을 보류한다.
 */
function verdictFor(outcome, gradeBand) {
  if (outcome === "success") return HIGH_BANDS.has(gradeBand) ? "일치" : "불일치";
  if (outcome === "default") return LOW_BANDS.has(gradeBand) ? "일치" : "불일치";
  return "판정보류";
}

/** 사례 1건에 AI 분석을 실행하고 실제결과와 비교한 판정을 반환한다. 계산 실패해도 예외를 던지지 않는다. */
export function judgeCase(caseObj) {
  const outcome = caseObj.actual?.outcome ?? "unknown";
  try {
    const result = runAnalysis(caseObj.input);
    return {
      id: caseObj.id,
      caseName: caseObj.caseName,
      status: caseObj.status,
      grade: result.grade,
      gradeColor: result.gradeColor,
      gradeBand: result.gradeBand,
      outcome,
      verdict: verdictFor(outcome, result.gradeBand),
      error: null,
    };
  } catch (e) {
    return {
      id: caseObj.id,
      caseName: caseObj.caseName,
      status: caseObj.status,
      grade: null,
      gradeColor: null,
      gradeBand: null,
      outcome,
      verdict: "계산 실패",
      error: e?.message || String(e),
    };
  }
}

/** data/pf-cases/case-*.json 전체를 로드한다 (Vite 전용 — 브라우저 번들에서만 동작). */
export function loadCases() {
  const modules = import.meta.glob("../../data/pf-cases/case-*.json", { eager: true });
  return Object.values(modules)
    .map((m) => m.default ?? m)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** 5건 전부에 judgeCase를 적용한 배열을 반환한다. */
export function loadCaseComparisons() {
  return loadCases().map(judgeCase);
}
