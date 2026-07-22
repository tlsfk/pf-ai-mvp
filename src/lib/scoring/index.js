/**
 * PF 심사 평가 모델 — 점수 산정 기준 전용 모듈.
 *
 * 이 파일만 고치면 채점 기준(카테고리 가중치·항목별 배점·컷오프·근거 문구)을
 * 전체에 반영할 수 있도록 계산 로직(runAnalysis, PFReportMVP.jsx)에서 분리했습니다.
 *
 * ⚠️ 아래 모든 컷오프·가중치·업계 통념 서술은 검증된 금융사 공인 심사 기준이 아니라
 * 자체 설계값입니다. 실제 금융사 기준에 맞게 이 파일만 교체하면 됩니다.
 */

export const SCORING_MODEL_VERSION = "1.4.0";

export const TIER_SCORE = { 우수: 100, 보통: 50, 위험: 0 };
export const TIER_COLOR = { 우수: "#2F6F5E", 보통: "#8A7A3A", 위험: "#9C3B34" };

// ---- 정성 평가항목 선택지 (선택지 자체가 곧 등급) ----
export const DEVELOPER_OPTIONS = ["대형·실적 풍부", "보통", "신설·실적 부족", "미정(정보 없음)"];
export const CONTRACTOR_OPTIONS = ["1군 건설사", "중견", "소형", "미정(정보 없음)"];
export const LOCATION_OPTIONS = ["서울 핵심·광역시 중심", "일반 도시", "수요 부족 지역"];
export const PERMIT_OPTIONS = ["완료", "진행 중", "초기 단계"];
export const SUPPLY_OPTIONS = ["공급 부족(우호적)", "적정", "공급 과다", "미확인(정보 없음)"];
export const CREDIT_ENHANCEMENT_OPTIONS = ["책임준공확약 있음", "일부 보강(자금보충약정 등)", "신용보강 없음/미확인"];
// index 3("미정"/"미확인")은 "보통"이 아니라 "위험"으로 처리합니다 — 정보가 없다는 것 자체가
// 여신심사에서는 보수적으로 다뤄야 할 리스크이지, 평균치로 얼버무릴 근거가 아닙니다.
const QUALITATIVE_TIER = { 0: "우수", 1: "보통", 2: "위험", 3: "위험" };
function optionTier(options, value) {
  const idx = options.indexOf(value);
  return idx >= 0 ? QUALITATIVE_TIER[idx] : "위험"; // 매칭 안 되는 값도 보수적으로 위험 처리
}

