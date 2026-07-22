import { computeScoreModel, collateralTier } from "./scoring/index.js";

// ---- deterministic pseudo-analysis engine (no live data feeds in this sandbox) ----
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
function seededRand(seed, i) {
  const x = Math.sin(seed + i * 97.13) * 10000;
  return x - Math.floor(x);
}

// 법정 용적률 상한 — 국토계획법 시행령 §85 및 서울시 도시계획조례 기준(2026-07 확인).
// 국토계획법상 법정 상한: 2종주거 250%/3종주거 300%/준주거 500%/일반상업 1,300%이나,
// 서울시 조례는 이보다 낮게 규정: 2종주거 200%, 3종주거 250%, 준주거 400%(관행상 통용), 일반상업 800%.
// 단, 2025.5~2028.5 한시적으로 "소규모 건축물"에 한해 2종 250%/3종 300%까지 완화 적용 중(본 계산에는 미반영).
export const ZONE_FAR = {
  "제2종일반주거지역": 200,
  "제3종일반주거지역": 250,
  "준주거지역": 400,
  "일반상업지역": 800,
};

/** 연환산 All-in 조달비용률(%) = 대출금리 + 취급수수료를 대출기간(년)으로 환산 */
function allInCostRate(interestRate, originationFee, loanTermMonths) {
  const years = loanTermMonths / 12;
  return interestRate + originationFee / years;
}

// ⚠️ 아래 값은 "AI 추정치"나 "업계 평균"이 아닙니다 — 실제 값을 모른다는 것을 명시적으로 표시하는
// 기본값입니다. 시행사실적/시공사등급은 심사 핵심 항목이라 "보통"으로 얼버무리지 않고 "미정(정보 없음)"으로
// 시작해 보수적으로 위험 처리되도록 했습니다. 정확한 값을 아시면 "고급 설정"에서 직접 입력해주세요.
export const PLACEHOLDER_DEFAULTS = {
  developerTrack: "미정(정보 없음)",
  contractorGrade: "미정(정보 없음)",
  locationTier: "일반 도시",
  supplyCompetition: "미확인(정보 없음)",
  creditEnhancement: "신용보강 없음/미확인",
  expectedSaleRate: 80,
  interestRate: 9.0,
  originationFee: 1.0,
  equityRatio: 20,
};

// 공사비·소프트비용 미입력 시 사용하는 고정 기본값(랜덤 아님, 근거 없는 참고용 수치임을 명시)
const DEFAULT_CONSTRUCTION_COST_PER_PY = 900; // 만원/평
const DEFAULT_SOFT_COST_RATIO = 0.15; // 15%

/**
 * 폼 입력값 하나로 사업수지·금융구조·채점 결과를 전부 산출하는 핵심 계산 함수.
 * @param {object} form - PFReportMVP의 `form` state와 동일한 필드 구조(문자열 입력값 포함).
 * @param {number|null} [realPricePerPy] - 국토부 실거래가로 조회된 평당가(만원). null이면 가정치 사용.
 * @param {number} [compsCount] - 실거래가 API로 확보한 비교사례 건수(사업성/입지 채점에 사용).
 * @returns {object} 리포트 렌더링에 쓰이는 계산 결과(landCost, totalCost, ltv, dscr, scoreModel, grade 등).
 */