// ---- 정량 항목 판정 함수 (자체 설계 컷오프 — 공인 PF 심사 기준 아님) ----
function ltvTier(ltv) {
  if (ltv <= 60) return "우수";
  if (ltv < 80) return "보통";
  return "위험";
}
function dscrTier(dscr) {
  const d = Number(dscr);
  if (d >= 1.5) return "우수";
  if (d > 1.0) return "보통";
  return "위험";
}
// 자기자본비율 20% 기준: 2011년 저축은행 사태 당시 부실률이 낮았던 저축은행의 내규(20% 미만 대출 거부)가
// 검증되어 금융당국이 전 저축은행권에 확대 적용했고, 2027년부터 전 금융권 단계적 의무화 예정
// (출처: KDI FOCUS "부동산 PF 자본확충의 효과와 제도개선 방안", 금융위원회 2026 보도자료).
function equityTier(equityRatio) {
  if (equityRatio >= 20) return "우수";
  if (equityRatio >= 10) return "보통";
  return "위험";
}
// 담보가치 — 신규 4카테고리 모델의 채점 항목에는 포함하지 않지만(사용자 지시 목록에 없음),
// 기존에 표시하던 정보라 "참고용(미채점)"으로 리포트에 남겨둡니다.
export function collateralTier(ltv) {
  const coverage = (100 / ltv) * 100;
  if (coverage >= 150) return "우수";
  if (coverage >= 120) return "보통";
  return "위험";
}
function saleRateTier(rate) {
  if (rate >= 90) return "우수";
  if (rate >= 70) return "보통";
  return "위험";
}
// 금융비용부담(All-in cost, 연 환산 %) — 8% 이하면 우량, 15% 초과면 고위험이라는 자체 컷오프.
function allInCostTier(allInCost) {
  if (allInCost <= 8) return "우수";
  if (allInCost <= 15) return "보통";
  return "위험";
}
// 주변 실거래 비교 — 확보한 comps(비교사례) 개수가 많을수록 가정치/실거래가의 신뢰도가
// 높다는 전제의 자체 휴리스틱입니다. 실제 "가격이 적정한지"를 판단하는 지표가 아니라
// "비교 근거가 얼마나 두터운지"를 채점합니다.
function compsTier(usingRealData, compsCount) {
  if (!usingRealData || compsCount <= 0) return "위험";
  if (compsCount >= 4) return "우수";
  return "보통";
}
// 사업유형별 위험도 — 공인 통계가 아닌 업계 일반 통념(재건축은 조합원·대지 확보가 이미
// 되어 있어 상대적으로 안정적, 재개발은 권리관계·현금청산 이슈로 지연 위험이 상대적으로
// 크다는 통념) 기반 휴리스틱입니다. 사업지별 실제 리스크와 다를 수 있습니다.
function projectTypeRiskTier(projectType) {
  if (projectType === "재건축") return "우수";
  if (projectType === "신축개발") return "보통";
  return "위험"; // 재개발
}
// 사업 진행 리스크 — 별도 데이터소스가 없어, 인허가/시행사/시공사 3개 정성항목 중
// "취약" 판정이 몇 개나 겹치는지로 합성한 파생 지표입니다.
function progressRiskTier(permitStage, developerTrack, contractorGrade) {
  let weak = 0;
  if (permitStage === "초기 단계") weak++;
  if (developerTrack === "신설·실적 부족" || developerTrack === "미정(정보 없음)") weak++;
  if (contractorGrade === "소형" || contractorGrade === "미정(정보 없음)") weak++;
  if (weak >= 2) return "위험";
  if (weak === 1) return "보통";
  return "우수";
}

// ---- 등급 컷오프(20단계, 0~100점 균등분할 — 공인 신용평가 방법론 아님, 등급명만 차용) ----
const CREDIT_GRADES = [
  { grade: "AAA", min: 92 }, { grade: "AA+", min: 87 }, { grade: "AA", min: 82 }, { grade: "AA-", min: 77 },
  { grade: "A+", min: 72 }, { grade: "A", min: 67 }, { grade: "A-", min: 62 },
  { grade: "BBB+", min: 57 }, { grade: "BBB", min: 52 }, { grade: "BBB-", min: 47 },
  { grade: "BB+", min: 42 }, { grade: "BB", min: 37 }, { grade: "BB-", min: 32 },
  { grade: "B+", min: 27 }, { grade: "B", min: 22 }, { grade: "B-", min: 17 },
  { grade: "CCC", min: 11 }, { grade: "CC", min: 6 }, { grade: "C", min: 0 },
];
const GRADE_META = {
  AAA: { color: "#2F6F5E", note: "최우량 — 심사 적합", band: "high" },
  "AA+": { color: "#2F6F5E", note: "우량 — 심사 적합", band: "high" },
  AA: { color: "#2F6F5E", note: "우량 — 심사 적합", band: "high" },
  "AA-": { color: "#2F6F5E", note: "우량 — 심사 적합", band: "high" },
  "A+": { color: "#3E7C82", note: "양호 — 표준 심사 진행", band: "good" },
  A: { color: "#3E7C82", note: "양호 — 표준 심사 진행", band: "good" },
  "A-": { color: "#3E7C82", note: "양호 — 표준 심사 진행", band: "good" },
  "BBB+": { color: "#3E7C82", note: "적정 — 보완자료 확보 후 진행", band: "good" },
  BBB: { color: "#3E7C82", note: "적정 — 보완자료 확보 후 진행", band: "good" },
  "BBB-": { color: "#3E7C82", note: "적정 — 보완자료 확보 후 진행", band: "good" },
  "BB+": { color: "#8A7A3A", note: "투기적 — 조건부 적합", band: "speculative" },
  BB: { color: "#8A7A3A", note: "투기적 — 조건부 적합", band: "speculative" },
  "BB-": { color: "#8A7A3A", note: "투기적 — 조건부 적합", band: "speculative" },
  "B+": { color: "#8A7A3A", note: "투기적 — 리스크 보완 필요", band: "speculative" },
  B: { color: "#8A7A3A", note: "투기적 — 리스크 보완 필요", band: "speculative" },
  "B-": { color: "#8A7A3A", note: "투기적 — 리스크 보완 필요", band: "speculative" },
  CCC: { color: "#A6642E", note: "고위험 — 재검토 권고", band: "weak" },
  CC: { color: "#A6642E", note: "고위험 — 재검토 권고", band: "weak" },
  C: { color: "#A6642E", note: "고위험 — 재검토 권고", band: "weak" },
  D: { color: "#9C3B34", note: "부도·채무불이행 수준 — 심사 불가", band: "default" },
};

// ---- 항목별 평가 근거 문구 생성 ----
function reasonLTV(ltv, tier) {
  if (tier === "우수") return `LTV ${ltv.toFixed(1)}%로 60% 이하 — 담보 대비 대출 비중이 낮아 안정적인 수준입니다.`;
  if (tier === "보통") return `LTV ${ltv.toFixed(1)}%로 60~80% 구간 — 통상적인 PF 대출 수준입니다.`;
  return `LTV ${ltv.toFixed(1)}%로 80% 이상 — 담보 대비 대출 비중이 높아 위험 수준입니다.`;
}
function reasonDSCR(dscr, tier) {
  const d = Number(dscr);
  if (tier === "우수") return `DSCR ${d.toFixed(2)}배로 1.5배 이상 — 이자상환 여력이 충분합니다.`;
  if (tier === "보통") return `DSCR ${d.toFixed(2)}배로 1.0~1.5배 — 상환 여력이 보통 수준입니다.`;
  return `DSCR ${d.toFixed(2)}배로 1.0배 미만 — 이자상환 여력이 부족한 위험 수준입니다.`;
}
function reasonEquity(equityRatio, tier) {
  if (tier === "우수") return `자기자본비율 ${equityRatio}%로 일반적인 PF 구조 대비 안정적인 수준입니다.`;
  if (tier === "보통") return `자기자본비율 ${equityRatio}%로 최소 기준(10%)은 넘었으나 여유는 크지 않습니다.`;
  return `자기자본비율 ${equityRatio}%로 10% 미만 — 저축은행권 등에서 통상 부적격으로 보는 수준입니다.`;
}
function reasonAllInCost(allInCost, tier) {
  if (tier === "우수") return `All-in 조달비용 ${allInCost.toFixed(1)}%로 8% 이하 — 금융비용 부담이 낮습니다.`;
  if (tier === "보통") return `All-in 조달비용 ${allInCost.toFixed(1)}%로 8~15% 구간 — 통상적인 부담 수준입니다.`;
  return `All-in 조달비용 ${allInCost.toFixed(1)}%로 15% 초과 — 금융비용 부담이 큽니다.`;
}
function reasonSaleRate(rate, tier) {
  if (tier === "우수") return `예상 분양률 ${rate}%로 90% 이상 — 분양 리스크가 낮습니다.`;
  if (tier === "보통") return `예상 분양률 ${rate}%로 70~90% 구간 — 통상적인 수준입니다.`;
  return `예상 분양률 ${rate}%로 70% 미만 — 미분양 리스크가 있습니다.`;
}
function reasonComps(usingRealData, compsCount, tier) {
  if (!usingRealData) return "실거래가 API가 반영되지 않아 주변 비교사례를 확인하지 못했습니다(가정치만 사용).";
  if (tier === "우수") return `국토교통부 실거래가 ${compsCount}건을 확보해 비교 근거가 충분합니다.`;
  return `국토교통부 실거래가 ${compsCount}건 확보 — 비교 근거가 제한적입니다.`;
}
function reasonCreditEnhancement(creditEnhancement, tier) {
  if (creditEnhancement === "신용보강 없음/미확인") return "신용보강구조 정보가 입력되지 않아 보수적으로 위험 처리했습니다. 시공사 책임준공확약 등 실제 구조를 확인해주세요.";
  if (tier === "우수") return `"${creditEnhancement}" — 시공사 부도·미이행 시에도 대출 상환을 보완하는 장치가 확보되어 있습니다.`;
  return `"${creditEnhancement}" — 완전한 책임준공확약 대비 신용보강 수준이 제한적입니다.`;
}
function reasonProjectType(projectType, tier) {
  if (tier === "우수") return `"${projectType}"은 조합원·대지 확보가 이미 이뤄진 경우가 많아 상대적으로 안정적인 유형입니다(업계 통념 기반).`;
  if (tier === "보통") return `"${projectType}"은 인허가·분양 변수는 있으나 권리관계는 비교적 단순한 유형입니다(업계 통념 기반).`;
  return `"${projectType}"은 권리관계·현금청산 이슈로 지연 리스크가 상대적으로 큰 유형입니다(업계 통념 기반).`;
}
function reasonSupply(supplyCompetition) {
  if (supplyCompetition === "미확인(정보 없음)") return "공급 경쟁 정보가 입력되지 않아 보수적으로 위험 처리했습니다. 고급 설정에서 직접 입력해주세요.";
  return `공급 경쟁 현황을 "${supplyCompetition}"으로 직접 입력하셨습니다(사용자 판단 기준).`;
}
function reasonPermit(tier) {
  if (tier === "우수") return "인허가가 완료되어 인허가 지연 리스크가 없습니다.";
  if (tier === "보통") return "인허가가 진행 중으로 일정 지연 위험이 일부 존재합니다.";
  return "인허가가 초기 단계로 일정 지연 위험이 존재합니다.";
}
function reasonDeveloper(developerTrack, tier) {
  if (developerTrack === "미정(정보 없음)") return "시행사 실적 정보가 입력되지 않아 보수적으로 위험 처리했습니다.";
  if (tier === "우수") return `시행사 실적 "${developerTrack}" — 트랙레코드가 검증된 것으로 판단됩니다.`;
  if (tier === "보통") return `시행사 실적 "${developerTrack}" — 표준적인 수준입니다.`;
  return `시행사 실적 "${developerTrack}" — 실적 검증이 부족합니다.`;
}
function reasonContractor(contractorGrade, tier) {
  if (contractorGrade === "미정(정보 없음)") return "시공사 등급 정보가 입력되지 않아 보수적으로 위험 처리했습니다.";
  if (tier === "우수") return `시공사 "${contractorGrade}" — 시공 안정성이 높은 것으로 판단됩니다.`;
  if (tier === "보통") return `시공사 "${contractorGrade}" — 표준적인 수준입니다.`;
  return `시공사 "${contractorGrade}" — 시공 안정성 리스크가 있습니다.`;
}
function reasonProgress(tier) {
  if (tier === "우수") return "인허가·시행사·시공사 중 취약 요소가 없어 사업 진행 리스크가 낮습니다.";
  if (tier === "보통") return "인허가·시행사·시공사 중 1개 항목에서 취약점이 있어 진행 리스크가 일부 존재합니다.";
  return "인허가·시행사·시공사 중 2개 이상에서 취약점이 겹쳐 사업 진행 리스크가 큽니다.";
}
function reasonLocation(locationTier, tier) {
  if (tier === "우수") return `입지 "${locationTier}" — 수요 기반이 탄탄한 지역입니다.`;
  if (tier === "보통") return `입지 "${locationTier}" — 표준적인 수준의 지역입니다.`;
  return `입지 "${locationTier}" — 수요 기반이 약한 지역입니다.`;
}