export function runAnalysis(
  {
    address, area, zone, projectType, lender, developerTrack, contractorGrade, locationTier,
    supplyCompetition, creditEnhancement, permitStage, expectedSaleRate, equityRatio, interestRate, originationFee, loanTermMonths,
    totalCostOverride, landCostOverride, constructionCostPerPyInput, softCostMode, softCostRatioInput,
    designFee, supervisionFee, salesCost, contingency, demolitionCost, leviesCost, miscCost,
  },
  realPricePerPy = null,
  compsCount = 0
) {
  const seed = hashSeed(address + zone + projectType + lender + area);
  // 폼 입력값은 문자열이라, 산술 연산 시 "9.0" + 0.4 처럼 문자열 이어붙기가 되는 걸 방지하기 위해 숫자로 명시 변환.
  equityRatio = Number(equityRatio);
  interestRate = Number(interestRate);
  originationFee = Number(originationFee);
  loanTermMonths = Number(loanTermMonths);
  expectedSaleRate = Number(expectedSaleRate);
  const far = ZONE_FAR[zone];
  const landAreaPy = Number(area) / 3.3058;
  const grossFloorPy = landAreaPy * (far / 100);

  const usingRealData = realPricePerPy != null;
  // 국토부 실거래가는 이미 "완성된 부동산의 시세"이므로 분양가(salesPricePerPy)로 직접 사용합니다.
  // 땅값(landPricePerPy)은 분양가에서 배수를 역산해 추정합니다 (가정치 사용 시와 동일한 배수 논리).
  const priceMultiplier = 1.7 + seededRand(seed, 2) * 0.9; // ⚠️ 근거 없는 임의 배수(1.7~2.6배). 실제 원가율 데이터 없음.
  const landPricePerPy = usingRealData ? realPricePerPy / priceMultiplier : 900 + Math.floor(seededRand(seed, 1) * 2200); // 만원/평
  const salesPricePerPy = usingRealData ? realPricePerPy : landPricePerPy * priceMultiplier;

  // 공사비: 사용자가 평당 공사비를 직접 입력하면 그 값을, 아니면 고정 기본값(랜덤 아님)을 사용
  const constructionCostPerPyUser = Number(constructionCostPerPyInput);
  const constructionCostPerPy = constructionCostPerPyUser > 0 ? constructionCostPerPyUser : DEFAULT_CONSTRUCTION_COST_PER_PY;
  const constructionCostSource = constructionCostPerPyUser > 0 ? "사용자 입력값" : "기본값(근거 없음, 미입력)";

  // 토지매입비: 사용자가 총액을 직접 입력하면 그 값을, 아니면 평당 토지가 기반 자동계산값을 사용
  const landCostOverrideNum = Number(landCostOverride);
  const landCost = landCostOverrideNum > 0 ? landCostOverrideNum : landAreaPy * landPricePerPy;
  const landCostSource = landCostOverrideNum > 0 ? "사용자 입력값(총액)" : (usingRealData ? "국토교통부 실거래가 역산" : "가정치(근거 없음, 미입력)");
  const constructionCost = grossFloorPy * constructionCostPerPy;

  // 소프트코스트: "비율" 모드(%) 또는 "항목별" 모드(철거비/설계비/감리비/분양마케팅비/부담금/예비비/기타 직접입력) 중 선택
  // ※ "금융비"는 여기 포함하지 않습니다 — 아래에서 실제 대출조건 기반으로 별도 계산되는
  //   financeCost와 중복 계상되는 것을 막기 위함입니다.
  let generalCost, generalCostSource;
  if (softCostMode === "itemized") {
    generalCost = (Number(demolitionCost) || 0) + (Number(designFee) || 0) + (Number(supervisionFee) || 0)
      + (Number(salesCost) || 0) + (Number(leviesCost) || 0) + (Number(contingency) || 0) + (Number(miscCost) || 0);
    generalCostSource = "사용자 입력값(철거비+설계비+감리비+분양마케팅비+부담금+예비비+기타 합산)";
  } else {
    const ratioUser = Number(softCostRatioInput);
    const ratio = ratioUser > 0 ? ratioUser / 100 : DEFAULT_SOFT_COST_RATIO;
    generalCost = (landCost + constructionCost) * ratio;
    generalCostSource = ratioUser > 0 ? "사용자 입력 비율" : "기본값 15%(근거 없음, 미입력)";
  }
  const baseCost = landCost + constructionCost + generalCost; // 금융비용 제외 원가

  // ---- 대출금액·금융비용 순환참조를 대수적으로 정확히 해결 ----
  // loanAmount = (baseCost + financeCost) * (1 - equityRatio)
  // financeCost = loanAmount * r,  r = 대출금리 연율 환산 + 취급수수료(대출기간 동안 1회)
  // => loanAmount = baseCost*(1-er) / (1 - r*(1-er))
  const er = equityRatio / 100;
  const years = loanTermMonths / 12;
  const r = (interestRate / 100) * years + originationFee / 100; // 대출기간 전체 동안의 금융비용률
  const loanDenominator = 1 - r * (1 - er);
  // 금리·대출기간 조합이 너무 크면(예: 고금리+장기) 분모가 0 이하로 떨어져 대출금액이
  // 음수·무한대로 발산합니다 — 이 경우 계산을 강행하지 않고 "대출구조 성립 불가"로 처리합니다.
  const financialModelInvalid = loanDenominator <= 0.05;
  const calcLoanAmount = financialModelInvalid ? baseCost * (1 - er) : (baseCost * (1 - er)) / loanDenominator;
  const calcFinanceCost = calcLoanAmount * r;
  const calcTotalCost = baseCost + calcFinanceCost;

  // 총사업비 직접입력 시 자동계산보다 우선 적용. 이 경우 대출금액·금융비용은 총사업비 기준으로 역산합니다.
  const totalCostOverrideNum = Number(totalCostOverride);
  const usingTotalCostOverride = totalCostOverrideNum > 0;
  const totalCost = usingTotalCostOverride ? totalCostOverrideNum : calcTotalCost;
  const loanAmount = usingTotalCostOverride ? totalCost * (1 - er) : calcLoanAmount;
  const financeCost = usingTotalCostOverride ? totalCost - baseCost : calcFinanceCost; // 직접입력 시 역산된 값(음수 가능 — 총사업비를 원가보다 낮게 입력한 경우)
  const equityAmount = totalCost - loanAmount;
  const totalCostSource = usingTotalCostOverride ? "사용자 입력값(우선 적용)" : "자동 계산(토지비+공사비+소프트비용+금융비용)";

  const salesRevenue = grossFloorPy * salesPricePerPy;
  const profit = salesRevenue - totalCost;
  const margin = (profit / totalCost) * 100;

  // LTV: 대출금액 ÷ 준공후 예상 자산가치(분양수입으로 근사)
  const ltv = (loanAmount / salesRevenue) * 100;
  // DSCR: 연환산 사업이익 ÷ 연간 이자비용 (수수료 제외, 순수 이자상환 여력)
  const annualProfit = profit / years;
  const annualInterest = loanAmount * (interestRate / 100);
  const dscr = (annualProfit / annualInterest).toFixed(2);
  const allInCost = allInCostRate(interestRate, originationFee, loanTermMonths);

  // 채점 기준(카테고리 가중치·항목별 배점·컷오프)은 전부 ../lib/scoring 모듈 소관입니다.
  // 여기서는 그 모듈이 요구하는 입력값(ctx)만 조립합니다.
  const scoreModel = computeScoreModel({
    ltv, dscr, equityRatio, equityRatioIsDefault: equityRatio === PLACEHOLDER_DEFAULTS.equityRatio, allInCost,
    expectedSaleRate, expectedSaleRateIsDefault: Number(expectedSaleRate) === PLACEHOLDER_DEFAULTS.expectedSaleRate,
    usingRealData, compsCount,
    locationTier, locationTierIsDefault: locationTier === PLACEHOLDER_DEFAULTS.locationTier,
    supplyCompetition, supplyCompetitionIsDefault: supplyCompetition === PLACEHOLDER_DEFAULTS.supplyCompetition,
    creditEnhancement, creditEnhancementIsDefault: creditEnhancement === PLACEHOLDER_DEFAULTS.creditEnhancement,
    projectType, permitStage,
    developerTrack, developerTrackIsDefault: developerTrack === PLACEHOLDER_DEFAULTS.developerTrack,
    contractorGrade, contractorGradeIsDefault: contractorGrade === PLACEHOLDER_DEFAULTS.contractorGrade,
    financialModelInvalid, profit,
  });
  // 담보가치는 신규 4카테고리 채점 항목에는 포함되지 않지만(사용자 지시 목록에 없음), 참고용으로 남겨둡니다.
  const collateralRef = collateralTier(ltv);

  return {
    landAreaPy, grossFloorPy, landPricePerPy, salesPricePerPy, constructionCostPerPy, constructionCostSource, landCostSource,
    landCost, constructionCost, generalCost, generalCostSource, financeCost, totalCost, totalCostSource,
    usingTotalCostOverride, loanAmount, equityAmount,
    salesRevenue, profit, margin, ltv, dscr, allInCost, interestRate, originationFee, loanTermMonths,
    equityRatio, expectedSaleRate, scoreModel, collateralRef,
    grade: scoreModel.grade, gradeNote: scoreModel.gradeNote,
    gradeColor: scoreModel.gradeColor, gradeBand: scoreModel.gradeBand, far, usingRealData,
    financialModelInvalid,
  };
}