// ---- 4개 카테고리(총 100점) 구성 ----
// 카테고리/항목 배점은 사용자 지시(금융안정성40·사업성30·사업안정성20·입지경쟁력10)를
// 그대로 따르되, 카테고리 내 세부 항목별 배점 분배는 자체 설계입니다(실제 금융사 기준에
// 맞게 이 배열의 maxPoints만 조정하면 전체 반영됩니다).
const CATEGORIES = [
  {
    key: "financial", name: "금융 안정성", maxPoints: 40,
    items: [
      {
        key: "ltv", name: "LTV", maxPoints: 12, type: "정량",
        build: (ctx) => {
          const tier = ltvTier(ctx.ltv);
          return { tier, detail: `${ctx.ltv.toFixed(1)}%`, source: "대출금액÷분양수입(자체 계산)", reason: reasonLTV(ctx.ltv, tier) };
        },
      },
      {
        key: "dscr", name: "DSCR", maxPoints: 12, type: "정량",
        build: (ctx) => {
          const tier = dscrTier(ctx.dscr);
          return { tier, detail: `${ctx.dscr}x`, source: "연환산 사업이익÷연간이자(자체 계산)", reason: reasonDSCR(ctx.dscr, tier) };
        },
      },
      {
        key: "equityRatio", name: "자기자본비율", maxPoints: 10, type: "정량",
        build: (ctx) => {
          const tier = equityTier(ctx.equityRatio);
          return { tier, detail: `${ctx.equityRatio}%`, source: "사용자 입력값", reason: reasonEquity(ctx.equityRatio, tier) };
        },
      },
      {
        key: "allInCost", name: "금융비용 부담", maxPoints: 6, type: "정량",
        build: (ctx) => {
          const tier = allInCostTier(ctx.allInCost);
          return { tier, detail: `${ctx.allInCost.toFixed(1)}%`, source: "All-in cost(자체 계산)", reason: reasonAllInCost(ctx.allInCost, tier) };
        },
      },
    ],
  },
  {
    key: "feasibility", name: "사업성", maxPoints: 30,
    items: [
      {
        // v1.1.0 대비 10→12점. "예상 분양성"(입지+분양률 조합) 항목을 삭제하면서 확보한 점수를
        // 가장 직접적인 정량 분양지표인 이 항목에 배정했습니다(근거는 아래 "삭제된 항목" 참고).
        key: "expectedSaleRate", name: "예상 분양률", maxPoints: 12, type: "정량",
        build: (ctx) => {
          const tier = saleRateTier(ctx.expectedSaleRate);
          return {
            tier, detail: `${ctx.expectedSaleRate}%`,
            source: ctx.expectedSaleRateIsDefault ? "기본값(미입력)" : "사용자 입력값",
            reason: reasonSaleRate(ctx.expectedSaleRate, tier),
          };
        },
      },
      {
        // v1.2.0 대비 9→6점. comps는 "비교사례가 몇 건 확보됐는가"라는 데이터 가용성 지표일
        // 뿐 사업성 지표가 아닌데, v1.2.0에서 9점까지 늘면서 "완전히 동일한 딜인데 실거래가
        // 조회 가능 지역이냐 아니냐만으로 AAA/AA+가 갈리는"(실행 검증으로 확인된) 과대평가가
        // 커졌습니다. 확보한 3점은 실제 시장 리스크 신호인 supplyCompetition으로 재배정.
        key: "comps", name: "주변 실거래 비교", maxPoints: 6, type: "정량",
        build: (ctx) => {
          const tier = compsTier(ctx.usingRealData, ctx.compsCount);
          return {
            tier, detail: ctx.usingRealData ? `비교사례 ${ctx.compsCount}건` : "미반영",
            source: "국토교통부 실거래가 API", reason: reasonComps(ctx.usingRealData, ctx.compsCount, tier),
          };
        },
      },
      {
        // v1.2.0 대비 5→8점 (comps 축소분 재배정, 위 참고).
        key: "supplyCompetition", name: "공급 경쟁", maxPoints: 8, type: "정성",
        build: (ctx) => {
          const tier = optionTier(SUPPLY_OPTIONS, ctx.supplyCompetition);
          return {
            tier, detail: ctx.supplyCompetition,
            source: ctx.supplyCompetitionIsDefault ? "기본값(미입력)" : "사용자 입력값",
            reason: reasonSupply(ctx.supplyCompetition),
          };
        },
      },
      {
        key: "projectTypeRisk", name: "사업 유형별 위험도", maxPoints: 4, type: "정성",
        build: (ctx) => {
          const tier = projectTypeRiskTier(ctx.projectType);
          return { tier, detail: ctx.projectType, source: "업계 통념 기반(자체 판정)", reason: reasonProjectType(ctx.projectType, tier) };
        },
      },
    ],
  },
  {
    key: "stability", name: "사업 안정성", maxPoints: 20,
    items: [
      {
        // v1.1.0 대비 6→5점 (신용보강구조 신설로 재배분, 아래 참고).
        key: "permitStage", name: "인허가 단계", maxPoints: 5, type: "정성",
        build: (ctx) => {
          const tier = optionTier(PERMIT_OPTIONS, ctx.permitStage);
          return { tier, detail: ctx.permitStage, source: "사용자 입력값", reason: reasonPermit(tier) };
        },
      },
      {
        // v1.1.0 대비 6→5점.
        key: "developerTrack", name: "시행사 경험", maxPoints: 5, type: "정성",
        build: (ctx) => {
          const tier = optionTier(DEVELOPER_OPTIONS, ctx.developerTrack);
          return {
            tier, detail: ctx.developerTrack,
            source: ctx.developerTrackIsDefault ? "기본값(미입력)" : "사용자 입력값",
            reason: reasonDeveloper(ctx.developerTrack, tier),
          };
        },
      },
      {
        // v1.1.0 대비 5→3점. 신용보강구조가 시공사 부도 리스크의 상당 부분을 별도로 채점하므로 축소.
        key: "contractorGrade", name: "시공사 안정성", maxPoints: 3, type: "정성",
        build: (ctx) => {
          const tier = optionTier(CONTRACTOR_OPTIONS, ctx.contractorGrade);
          return {
            tier, detail: ctx.contractorGrade,
            source: ctx.contractorGradeIsDefault ? "기본값(미입력)" : "사용자 입력값",
            reason: reasonContractor(ctx.contractorGrade, tier),
          };
        },
      },
      {
        // 신규(v1.2.0). 실무 PF 심사에서 담보가치·재무지표 못지않게 승인 여부를 좌우하는
        // 신용보강구조(시공사 책임준공확약/조건부채무인수/자금보충약정 등)를 독립 채점.
        // 시공사 "등급"과는 별개 축 — 등급이 좋아도 신용보강이 없으면 이 항목은 위험으로 잡힙니다.
        key: "creditEnhancement", name: "신용보강구조", maxPoints: 4, type: "정성",
        build: (ctx) => {
          const tier = optionTier(CREDIT_ENHANCEMENT_OPTIONS, ctx.creditEnhancement);
          return {
            tier, detail: ctx.creditEnhancement,
            source: ctx.creditEnhancementIsDefault ? "기본값(미입력)" : "사용자 입력값",
            reason: reasonCreditEnhancement(ctx.creditEnhancement, tier),
          };
        },
      },
      {
        key: "progressRisk", name: "사업 진행 리스크", maxPoints: 3, type: "정성",
        build: (ctx) => {
          const tier = progressRiskTier(ctx.permitStage, ctx.developerTrack, ctx.contractorGrade);
          return { tier, detail: "인허가·시행사·시공사 종합", source: "3개 항목 조합(자체 판정)", reason: reasonProgress(tier) };
        },
      },
    ],
  },
  {
    key: "location", name: "입지 경쟁력", maxPoints: 10,
    items: [
      {
        // v1.1.0 대비 4→10점(단일 항목화, 아래 "삭제된 항목" 참고).
        // ⚠️ 입지 데이터소스가 locationTier(3지선다 선택값) 하나뿐이라, 이 카테고리 10점 전부가
        // 그 선택 하나로 결정됩니다 — 다만 카테고리 자체 비중이 전체의 10%로 작게 설계되어 있어
        // (사용자 지시) 여기서 실제 등급을 좌우하는 영향력은 제한적입니다.
        key: "locationBase", name: "입지 등급", maxPoints: 10, type: "정성",
        build: (ctx) => {
          const tier = optionTier(LOCATION_OPTIONS, ctx.locationTier);
          return {
            tier, detail: ctx.locationTier,
            source: ctx.locationTierIsDefault ? "기본값(브이월드 미연동)" : "사용자 입력값",
            reason: reasonLocation(ctx.locationTier, tier),
          };
        },
      },
      // 삭제된 항목(v1.1.0 대비):
      // - "주변 거래"(3점) — 사업성 카테고리의 "주변 실거래 비교"와 완전히 동일한 comps 데이터를
      //   재사용해 두 카테고리에 이중계상되고 있었습니다.
      // - "교통 접근성"(2점)·"생활 인프라"(1점) — 별도 데이터소스 없이 locationTier를 그대로
      //   재사용해 사실상 정보량 없이 항목 개수만 늘리고 있었습니다. "입지 등급" 하나로 통합.
    ],
  },
];

/**
 * 4개 카테고리(금융안정성40·사업성30·사업안정성20·입지경쟁력10) 기준으로 총점·등급을 산정합니다.
 * ctx에 필요한 필드는 이 파일 CATEGORIES의 각 build() 함수가 참조하는 값들입니다
 * (ltv, dscr, equityRatio, allInCost, expectedSaleRate, expectedSaleRateIsDefault, usingRealData,
 *  compsCount, locationTier, locationTierIsDefault, supplyCompetition, supplyCompetitionIsDefault,
 *  projectType, permitStage, developerTrack, developerTrackIsDefault, contractorGrade,
 *  contractorGradeIsDefault, creditEnhancement, creditEnhancementIsDefault,
 *  financialModelInvalid, profit).
 */
export function computeScoreModel(ctx) {
  const categories = CATEGORIES.map((cat) => {
    const items = cat.items.map((def) => {
      const built = def.build(ctx);
      const score = (TIER_SCORE[built.tier] / 100) * def.maxPoints;
      return { key: def.key, name: def.name, maxPoints: def.maxPoints, type: def.type, score, ...built };
    });
    const score = items.reduce((s, i) => s + i.score, 0);
    return { key: cat.key, name: cat.name, maxPoints: cat.maxPoints, score, items };
  });
  const totalScore = categories.reduce((s, c) => s + c.score, 0);

  // 사업수지 적자, DSCR<1.0(원리금 상환 불가 수준), 또는 대출구조 자체가 성립하지 않으면
  // 총점과 무관하게 무조건 D.
  const isDefault = ctx.financialModelInvalid || ctx.profit <= 0 || Number(ctx.dscr) < 1.0;
  let grade = "D";
  if (!isDefault) {
    const tier = CREDIT_GRADES.find((t) => totalScore >= t.min);
    grade = tier ? tier.grade : "D";
  }

  // ---- 하드 게이트: 카테고리 하나가 완전히 무너지면 나머지 카테고리 만점으로도 못 가리게 등급 상한 적용 ----
  // 가중합산 방식의 구조적 한계(검증 케이스 F/G) 대응: 금융 4항목 중 2개 이상 위험, 또는
  // 사업 진행 3항목(인허가·시행사·시공사, 이들의 합성값인 progressRisk는 제외) 중 2개 이상 위험이면
  // 총점이 아무리 높아도 등급을 BB(투기적) 이하로 캡한다.
  // v1.4.0: 사업안정성 게이트를 "3개 전부 위험"에서 "2개 이상 위험"으로 완화(금융 게이트와 기준 통일).
  // PF 사례 검증(data/pf-cases)으로 실제 부도 사례 6건을 돌려본 결과 5건이 등급 BBB대로 나와
  // 실제결과(default)와 불일치했는데, 원인이 이 조건이었습니다 — 실제 부도는 대부분 "인허가 진행
  // 중"(착공 이후) 단계에서 발생해 인허가 항목 자체는 위험으로 안 잡히고, 시행사·시공사 2개만
  // 위험이면 예전 기준(3개 전부)으로는 게이트가 발동하지 않았습니다.
  let gateApplied = null;
  if (!isDefault) {
    const financialItems = categories.find((c) => c.key === "financial").items;
    const financialRiskCount = financialItems.filter((i) => i.tier === "위험").length;
    // progressRisk(파생값)와 creditEnhancement(신용보강구조, 실행능력과 별개 축)는
    // "실행 3항목"이 아니므로 이 게이트 판단에서 제외합니다.
    const stabilityCoreItems = categories.find((c) => c.key === "stability").items
      .filter((i) => i.key === "permitStage" || i.key === "developerTrack" || i.key === "contractorGrade");
    const stabilityRiskCount = stabilityCoreItems.filter((i) => i.tier === "위험").length;

    if (financialRiskCount >= 2) {
      grade = capGrade(grade, "BB");
      gateApplied = "financial";
    }
    if (stabilityRiskCount >= 2) {
      grade = capGrade(grade, "BB");
      gateApplied = gateApplied ? "both" : "stability";
    }
  }
  const gradeInfo = GRADE_META[grade];

  return {
    version: SCORING_MODEL_VERSION,
    totalScore,
    categories,
    grade,
    gradeNote: gradeInfo.note,
    gradeColor: gradeInfo.color,
    gradeBand: gradeInfo.band,
    gateApplied,
  };
}

/** 등급을 maxGrade보다 좋게(=더 높게) 나오지 못하도록 내리누른다. 이미 maxGrade보다 나쁘면 그대로 둔다. */
function capGrade(grade, maxGrade) {
  const gradeIdx = CREDIT_GRADES.findIndex((t) => t.grade === grade);
  const capIdx = CREDIT_GRADES.findIndex((t) => t.grade === maxGrade);
  return gradeIdx < capIdx ? maxGrade : grade;
}

/**
 * Executive Summary용 핵심 리스크 TOP n. "위험/보통" 항목 중 배점 손실분(maxPoints−score,
 * "deficit")이 큰 순으로 뽑습니다 — 단순히 위험 tier만 볼 게 아니라 배점이 큰 항목(예: LTV 12점)이
 * 배점이 작은 항목(예: 사업유형위험도 4점)보다 실제 등급에 미치는 영향이 크기 때문입니다.
 */
export function topRiskItems(scoreModel, n = 3) {
  return scoreModel.categories
    .flatMap((cat) => cat.items.map((i) => ({ ...i, categoryName: cat.name, deficit: i.maxPoints - i.score })))
    .filter((i) => i.tier !== "우수")
    .sort((a, b) => b.deficit - a.deficit)
    .slice(0, n);
}

/** Executive Summary용 핵심 강점 TOP n. "우수" 판정 항목 중 배점(maxPoints)이 큰 순으로 뽑습니다. */
export function topStrengthItems(scoreModel, n = 2) {
  return scoreModel.categories
    .flatMap((cat) => cat.items.map((i) => ({ ...i, categoryName: cat.name })))
    .filter((i) => i.tier === "우수")
    .sort((a, b) => b.maxPoints - a.maxPoints)
    .slice(0, n);
}
