import React, { useState, useRef } from "react";
import { Building2, MapPin, FileDown, Loader2, ShieldCheck } from "lucide-react";
import { fetchTrades, geocodeToPnu, fetchLandCharacteristics } from "../lib/realDataFetcher";
import * as XLSX from "xlsx";
import { addressToLawdCd, recentDealYmd, LAWD_CODES, AMBIGUOUS_GU, splitCityHint } from "../lib/lawdCodes";
import {
  SCORING_MODEL_VERSION, TIER_COLOR, computeScoreModel,
  DEVELOPER_OPTIONS, CONTRACTOR_OPTIONS, LOCATION_OPTIONS, PERMIT_OPTIONS, SUPPLY_OPTIONS,
  CREDIT_ENHANCEMENT_OPTIONS, topRiskItems, topStrengthItems,
} from "../lib/scoring";
import { saveAnalysisResult, buildAnalysisRecord, loadAnalysisHistory, deleteAnalysisResult } from "../lib/analysisStorage";
import { runAnalysis, ZONE_FAR, PLACEHOLDER_DEFAULTS, allInCostRate } from "../lib/analysis";
import { loadCaseComparisons } from "../lib/pfCases";

const OUTCOME_LABEL = { success: "성공", delayed: "지연", default: "부도", unknown: "미확정" };
const VERDICT_COLOR = { 일치: "#8AB89A", 불일치: "#D98C7A", 판정보류: "#9A9E9F", "계산 실패": "#D98C7A" };

// 최종 심사의견 — 새 판정 로직이 아니라 기존 gradeBand(5단계)를 4개 실무 용어로 매핑만 함.
// speculative·weak는 GRADE_META 자체가 이미 "투기적"·"고위험 재검토 권고"로 구분해뒀으므로 둘 다 "재검토"로,
// default(D, "심사 불가")만 별도로 "부결 권고"로 분리.
const DECISION_LABEL = {
  high: "승인 권고",
  good: "조건부 승인",
  speculative: "재검토",
  weak: "재검토",
  default: "부결 권고",
};
const DECISION_BAND_REASON = {
  high: "핵심 지표가 전반적으로 우수해 표준 심사 절차로 진행할 수 있습니다.",
  good: "전반적으로 양호하나, 일부 리스크 항목에 대한 보완자료 확보 후 진행을 권고합니다.",
  speculative: "투기적 등급 구간으로, 조달구조·분양전략에 대한 보완 없이는 승인이 어려울 수 있습니다.",
  weak: "고위험 등급 구간으로, 사업 구조 전반에 대한 재검토가 필요합니다.",
  default: "사업수지 또는 리스크 스코어가 기준선에 크게 미달해 부결 또는 전면 재구조화가 필요합니다.",
};
/** 하드게이트가 걸린 원인이 "실제로 나쁜 입력값"이 아니라 "고급설정 미입력(기본값)"뿐인지 판단.
 * 새 판정 로직이 아니라 각 항목에 이미 있는 source("기본값(미입력)" vs "사용자 입력값")를 재활용. */
function gateIsOnlyDueToDefaults(result) {
  if (!result.scoreModel.gateApplied) return false;
  const stabilityCore = result.scoreModel.categories.find((c) => c.key === "stability").items
    .filter((i) => i.key === "developerTrack" || i.key === "contractorGrade" || i.key === "creditEnhancement");
  const financialItems = result.scoreModel.categories.find((c) => c.key === "financial").items;
  const riskyItems = [...stabilityCore, ...financialItems].filter((i) => i.tier === "위험");
  if (riskyItems.length === 0) return false;
  return riskyItems.every((i) => i.source.includes("기본값"));
}

const DECISION_GATE_REASON = {
  financial: "금융 안정성 항목 중 2개 이상이 위험 등급으로 판정되어 등급이 제한되었습니다.",
  stability: "인허가·시행사·시공사 항목 중 2개 이상이 위험 등급으로 판정되어 등급이 제한되었습니다.",
  both: "금융 안정성과 사업 진행 리스크가 동시에 위험 수준으로 판정되어 등급이 제한되었습니다.",
};
/** 최종 심사의견의 2~3줄 근거 — 전부 기존 등급·게이트 결과를 문장으로 재구성한 것이며 새 판단을 만들지 않음. */
function buildDecisionReason(result) {
  const gateSentence = DECISION_GATE_REASON[result.scoreModel.gateApplied] || "";
  const bandSentence = DECISION_BAND_REASON[result.gradeBand];
  return `${gateSentence ? gateSentence + " " : ""}${bandSentence} (종합점수 ${result.scoreModel.totalScore.toFixed(1)}/100, 등급 ${result.grade})`;
}

// 사업유형별로 어떤 실거래가 데이터셋을 조회할지
// LAWD_CD(5자리) -> 사람이 읽을 지역명. 주소 입력 즉시(네트워크 호출 없이) 어느 시군구로
// 인식됐는지 보여주기 위한 역방향 조회 테이블 — addressToLawdCd 내부 로직은 건드리지 않고
// 이미 export된 LAWD_CODES/AMBIGUOUS_GU만 재구성합니다.
const CODE_TO_REGION = {
  ...Object.fromEntries(Object.entries(LAWD_CODES).map(([name, code]) => [code, name])),
  ...Object.fromEntries(AMBIGUOUS_GU.flatMap(([name, cityMap]) => cityMap.map(([city, code]) => [code, `${city} ${name}`]))),
};

const PROJECT_TYPE_TRADES = {
  "재건축": ["aptDev"],
  "재개발": ["rowHouse", "singleHouse", "land"],
  "신축개발": ["land", "officetel"],
};

/**
 * 실거래가 items에서 평당가(만원/평) 평균과, 개별 거래 목록(comps)을 함께 계산.
 * "토지매매(land)"는 완성된 부동산이 아니라 대지 자체의 거래가라 아파트/오피스텔 등
 * 완성품 거래가와 평당가 수준이 전혀 다릅니다(수백만원대 vs 수천만원대). 하나의 평균에
 * 섞으면(예: 신축개발=land+officetel 동시조회) 분양가 추정치가 토지가 쪽으로 끌려
 * 내려가 실제로는 완판된 사업도 "분양가 < 공사비"로 계산돼 적자로 나오는 버그가 있었습니다.
 * → land는 별도 평균(landAvgPricePerPy, 토지매입비 추정용)으로 분리하고, 분양가에는
 *   완성품 거래유형(officetel/apt/aptDev 등)의 평균만 사용합니다.
 */
function summarizeTrades(tradeResults) {
  const landComps = [];
  const productComps = [];
  for (const r of tradeResults) {
    if (!r || r.error || !r.items) continue;
    const bucket = r.type === "land" ? landComps : productComps;
    for (const item of r.items) {
      const amount = Number(String(item.dealAmount || "").replace(/,/g, ""));
      const area = Number(item.area);
      if (amount > 0 && area > 0) {
        const py = area / 3.3058;
        bucket.push({
          name: item.name || "이름 미상",
          dealAmount: amount, // 만원
          area,
          py,
          pricePerPy: amount / py, // 만원/평
          dealYear: item.dealYear, dealMonth: item.dealMonth, dealDay: item.dealDay,
        });
      }
    }
  }
  const avgOf = (arr) => (arr.length === 0 ? null : arr.reduce((a, c) => a + c.pricePerPy, 0) / arr.length);
  const comps = [...productComps, ...landComps];
  if (comps.length === 0) return { avgPricePerPy: null, landAvgPricePerPy: null, comps: [] };
  // 완성품 비교사례가 있으면 그것만으로 분양가를 추정하고, 없으면(예: 재개발처럼 완성품 유형을
  // 조회하지 않는 사업유형) 부득이 토지가 평균으로 대체합니다.
  return { avgPricePerPy: avgOf(productComps) ?? avgOf(landComps), landAvgPricePerPy: avgOf(landComps), comps };
}

/** 실데이터 조회를 시도하고, 성공하면 평당가+거래목록을, 실패하면 null과 사유를 반환 */
async function tryFetchRealPrice(form) {
  // vite.config.js의 /api/molit, /api/vworld 프록시는 `vite dev` 전용 기능이라 프로덕션
  // 빌드(정적 호스팅)에서는 항상 실패합니다. 혼란스러운 네트워크 에러 대신 사유를 명확히 안내합니다.
  if (!import.meta.env.DEV) {
    return { price: null, landPrice: null, comps: [], reason: "실거래가 연동은 로컬 개발 서버(npm run dev)에서만 지원됩니다. 배포 환경에서는 프록시가 없어 항상 가정치로 표시됩니다." };
  }
  const lawdCd = addressToLawdCd(form.address);
  if (!lawdCd) {
    return { price: null, landPrice: null, comps: [], reason: "주소에서 구/군을 인식하지 못했습니다." };
  }
  const types = PROJECT_TYPE_TRADES[form.projectType] || ["land"];
  try {
    const results = await fetchTrades(types, { lawdCd, dealYmd: recentDealYmd() });
    const failed = results.filter((r) => r.error);
    const { avgPricePerPy, landAvgPricePerPy, comps } = summarizeTrades(results);
    if (avgPricePerPy == null) {
      return { price: null, landPrice: null, comps: [], reason: failed[0]?.error || "해당 지역·기간의 실거래 데이터가 없습니다." };
    }
    return { price: avgPricePerPy, landPrice: landAvgPricePerPy, comps, reason: null };
  } catch (e) {
    return { price: null, landPrice: null, comps: [], reason: e.message || "실거래가 API 호출 실패" };
  }
}
const fmt = (n) => Math.round(n).toLocaleString("ko-KR");

// 사업수지/DSCR 색상 판정 — TIER_COLOR(우수/위험)와 동일한 색을 여러 곳에서 매직 hex로
// 중복 하드코딩하던 것을 하나로 모음(값 자체는 동일, 표시 결과 변화 없음).
/** @param {number} profit */
const profitColor = (profit) => (profit > 0 ? TIER_COLOR.우수 : TIER_COLOR.위험);
/** @param {number | null} dscr */
const dscrColor = (dscr) => (dscr != null && dscr < 1 ? TIER_COLOR.위험 : "#332818");

/**
 * 분양률 스트레스 테스트: 다른 조건(대출금액·금리·기간·총사업비)은 고정한 채,
 * 실현 분양수입만 saleRatePct% 로 가정해 재계산합니다.
 * ⚠️ 단순화 가정: 미분양분은 수입 0으로 처리(실제로는 할인분양·준공후 임대전환 등으로
 * 일부 회수 가능하나, 여기서는 보수적으로 반영하지 않았습니다).
 */
function stressTestRow(result, saleRatePct) {
  const revenue = result.grossFloorPy * result.salesPricePerPy * (saleRatePct / 100);
  const profit = revenue - result.totalCost;
  const margin = (profit / result.totalCost) * 100;
  const years = result.loanTermMonths / 12;
  const annualProfit = profit / years;
  const annualInterest = result.loanAmount * (result.interestRate / 100);
  const dscr = annualInterest > 0 ? annualProfit / annualInterest : null;
  return { saleRatePct, revenue, profit, margin, dscr };
}

/**
 * 금리 상승 스트레스 테스트: 대출금액·분양수입·대출기간은 고정한 채 대출금리만
 * +deltaPct%p 올렸을 때의 금융비용·사업수지·DSCR을 재계산합니다.
 * ⚠️ 단순화 가정: 금리가 오르면 실제로는 총사업비(금융비용)가 늘어 대출금액도 함께
 * 재산정되어야 하지만(순환참조), 여기서는 "동일한 대출금액을 그 금리로 그대로 썼다면"을
 * 가정한 민감도 테스트입니다. 취급수수료율은 원래 조건과 동일하다고 가정합니다.
 *
 * 금융비용은 result.financeCost를 절대공식(대출금액×금리)으로 다시 계산하지 않고
 * "금리 변동 배율"(rNew/rOld)을 곱해 구합니다 — "총사업비 직접입력" 모드에서는
 * result.financeCost가 공식값이 아니라 totalCost−baseCost의 잔차값이라, 절대공식으로
 * 다시 계산하면 delta=0(현재 금리)에서도 리포트 본문 숫자와 어긋나기 때문입니다.
 */
function interestRateStressRow(result, deltaPct) {
  const newRate = result.interestRate + deltaPct;
  const years = result.loanTermMonths / 12;
  const baseCost = result.totalCost - result.financeCost; // 토지비+공사비+일반관리비(금융비용 제외)
  const rOld = (result.interestRate / 100) * years + result.originationFee / 100;
  const rNew = (newRate / 100) * years + result.originationFee / 100;
  const financeCost = rOld > 0 ? result.financeCost * (rNew / rOld) : result.loanAmount * rNew;
  const totalCost = baseCost + financeCost;
  const profit = result.salesRevenue - totalCost;
  const margin = (profit / totalCost) * 100;
  const annualProfit = profit / years;
  const annualInterest = result.loanAmount * (newRate / 100);
  const dscr = annualInterest > 0 ? annualProfit / annualInterest : null;
  return { newRate, deltaPct, totalCost, profit, margin, dscr };
}

/**
 * 공사비 상승 스트레스 테스트: 대출금액·금리·분양수입은 고정한 채 공사비만
 * +overrunPct% 올렸을 때의 총사업비·사업수지·DSCR을 재계산합니다.
 * ⚠️ 단순화 가정: 실제로는 공사비가 늘면 필요 대출금액도 함께 늘어나야 하지만(순환참조),
 * 여기서는 "동일한 대출금액으로 늘어난 공사비를 그대로 흡수했다면(초과분은 사업수지 악화로
 * 귀결)"을 가정한 민감도 테스트입니다. 소프트비용이 공사비 비율로 연동된 경우(비율 모드)라도
 * 여기서는 소프트비용은 재계산하지 않습니다(보수적으로 낮게 잡힐 수 있음에 유의).
 */
function costOverrunStressRow(result, overrunPct) {
  const extraCost = result.constructionCost * (overrunPct / 100);
  const totalCost = result.totalCost + extraCost;
  const profit = result.salesRevenue - totalCost;
  const margin = (profit / totalCost) * 100;
  const years = result.loanTermMonths / 12;
  const annualProfit = profit / years;
  const annualInterest = result.loanAmount * (result.interestRate / 100);
  const dscr = annualInterest > 0 ? annualProfit / annualInterest : null;
  return { overrunPct, extraCost, totalCost, profit, margin, dscr };
}

/**
 * 스트레스 시나리오 4종(기본/금리+3%p/공사비+10%/분양률-10%)을 한 표로 비교하기 위해
 * 기존 스트레스 함수(stressTestRow 등)의 결과를 가져와 재무 4항목만 재계산하고
 * computeScoreModel에 그대로 넣어 시나리오별 등급까지 재산정합니다. 스트레스 계산
 * 로직도, 채점 로직도 전혀 새로 만들지 않고 기존 함수를 조합만 합니다.
 */
function buildStressComparison(form, result, compsCount) {
  const sharedCtx = {
    equityRatio: Number(form.equityRatio),
    equityRatioIsDefault: Number(form.equityRatio) === PLACEHOLDER_DEFAULTS.equityRatio,
    usingRealData: result.usingRealData, compsCount,
    locationTier: form.locationTier, locationTierIsDefault: form.locationTier === PLACEHOLDER_DEFAULTS.locationTier,
    supplyCompetition: form.supplyCompetition, supplyCompetitionIsDefault: form.supplyCompetition === PLACEHOLDER_DEFAULTS.supplyCompetition,
    creditEnhancement: form.creditEnhancement, creditEnhancementIsDefault: form.creditEnhancement === PLACEHOLDER_DEFAULTS.creditEnhancement,
    projectType: form.projectType, permitStage: form.permitStage,
    developerTrack: form.developerTrack, developerTrackIsDefault: form.developerTrack === PLACEHOLDER_DEFAULTS.developerTrack,
    contractorGrade: form.contractorGrade, contractorGradeIsDefault: form.contractorGrade === PLACEHOLDER_DEFAULTS.contractorGrade,
    financialModelInvalid: result.financialModelInvalid,
  };
  const expectedSaleRateIsDefault = Number(result.expectedSaleRate) === PLACEHOLDER_DEFAULTS.expectedSaleRate;
  const gradeOf = (over) => computeScoreModel({ ...sharedCtx, ...over });

  const base = gradeOf({
    ltv: result.ltv, dscr: Number(result.dscr), allInCost: result.allInCost, profit: result.profit,
    expectedSaleRate: result.expectedSaleRate, expectedSaleRateIsDefault,
  });

  const rateRow = interestRateStressRow(result, 3);
  const rateModel = gradeOf({
    ltv: result.ltv, dscr: rateRow.dscr ?? 0,
    allInCost: allInCostRate(result.interestRate + 3, result.originationFee, result.loanTermMonths),
    profit: rateRow.profit, expectedSaleRate: result.expectedSaleRate, expectedSaleRateIsDefault,
  });

  const costRow = costOverrunStressRow(result, 10);
  const costModel = gradeOf({
    ltv: result.ltv, dscr: costRow.dscr ?? 0, allInCost: result.allInCost, profit: costRow.profit,
    expectedSaleRate: result.expectedSaleRate, expectedSaleRateIsDefault,
  });

  const saleRatePct = Math.max(0, Math.round(result.expectedSaleRate) - 10);
  const saleRow = stressTestRow(result, saleRatePct);
  const saleModel = gradeOf({
    ltv: saleRow.revenue > 0 ? (result.loanAmount / saleRow.revenue) * 100 : result.ltv,
    dscr: saleRow.dscr ?? 0, allInCost: result.allInCost, profit: saleRow.profit,
    expectedSaleRate: saleRatePct, expectedSaleRateIsDefault: false,
  });

  return [
    { key: "base", label: "기본(현재 가정)", model: base, profit: result.profit, margin: result.margin, dscr: Number(result.dscr), highlight: true },
    { key: "rate", label: "금리 +3%p", model: rateModel, profit: rateRow.profit, margin: rateRow.margin, dscr: rateRow.dscr },
    { key: "cost", label: "공사비 +10%", model: costModel, profit: costRow.profit, margin: costRow.margin, dscr: costRow.dscr },
    { key: "sale", label: `분양률 ${saleRatePct}%(-10%p)`, model: saleModel, profit: saleRow.profit, margin: saleRow.margin, dscr: saleRow.dscr },
  ];
}

/**
 * "시장성 분석" 섹션용 요약 — 새 채점 로직이 아니라, 이미 scoring 모듈이 산정해 둔
 * 입지(locationBase)·공급경쟁(supplyCompetition)·예상분양률(expectedSaleRate)·주변실거래(comps)
 * 항목의 tier/detail/reason을 그대로 모아 시장 관점 문장으로 재구성만 합니다.
 * ⚠️ 여기서 만드는 "분양 경쟁력"/"공급 리스크"/"시장 종합 평가"는 표시용 라벨일 뿐,
 * scoreModel의 배점에는 전혀 반영되지 않습니다(채점 엔진은 건드리지 않음).
 */
function buildMarketAnalysis(scoreModel) {
  const flat = scoreModel.categories.flatMap((c) => c.items);
  const find = (key) => flat.find((i) => i.key === key);
  const location = find("locationBase");
  const supply = find("supplyCompetition");
  const saleRate = find("expectedSaleRate");
  const comps = find("comps");

  const salesCompetitiveness =
    location.tier === "위험" || saleRate.tier === "위험" ? "취약"
    : location.tier === "우수" && saleRate.tier === "우수" ? "우수"
    : "보통";
  const supplyRiskLabel = supply.tier === "우수" ? "낮음" : supply.tier === "보통" ? "보통" : "높음";

  const items = [location, supply, saleRate, comps];
  const overallTier = items.some((i) => i.tier === "위험") ? "위험" : items.every((i) => i.tier === "우수") ? "우수" : "보통";
  const overallNote =
    overallTier === "우수" ? "시장성 측면에서 특별한 우려 요인이 없습니다."
    : overallTier === "위험" ? "시장성 측면에서 리스크 요인이 확인되어 보완자료 확보가 필요합니다."
    : "시장성은 대체로 무난한 수준이나 일부 보완이 필요합니다.";

  const opinion = [
    `입지는 "${location.detail}"(${location.tier}) 수준이며, ${comps.reason}`,
    `예상 분양률 ${saleRate.detail}(${saleRate.tier})과 입지를 종합하면 분양 경쟁력은 "${salesCompetitiveness}" 수준으로 판단됩니다.`,
    `공급 경쟁 현황은 "${supply.detail}"(${supply.tier})로, 공급 리스크는 "${supplyRiskLabel}" 수준입니다.`,
    overallNote,
  ].join(" ");

  return { location, supply, saleRate, comps, salesCompetitiveness, supplyRiskLabel, overallTier, opinion };
}

/** 숫자 입력 필드가 비정상(비어있음/음수/문자 등)이면 그대로 두지 않고 사유를 모아 반환 —
 * 검증 없이 진행하면 리포트 전체 수치가 조용히 NaN으로 깨집니다. */
function validateForm(f) {
  const errors = [];
  const check = (value, label, { min = -Infinity, max = Infinity } = {}) => {
    const n = Number(value);
    if (value === "" || !Number.isFinite(n)) {
      errors.push(`${label}: 숫자를 입력해주세요.`);
    } else if (n < min || n > max) {
      errors.push(`${label}: ${min}~${max} 사이의 값을 입력해주세요.`);
    }
  };
  check(f.area, "대지면적", { min: 1, max: 1000000 });
  check(f.equityRatio, "자기자본비율", { min: 0, max: 100 });
  check(f.loanTermMonths, "대출기간", { min: 1, max: 360 });
  check(f.expectedSaleRate, "예상 분양률", { min: 0, max: 100 });
  check(f.interestRate, "대출금리", { min: 0, max: 50 });
  check(f.originationFee, "취급수수료", { min: 0, max: 20 });
  return errors;
}

/**
 * 핵심 리스크 TOP3·핵심 강점 TOP2·리스크 분석 3곳에서 동일하게 쓰이던 채점항목 1건
 * 렌더링을 하나로 모음(마크업/스타일 변화 없음).
 * @param {{ item: { key: string, categoryName: string, name: string, tier: string, score: number, maxPoints: number, reason: string } }} props
 */
function ScoreItemRow({ item }) {
  return (
    <div style={{ padding: "7px 0", borderBottom: "1px solid #8F8770" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{item.categoryName} · {item.name}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: TIER_COLOR[item.tier], whiteSpace: "nowrap" }}>{item.tier} ({item.score.toFixed(1)}/{item.maxPoints})</div>
      </div>
      <div style={{ fontSize: 12, color: "#332818", marginTop: 2 }}>{item.reason}</div>
    </div>
  );
}

/**
 * 분양률/금리/공사비 3개 스트레스 테스트 표가 열 구조는 동일하고 시나리오·라벨·둘째 컬럼 값만
 * 다르던 것을 하나로 모음(각 표의 렌더링 결과·스타일은 이전과 동일).
 * @param {{
 *   title: string, warning: string, scenarioLabel: string, col2Label: string, topMargin?: number,
 *   rows: Array<{ key: string|number, label: string, highlight: boolean, col2Value: number,
 *     profit: number, margin: number, dscr: number|null }>,
 * }} props
 */
function StressTestTable({ title, warning, scenarioLabel, col2Label, rows, topMargin = 28 }) {
  return (
    <>
      <h2 style={{ fontSize: 15, marginTop: topMargin, marginBottom: 4, color: "#1F1C14" }}>{title}</h2>
      <div style={{ fontSize: 11, color: "#3D3826", marginBottom: 8 }}>{warning}</div>
      <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse", marginBottom: 20 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #7A7058", fontWeight: 600, color: "#332F24" }}>
            <td style={{ padding: "6px 4px" }}>{scenarioLabel}</td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>{col2Label}</td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>사업수지</td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>수익률</td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>DSCR</td>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={{ borderBottom: "1px solid #8F8770", background: r.highlight ? "#F1EEE5" : "transparent" }}>
              <td style={{ padding: "6px 4px" }}>{r.label}</td>
              <td style={{ padding: "6px 4px", textAlign: "right" }}>{fmt(r.col2Value)}만원</td>
              <td style={{ padding: "6px 4px", textAlign: "right", color: profitColor(r.profit) }}>{fmt(r.profit)}만원</td>
              <td style={{ padding: "6px 4px", textAlign: "right" }}>{r.margin.toFixed(1)}%</td>
              <td style={{ padding: "6px 4px", textAlign: "right", color: dscrColor(r.dscr) }}>{r.dscr != null ? r.dscr.toFixed(2) + "x" : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** buildStressComparison() 결과를 시나리오별 등급까지 한 표로 보여준다(아래 개별 스트레스 표 3종과 별개, 요약용). */
function StressComparisonTable({ rows }) {
  return (
    <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse", marginBottom: 20 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #7A7058", fontWeight: 600, color: "#332F24" }}>
          <td style={{ padding: "6px 4px" }}>시나리오</td>
          <td style={{ padding: "6px 4px", textAlign: "right" }}>사업수지</td>
          <td style={{ padding: "6px 4px", textAlign: "right" }}>수익률</td>
          <td style={{ padding: "6px 4px", textAlign: "right" }}>DSCR</td>
          <td style={{ padding: "6px 4px", textAlign: "center" }}>등급</td>
          <td style={{ padding: "6px 4px", textAlign: "right" }}>종합점수</td>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} style={{ borderBottom: "1px solid #8F8770", background: r.highlight ? "#F1EEE5" : "transparent" }}>
            <td style={{ padding: "6px 4px" }}>{r.label}</td>
            <td style={{ padding: "6px 4px", textAlign: "right", color: profitColor(r.profit) }}>{fmt(r.profit)}만원</td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>{r.margin.toFixed(1)}%</td>
            <td style={{ padding: "6px 4px", textAlign: "right", color: dscrColor(r.dscr) }}>{r.dscr != null ? r.dscr.toFixed(2) + "x" : "-"}</td>
            <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: 600, color: r.model.gradeColor }}>{r.model.grade}</td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>{r.model.totalScore.toFixed(1)}/100</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PFReportMVP() {
  const [form, setForm] = useState({
    address: "서울특별시 성동구 성수동1가 685",
    area: "1200",
    zone: "제3종일반주거지역",
    projectType: "재건축",
    lender: "부동산신탁사",
    permitStage: "진행 중",
    loanTermMonths: "27",
    totalCostOverride: "", // 총사업비 직접입력(만원) - 비우면 자동계산
    landCostOverride: "", // 토지매입비 직접입력(만원, 총액) - 비우면 평당 토지가 기반 자동계산
    constructionCostPerPyInput: "", // 평당 공사비 직접입력(만원) - 비우면 기본값(900)
    softCostMode: "ratio", // "ratio"(비율%) | "itemized"(항목별 직접입력)
    softCostRatioInput: "", // 비우면 기본값 15%
    demolitionCost: "", designFee: "", supervisionFee: "", salesCost: "", leviesCost: "", contingency: "", miscCost: "", // 항목별 소프트코스트(만원)
    ...PLACEHOLDER_DEFAULTS, // 근거 없는 자리표시자 값 — 위 상수 정의부 주석 참고
  });
  const [stage, setStage] = useState("idle"); // idle | running | done
  const [result, setResult] = useState(null);
  const [step, setStep] = useState(0);
  const [dataNote, setDataNote] = useState(null); // 실데이터 사용 여부/실패 사유 안내
  const [comps, setComps] = useState([]); // 인근 실거래 비교(comps) - 실제 API에서 받은 원본 거래 목록
  const [expanded, setExpanded] = useState(true); // 전체 리포트 펼침 여부 (기본: 바로 전체 표시)
  const [showAdvanced, setShowAdvanced] = useState(false); // 고급 설정(시행사실적 등 직접입력) 펼침 여부
  const [vworldStatus, setVworldStatus] = useState(null); // null | "loading" | { ok: true, ... } | { ok: false, reason }
  const [formErrors, setFormErrors] = useState([]); // 실행 전 입력값 검증 오류 목록
  const [showHistory, setShowHistory] = useState(false); // 분석 이력 패널 펼침 여부
  const [showCaseValidation, setShowCaseValidation] = useState(false); // PF 사례 검증 패널 펼침 여부
  const [caseComparisons, setCaseComparisons] = useState(null); // 첫 오픈 시 1회만 계산해 캐시
  const [historyList, setHistoryList] = useState(() => loadAnalysisHistory()); // localStorage 이력 캐시(삭제/저장 시마다 갱신)
  const [historySearch, setHistorySearch] = useState(""); // 이력 목록 주소 검색어
  const market = result ? buildMarketAnalysis(result.scoreModel) : null; // "3. 시장성 분석" 섹션용 파생값(채점 재사용, 새 계산 없음)
  const filteredHistory = historyList
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => !historySearch || (record.input?.address || "").includes(historySearch))
    .reverse(); // 최신 항목이 위로 오도록(원본 배열의 index는 삭제 시 그대로 사용)

  const lastLookupAddressRef = useRef(""); // 주소 입력란에서 벗어날 때 같은 주소로 중복 조회하지 않기 위한 기억값

  const handleVworldLookup = async () => {
    setVworldStatus("loading");
    try {
      const pnu = await geocodeToPnu(form.address);
      if (!pnu) throw new Error("주소에서 PNU를 찾지 못했습니다.");
      const info = await fetchLandCharacteristics(pnu);
      setVworldStatus({ ok: true, ...info });
      // 조회된 용도지역명이 우리 목록(ZONE_FAR)에 정확히 있는 경우에만 자동 반영. 다르면 사용자가 직접 선택.
      if (info.zone && ZONE_FAR[info.zone] != null) {
        setForm((f) => ({ ...f, zone: info.zone }));
      }
    } catch (e) {
      setVworldStatus({ ok: false, reason: e.message || "브이월드 조회 실패" });
    }
  };

  // 주소 입력란에서 포커스가 벗어날 때 자동 조회(별도 버튼 없음). 같은 주소로 이미 성공 조회했다면
  // 다시 부르지 않되, 실패했던 주소는 재시도할 수 있게 그대로 다시 부른다.
  const handleAddressBlur = () => {
    const addr = form.address.trim();
    if (!addr || vworldStatus === "loading") return;
    if (addr === lastLookupAddressRef.current && vworldStatus?.ok) return;
    lastLookupAddressRef.current = addr;
    handleVworldLookup();
  };

  const steps = ["주소 검증 중", "실거래가 데이터 조회 중", "사업성 지표 산출 중", "리스크 스코어링 중", "심사 리포트 생성 중"];

  // formOverride: 이력에서 "재분석"할 때 setForm 직후 state가 아직 반영 안 된 상태라
  // handleRun이 옛 form을 참조하게 되므로, 그 경우 명시적으로 새 폼을 전달받아 사용합니다.
  const handleRun = async (formOverride) => {
    const activeForm = formOverride || form;
    const errors = validateForm(activeForm);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors([]);
    setStage("running");
    setStep(0);
    setDataNote(null);

    // 애니메이션과 실제 데이터 조회를 병렬로 진행
    const stepTimer = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 420);
    const [{ price: realPrice, landPrice: realLandPrice, comps: fetchedComps, reason }] = await Promise.all([
      tryFetchRealPrice(activeForm),
      new Promise((r) => setTimeout(r, steps.length * 420)),
    ]);
    clearInterval(stepTimer);
    setStep(steps.length);

    const analysisResult = runAnalysis(activeForm, realPrice, (fetchedComps || []).length, realLandPrice);
    const note = realPrice != null ? { ok: true } : { ok: false, reason };
    setResult(analysisResult);
    setDataNote(note);
    setComps(fetchedComps || []);
    setExpanded(true);
    setStage("done");
    saveAnalysisResult(buildAnalysisRecord({ form: activeForm, result: analysisResult, dataNote: note, modelVersion: SCORING_MODEL_VERSION }));
    setHistoryList(loadAnalysisHistory());
  };

  // "요약만 보기" 상태로 인쇄하면 상세 섹션이 통째로 빠진 PDF가 나가므로, 인쇄 직전 항상 전체 펼침으로
  // 전환합니다. setExpanded 직후에는 아직 DOM이 안 바뀐 상태라 페인트 한 프레임 뒤에 print를 호출합니다.
  const handleDownload = () => {
    setExpanded(true);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  // 이력에서 폼만 불러오고 재분석은 하지 않음(사용자가 값 확인/수정 후 직접 "사업성 분석 실행"을 누르게 함)
  const handleHistoryLoad = (record) => {
    setForm(record.input);
    setShowHistory(false);
  };

  // 이력에서 폼을 불러오는 동시에 즉시 재분석(setForm 직후 state가 아직 안 바뀐 상태이므로
  // handleRun에 새 폼을 명시적으로 전달)
  const handleHistoryReanalyze = (record) => {
    setForm(record.input);
    setShowHistory(false);
    handleRun(record.input);
  };

  const handleHistoryDelete = (index) => {
    deleteAnalysisResult(index);
    setHistoryList(loadAnalysisHistory());
  };

  const handleExcelExport = () => {
    if (!result) return;
    const wb = XLSX.utils.book_new();

    // 시트1: 사업 개요 + 사업성 지표
    const overviewRows = [
      ["항목", "값", "출처"],
      ["주소", form.address, "사용자 입력값"],
      ["용도지역", form.zone, "사용자 입력값"],
      ["사업유형", form.projectType, "사용자 입력값"],
      ["대지면적(평)", Math.round(result.landAreaPy), "자체 계산(면적÷3.3058)"],
      ["적용 용적률(%)", result.far, "국토계획법 시행령·서울시 도시계획조례"],
      ["연면적(평)", Math.round(result.grossFloorPy), "자체 계산"],
      ["총사업비(만원)", Math.round(result.totalCost), result.totalCostSource],
      ["예상 분양수입(만원)", Math.round(result.salesRevenue), dataNote?.ok ? "국토교통부 실거래가 API" : "가정치"],
      ["사업수지(만원)", Math.round(result.profit), "자체 계산"],
      ["사업수익률(%)", result.margin.toFixed(1), "자체 계산"],
      ["PF 대출금액(만원)", Math.round(result.loanAmount), "자체 계산"],
      ["자기자본(만원)", Math.round(result.equityAmount), "자체 계산"],
      ["금융비용(만원)", Math.round(result.financeCost), "자체 계산(대출조건 기반)"],
      ["LTV(%)", result.ltv.toFixed(1), "자체 계산"],
      ["DSCR(x)", result.dscr, "자체 계산"],
      ["All-in cost(%)", result.allInCost.toFixed(1), "자체 계산"],
      ["공사비(평당, 만원)", result.constructionCostPerPy, result.constructionCostSource],
      ["토지매입비(만원)", Math.round(result.landCost), result.landCostSource],
      ["일반관리비(만원)", Math.round(result.generalCost), result.generalCostSource],
      ["종합점수", result.scoreModel.totalScore.toFixed(1), `자체 산정(4개 카테고리 가중합산, 모델 v${result.scoreModel.version})`],
      ["종합등급", result.grade, "자체 산정"],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(overviewRows);
    XLSX.utils.book_append_sheet(wb, ws1, "사업개요-사업성지표");

    // 시트2: 종합 평가항목
    const factorRows = [
      ["카테고리", "항목", "구분", "값", "점수", "등급", "출처"],
      ...result.scoreModel.categories.flatMap((cat) =>
        cat.items.map((i) => [cat.name, i.name, i.type, i.detail, `${i.score.toFixed(1)}/${i.maxPoints}`, i.tier, i.source])
      ),
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(factorRows);
    XLSX.utils.book_append_sheet(wb, ws2, "종합평가항목");

    // 시트3: 인근 실거래 비교(Comps) - 실제 데이터가 있을 때만
    if (comps.length > 0) {
      const compRows = [
        ["단지/건물명", "거래금액(만원)", "전용면적(㎡)", "평당가(만원)", "거래년", "거래월"],
        ...comps.map((c) => [c.name, c.dealAmount, c.area, Math.round(c.pricePerPy), c.dealYear, c.dealMonth]),
      ];
      const ws3 = XLSX.utils.aoa_to_sheet(compRows);
      XLSX.utils.book_append_sheet(wb, ws3, "인근실거래비교");
    }

    // 시트4: 분양률 스트레스 테스트
    const stressRows = [
      ["분양률(%)", "분양수입(만원)", "사업수지(만원)", "수익률(%)", "DSCR(x)"],
      ...[60, 80, 100].map((rate) => {
        const row = stressTestRow(result, rate);
        return [rate, Math.round(row.revenue), Math.round(row.profit), row.margin.toFixed(1), row.dscr != null ? row.dscr.toFixed(2) : "-"];
      }),
    ];
    const ws4 = XLSX.utils.aoa_to_sheet(stressRows);
    XLSX.utils.book_append_sheet(wb, ws4, "분양률스트레스테스트");

    // 시트5: 금리 상승 스트레스 테스트
    const rateStressRows = [
      ["금리(%)", "총사업비(만원)", "사업수지(만원)", "수익률(%)", "DSCR(x)"],
      ...[0, 1, 3, 5].map((delta) => {
        const row = interestRateStressRow(result, delta);
        return [row.newRate.toFixed(1), Math.round(row.totalCost), Math.round(row.profit), row.margin.toFixed(1), row.dscr != null ? row.dscr.toFixed(2) : "-"];
      }),
    ];
    const ws5 = XLSX.utils.aoa_to_sheet(rateStressRows);
    XLSX.utils.book_append_sheet(wb, ws5, "금리스트레스테스트");

    // 시트6: 공사비 상승 스트레스 테스트
    const costStressRows = [
      ["공사비 증가율(%)", "총사업비(만원)", "사업수지(만원)", "수익률(%)", "DSCR(x)"],
      ...[0, 5, 10, 15].map((overrun) => {
        const row = costOverrunStressRow(result, overrun);
        return [overrun, Math.round(row.totalCost), Math.round(row.profit), row.margin.toFixed(1), row.dscr != null ? row.dscr.toFixed(2) : "-"];
      }),
    ];
    const ws6 = XLSX.utils.aoa_to_sheet(costStressRows);
    XLSX.utils.book_append_sheet(wb, ws6, "공사비스트레스테스트");

    const safeAddr = (form.address || "report").replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
    XLSX.writeFile(wb, `PF사업성리포트_${safeAddr}.xlsx`);
  };

  return (
    <div style={{ fontFamily: "'IBM Plex Sans KR','IBM Plex Sans',sans-serif", minHeight: "100vh", background: "#12151A", color: "#E7E5DF" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@500;600;700&family=IBM+Plex+Sans+KR:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .field { display:flex; flex-direction:column; gap:2px; margin-bottom:5px; min-width:0; }
        .field label { font-size:10px; letter-spacing:0.02em; color:#9A9E9F; text-transform:uppercase; }
        .field input, .field select {
          background:#1B2027; border:1px solid #2C333B; color:#E7E5DF; padding:6px 8px;
          border-radius:4px; font-size:12.5px; font-family:inherit; outline:none; width:100%; min-width:0; box-sizing:border-box;
        }
        .field-grid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:0 8px; }
        .field-grid2 { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:0 8px; }
        .field input:focus, .field select:focus { border-color:#4C7A82; }
        .runbtn {
          width:100%; padding:13px; background:#C9A34E; color:#14171C; border:none;
          border-radius:4px; font-weight:600; font-size:14px; letter-spacing:0.02em; cursor:pointer;
          display:flex; align-items:center; justify-content:center; gap:8px;
        }
        .runbtn:disabled { opacity:0.55; cursor:default; }
        .paper {
          background:#FAF8F3; color:#000000; border-radius:0; padding:32px 36px;
          border: 1px solid #999999; box-shadow: none;
        }
        .paper h1, .paper h2 { font-family:'Source Serif 4', serif; }
        .metric-card { background:#F2F2F2; border:1px solid #CCCCCC; border-radius:0; padding:10px 14px; }
        .metric-num { font-family:'IBM Plex Mono', monospace; font-size:17px; font-weight:500; color:#000000; }
        .cover-page { page-break-after: always; }
        @media print {
          body * { visibility:hidden; }
          .paper, .paper * { visibility:visible; }
          .paper { position:absolute; top:0; left:0; width:100%; box-shadow:none; }
          .input-panel { display:none !important; }
          .app-grid { display:block !important; }
          table, .metric-card { page-break-inside: avoid; }
          h2 { page-break-after: avoid; }
        }
      `}</style>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 24px 40px" }}>
        <header style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#C9A34E", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            <Building2 size={14} /> Real Estate Decision OS — Prototype
          </div>
          <h1 style={{ fontFamily: "'Source Serif 4', serif", fontSize: 22, margin: "6px 0 4px", fontWeight: 600 }}>
            PF 사업성 심사 리포트 생성기
            <span style={{ fontSize: 11, fontWeight: 600, color: "#C9A34E", border: "1px solid #C9A34E", borderRadius: 3, padding: "2px 8px", marginLeft: 10, verticalAlign: "middle" }}>
              1차 타당성 검토용 (Quick Screening)
            </span>
          </h1>
          <p style={{ color: "#9A9E9F", fontSize: 12.5, maxWidth: 640, lineHeight: 1.5 }}>
            신탁사·캐피탈·자산운용사 심사역을 위한 MVP 데모입니다. 아래 입력값은 실제 국토부·브이월드·실거래가 API 연동 전 단계로,
            공개된 용도지역별 평균 용적률과 시세 가정을 바탕으로 한 추정 로직을 사용합니다.
          </p>
        </header>

        <div className="app-grid" style={{ display: "grid", gridTemplateColumns: "35% 65%", gap: 24 }}>
          {/* input panel */}
          <div className="input-panel" style={{ background: "#171B21", border: "1px solid #262C34", borderRadius: 6, padding: 18, alignSelf: "start" }}>
            <div className="field">
              <label><MapPin size={11} style={{ marginRight: 4 }} />주소</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} onBlur={handleAddressBlur} />
            </div>
            {form.address.trim() && (
              (() => {
                const lawdCd = addressToLawdCd(form.address);
                const regionLabel = lawdCd ? CODE_TO_REGION[lawdCd] : null;
                const hint = !regionLabel ? splitCityHint(form.address) : null;
                return (
                  <div style={{ fontSize: 11, marginBottom: 5, color: regionLabel ? "#8AB89A" : "#C98A6A" }}>
                    {regionLabel
                      ? `자동 인식: ${regionLabel} (법정동코드 ${lawdCd}) — 실거래가 조회에 사용됩니다.`
                      : hint || "구/군을 인식하지 못했습니다 — 실거래가는 가정치로 대체됩니다."}
                  </div>
                );
              })()
            )}
            {vworldStatus === "loading" && (
              <div style={{ fontSize: 11, marginBottom: 5, color: "#9A9E9F" }}>브이월드로 용도지역·공시지가 조회 중…</div>
            )}
            {vworldStatus && vworldStatus !== "loading" && (
              <div style={{ fontSize: 11, marginBottom: 5, lineHeight: 1.5, color: vworldStatus.ok ? "#8AB89A" : "#C98A6A" }}>
                {vworldStatus.ok
                  ? `조회됨(${vworldStatus.standardYear}년 기준): 용도지역 "${vworldStatus.zone}"${ZONE_FAR[vworldStatus.zone] == null ? " (목록에 없어 수동 선택 필요)" : " 자동 반영됨"} · 개별공시지가 ${vworldStatus.officialLandPricePerM2?.toLocaleString()}원/㎡`
                  : `실패: ${vworldStatus.reason}`}
              </div>
            )}
            <div style={{ fontSize: 11, color: "#9A9E9F", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
              기본 정보
            </div>
            <div className="field-grid2">
              <div className="field">
                <label>사업 유형</label>
                <select value={form.projectType} onChange={(e) => setForm({ ...form, projectType: e.target.value })}>
                  <option>재건축</option><option>재개발</option><option>신축개발</option>
                </select>
              </div>
              <div className="field">
                <label>대지면적 (㎡)</label>
                <input type="number" min="1" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
              </div>
            </div>
            {form.area && ZONE_FAR[form.zone] && (
              <div style={{ fontSize: 11, color: "#7A7666", marginBottom: 10 }}>
                연면적(자동계산): 약 {Math.round((Number(form.area) / 3.3058) * (ZONE_FAR[form.zone] / 100)).toLocaleString("ko-KR")}평
                ({Math.round(Number(form.area) * (ZONE_FAR[form.zone] / 100)).toLocaleString("ko-KR")}㎡) — 용도지역·심사대상기관은 고급 설정, 법정 용적률 {ZONE_FAR[form.zone]}% 기준
              </div>
            )}

            <div style={{ fontSize: 11, color: "#9A9E9F", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, marginTop: 4 }}>
              필수 금융정보
            </div>
            <div className="field-grid2" style={{ marginBottom: 6 }}>
              <div className="field">
                <label>총사업비 (만원)</label>
                <input placeholder="비우면 자동계산" value={form.totalCostOverride} onChange={(e) => setForm({ ...form, totalCostOverride: e.target.value })} />
              </div>
              <div className="field">
                <label>자기자본비율 (%)</label>
                <input type="number" min="0" max="100" value={form.equityRatio} onChange={(e) => setForm({ ...form, equityRatio: e.target.value })} />
              </div>
            </div>
            {form.totalCostOverride && Number(form.totalCostOverride) > 0 ? (
              <div style={{ fontSize: 11, color: "#7A7666", marginBottom: 6 }}>
                PF 대출금(자동계산): 약 {fmt(Number(form.totalCostOverride) * (1 - Number(form.equityRatio) / 100))}만원 (총사업비 − 자기자본)
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#7A7666", marginBottom: 6 }}>
                PF 대출금: 총사업비를 자동계산하는 경우, 분석 실행 후 리포트에 정확한 금액이 표시됩니다.
              </div>
            )}
            <div style={{ fontSize: 11, color: "#7A7666", marginBottom: 6, lineHeight: 1.5 }}>
              용도지역·심사대상기관·인허가 단계·대출기간·시행사 실적·시공사 등급·입지·공급경쟁·신용보강구조·분양률·대출금리·취급수수료·공사비는
              기본적으로 임의값이 사용됩니다. 실제 값을 아신다면 아래 고급 설정에서 직접 입력해주세요.
            </div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              style={{ background: "none", border: "none", color: "#C9A34E", fontSize: 12, cursor: "pointer", padding: "4px 0", marginBottom: 8, textDecoration: "underline" }}
            >
              {showAdvanced ? "고급 설정 접기" : "고급 설정 펼치기 (실제 값 직접 입력)"}
            </button>
            {showAdvanced && (
              <div className="field-grid" style={{ marginBottom: 10 }}>
                <div className="field">
                  <label>예상 분양률 (%)</label>
                  <input type="number" min="0" max="100" value={form.expectedSaleRate} onChange={(e) => setForm({ ...form, expectedSaleRate: e.target.value })} />
                </div>
                <div className="field">
                  <label>인허가 단계</label>
                  <select value={form.permitStage} onChange={(e) => setForm({ ...form, permitStage: e.target.value })}>
                    {PERMIT_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>시행사 실적</label>
                  <select value={form.developerTrack} onChange={(e) => setForm({ ...form, developerTrack: e.target.value })}>
                    {DEVELOPER_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>시공사 등급</label>
                  <select value={form.contractorGrade} onChange={(e) => setForm({ ...form, contractorGrade: e.target.value })}>
                    {CONTRACTOR_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>신용보강구조</label>
                  <select value={form.creditEnhancement} onChange={(e) => setForm({ ...form, creditEnhancement: e.target.value })}>
                    {CREDIT_ENHANCEMENT_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>공급 경쟁</label>
                  <select value={form.supplyCompetition} onChange={(e) => setForm({ ...form, supplyCompetition: e.target.value })}>
                    {SUPPLY_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>용도지역</label>
                  <select value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}>
                    {Object.keys(ZONE_FAR).map((z) => <option key={z}>{z}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>심사 대상 기관</label>
                  <select value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })}>
                    <option>부동산신탁사</option><option>저축은행</option><option>캐피탈사</option><option>자산운용사</option>
                  </select>
                </div>
                <div className="field">
                  <label>입지</label>
                  <select value={form.locationTier} onChange={(e) => setForm({ ...form, locationTier: e.target.value })}>
                    {LOCATION_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>대출기간 (개월)</label>
                  <input type="number" min="1" max="360" value={form.loanTermMonths} onChange={(e) => setForm({ ...form, loanTermMonths: e.target.value })} />
                </div>
                <div className="field">
                  <label>대출금리 (%)</label>
                  <input type="number" min="0" max="50" step="0.1" value={form.interestRate} onChange={(e) => setForm({ ...form, interestRate: e.target.value })} />
                </div>
                <div className="field">
                  <label>취급수수료 (%)</label>
                  <input type="number" min="0" max="20" step="0.1" value={form.originationFee} onChange={(e) => setForm({ ...form, originationFee: e.target.value })} />
                </div>
              </div>
            )}
            {showAdvanced && (
              <>
                <div style={{ fontSize: 11, color: "#9A9E9F", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, marginTop: 8 }}>
                  비용 직접입력 (선택 — 입력 시 자동계산보다 우선 적용)
                </div>
                <div style={{ fontSize: 10.5, color: "#7A7666", marginBottom: 6, lineHeight: 1.5 }}>
                  ※ 분양가는 별도 직접입력 항목이 없습니다 — 실거래가 자동조회에 성공하면 그 값을, 실패하면 토지 평당가 기반 가정치를 그대로 분양가로 사용합니다(분석 실행 후 리포트에 표시).
                </div>
                <div className="field-grid" style={{ marginBottom: 8 }}>
                  <div className="field">
                    <label>토지매입비 직접입력 (만원, 총액)</label>
                    <input placeholder="비우면 평당 토지가 기반 자동계산" value={form.landCostOverride} onChange={(e) => setForm({ ...form, landCostOverride: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>평당 공사비 직접입력 (만원)</label>
                    <input placeholder="비우면 기본값 900" value={form.constructionCostPerPyInput} onChange={(e) => setForm({ ...form, constructionCostPerPyInput: e.target.value })} />
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 6 }}>
                  <label>소프트코스트(부대비용) 입력방식</label>
                  <select value={form.softCostMode} onChange={(e) => setForm({ ...form, softCostMode: e.target.value })}>
                    <option value="ratio">비율(%)로 입력</option>
                    <option value="itemized">항목별 직접입력 (철거비·설계비·감리비·분양마케팅비·부담금·예비비·기타)</option>
                  </select>
                </div>
                {form.softCostMode === "ratio" ? (
                  <div className="field" style={{ marginBottom: 8 }}>
                    <label>소프트코스트 비율 (%)</label>
                    <input placeholder="비우면 기본값 15%" value={form.softCostRatioInput} onChange={(e) => setForm({ ...form, softCostRatioInput: e.target.value })} />
                  </div>
                ) : (
                  <div className="field-grid" style={{ marginBottom: 8 }}>
                    <div className="field">
                      <label>철거비 (만원)</label>
                      <input value={form.demolitionCost} onChange={(e) => setForm({ ...form, demolitionCost: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>설계비 (만원)</label>
                      <input value={form.designFee} onChange={(e) => setForm({ ...form, designFee: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>감리비 (만원)</label>
                      <input value={form.supervisionFee} onChange={(e) => setForm({ ...form, supervisionFee: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>분양마케팅비 (만원)</label>
                      <input value={form.salesCost} onChange={(e) => setForm({ ...form, salesCost: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>각종 부담금 (만원)</label>
                      <input value={form.leviesCost} onChange={(e) => setForm({ ...form, leviesCost: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>예비비 (만원)</label>
                      <input value={form.contingency} onChange={(e) => setForm({ ...form, contingency: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>기타 (만원)</label>
                      <input value={form.miscCost} onChange={(e) => setForm({ ...form, miscCost: e.target.value })} />
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#7A7666", marginBottom: 10, lineHeight: 1.5 }}>
                  ※ “금융비”는 여기 포함하지 않습니다 — 대출조건(금리·수수료·기간) 기반으로 별도 계산되어
                  아래 “금융비용” 항목에 반영되며, 여기서 중복 입력하면 이중 계상됩니다.
                </div>
              </>
            )}
            {formErrors.length > 0 && (
              <div style={{ fontSize: 11.5, color: "#D98C7A", marginBottom: 8, lineHeight: 1.6 }}>
                {formErrors.map((e) => <div key={e}>⚠ {e}</div>)}
              </div>
            )}
            <button className="runbtn" onClick={() => handleRun()} disabled={stage === "running"}>
              {stage === "running" ? <><Loader2 size={16} className="spin" /> 분석 중…</> : "사업성 분석 실행"}
            </button>

            {stage === "running" && (
              <div style={{ marginTop: 18, fontSize: 13, color: "#9A9E9F" }}>
                {steps.map((s, i) => (
                  <div key={s} style={{ padding: "4px 0", color: i < step ? "#4C7A82" : "#565C64" }}>
                    {i < step ? "✓" : "…"} {s}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              style={{ background: "none", border: "1px solid #4C7A82", color: "#7CB0B8", fontSize: 11, cursor: "pointer", padding: "6px 10px", marginTop: 12, borderRadius: 4, width: "100%" }}
            >
              분석 이력 {showHistory ? "접기" : `보기 (${historyList.length})`}
            </button>
            {showHistory && (
              <div style={{ marginTop: 8, border: "1px solid #262C34", borderRadius: 4, padding: 10, maxHeight: 320, overflowY: "auto" }}>
                <input
                  placeholder="주소 검색"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  style={{ width: "100%", marginBottom: 8, background: "#1B2027", border: "1px solid #2C333B", color: "#E7E5DF", padding: "5px 8px", borderRadius: 4, fontSize: 12, boxSizing: "border-box" }}
                />
                {filteredHistory.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#6B7078" }}>저장된 분석 이력이 없습니다.</div>
                ) : filteredHistory.map(({ record, index }) => (
                  <div key={index} style={{ borderBottom: "1px solid #262C34", padding: "8px 0" }}>
                    <div style={{ fontSize: 12, color: "#E7E5DF", fontWeight: 600 }}>{record.input?.address || "주소 없음"}</div>
                    <div style={{ fontSize: 11, color: "#9A9E9F" }}>
                      {new Date(record.createdAt).toLocaleString("ko-KR")} · 등급 {record.score?.grade} ({record.score?.total?.toFixed(1)}점)
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <button type="button" onClick={() => handleHistoryLoad(record)} style={{ fontSize: 11, background: "none", border: "1px solid #333B45", color: "#9A9E9F", borderRadius: 3, padding: "3px 8px", cursor: "pointer" }}>불러오기</button>
                      <button type="button" onClick={() => handleHistoryReanalyze(record)} style={{ fontSize: 11, background: "none", border: "1px solid #4C7A82", color: "#7CB0B8", borderRadius: 3, padding: "3px 8px", cursor: "pointer" }}>재분석</button>
                      <button type="button" onClick={() => handleHistoryDelete(index)} style={{ fontSize: 11, background: "none", border: "1px solid #9C3B34", color: "#D98C7A", borderRadius: 3, padding: "3px 8px", cursor: "pointer" }}>삭제</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setShowCaseValidation((v) => !v);
                if (!caseComparisons) setCaseComparisons(loadCaseComparisons());
              }}
              style={{ background: "none", border: "1px solid #4C7A82", color: "#7CB0B8", fontSize: 11, cursor: "pointer", padding: "6px 10px", marginTop: 8, borderRadius: 4, width: "100%" }}
            >
              PF 사례 검증 {showCaseValidation ? "접기" : "보기"}
            </button>
            {showCaseValidation && (
              <div style={{ marginTop: 8, border: "1px solid #262C34", borderRadius: 4, padding: 10, maxHeight: 360, overflowY: "auto" }}>
                <div style={{ fontSize: 10.5, color: "#6B7078", marginBottom: 8, lineHeight: 1.5 }}>
                  AI가 각 사례의 입력값으로 산출한 등급과 실제 사업결과를 비교합니다. 전부 더미 데이터이며, 실제
                  사례로 교체되기 전까지는 참고용입니다.
                </div>
                {(caseComparisons || []).map((c) => (
                  <div key={c.id} style={{ borderBottom: "1px solid #262C34", padding: "8px 0" }}>
                    <div style={{ fontSize: 12, color: "#E7E5DF", fontWeight: 600 }}>{c.caseName}</div>
                    <div style={{ fontSize: 11, color: "#9A9E9F", marginTop: 2 }}>
                      AI등급 {c.grade ?? "계산 실패"} · 실제결과 {OUTCOME_LABEL[c.outcome] || c.outcome} ·{" "}
                      <span style={{ color: VERDICT_COLOR[c.verdict] || "#9A9E9F", fontWeight: 600 }}>{c.verdict}</span>
                    </div>
                    {c.error && <div style={{ fontSize: 10.5, color: "#D98C7A", marginTop: 2 }}>오류: {c.error}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* report */}
          <div>
            {stage !== "done" && (
              <div style={{ border: "1px dashed #2C333B", borderRadius: 6, padding: 60, textAlign: "center", color: "#5A5F66" }}>
                좌측 입력값으로 &lsquo;사업성 분석 실행&rsquo;을 누르면 심사 리포트가 이 영역에 생성됩니다.
              </div>
            )}

            {stage === "done" && result && (
              <div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
                  <button onClick={() => setExpanded((v) => !v)} className="runbtn" style={{ width: "auto", padding: "9px 16px", background: "#232A32", color: "#E7E5DF", border: "1px solid #333B45" }}>
                    {expanded ? "요약만 보기" : "전체 리포트 보기"}
                  </button>
                  <button onClick={handleExcelExport} className="runbtn" style={{ width: "auto", padding: "9px 16px", background: "#232A32", color: "#E7E5DF", border: "1px solid #333B45" }}>
                    <FileDown size={15} /> 엑셀 다운로드
                  </button>
                  <button onClick={handleDownload} className="runbtn" style={{ width: "auto", padding: "9px 16px", background: "#C9A34E", color: "#14171C", border: "none" }}>
                    <FileDown size={15} /> PDF로 다운로드
                  </button>
                </div>

                <div className="paper" style={{ position: "relative" }}>
                  <div className="cover-page" style={{ textAlign: "center", padding: "60px 20px", borderBottom: "2px solid #CCCCCC", marginBottom: 32 }}>
                    <div style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "#555555", marginBottom: 16 }}>
                      Real Estate Decision OS
                    </div>
                    <h1 style={{ fontFamily: "'Source Serif 4', serif", fontSize: 30, margin: "0 0 8px", color: "#000000" }}>
                      부동산 PF 사업성 심사 리포트
                    </h1>
                    <div style={{ fontSize: 13, color: "#555555", marginBottom: 32 }}>1차 타당성 검토용 (Quick Screening)</div>
                    <div style={{
                      color: "#000000", fontFamily: "'Source Serif 4', serif", fontSize: 34, fontWeight: 700,
                      marginBottom: 24, letterSpacing: "0.05em",
                    }}>
                      {result.grade}
                    </div>
                    <table style={{ margin: "0 auto", fontSize: 13, borderCollapse: "collapse" }}>
                      <tbody>
                        <tr><td style={{ padding: "4px 12px", color: "#555555", textAlign: "right" }}>사업지</td><td style={{ padding: "4px 12px", textAlign: "left", color: "#000000", fontWeight: 600 }}>{form.address}</td></tr>
                        <tr><td style={{ padding: "4px 12px", color: "#555555", textAlign: "right" }}>사업유형</td><td style={{ padding: "4px 12px", textAlign: "left", color: "#000000" }}>{form.zone} · {form.projectType}</td></tr>
                        <tr><td style={{ padding: "4px 12px", color: "#555555", textAlign: "right" }}>심사 대상 기관</td><td style={{ padding: "4px 12px", textAlign: "left", color: "#000000" }}>{form.lender}</td></tr>
                        <tr><td style={{ padding: "4px 12px", color: "#555555", textAlign: "right" }}>종합 등급</td><td style={{ padding: "4px 12px", textAlign: "left", color: "#000000", fontWeight: 600 }}>{result.grade} ({result.gradeNote})</td></tr>
                        <tr><td style={{ padding: "4px 12px", color: "#555555", textAlign: "right" }}>종합점수</td><td style={{ padding: "4px 12px", textAlign: "left", color: "#000000" }}>{result.scoreModel.totalScore.toFixed(1)}/100</td></tr>
                        <tr><td style={{ padding: "4px 12px", color: "#555555", textAlign: "right" }}>발행일</td><td style={{ padding: "4px 12px", textAlign: "left", color: "#000000" }}>{new Date().toLocaleDateString("ko-KR")}</td></tr>
                      </tbody>
                    </table>
                    <div style={{ marginTop: 32, fontSize: 11, color: "#9C5A2E", maxWidth: 420, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
                      본 리포트는 부동산 PF 사업성에 대한 1차 검토(Quick Screening)를 지원하는 참고도구이며, 투자권유 또는 투자자문을 제공하지 않습니다.
                    </div>
                  </div>


                  <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#333333" }}>
                    부동산 PF 사업성 심사 리포트 · Prototype Output
                  </div>
                  <h1 style={{ fontSize: 24, margin: "8px 0 2px" }}>{form.address}</h1>
                  <div style={{ fontSize: 13, color: "#000000" }}>
                    {form.zone} · {form.projectType} · 심사 대상: {form.lender} · 발행일 {new Date().toLocaleDateString("ko-KR")}
                  </div>

                  {/* ① 종합등급: 위 뱃지(cover-page)에서 이미 표시됨 */}
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 13, background: "#EFEFEF", display: "inline-block", padding: "4px 10px", borderRadius: 0, border: `1px solid ${result.gradeColor}`, color: "#000000", fontWeight: 600 }}>
                      종합 등급 {result.grade} — {result.gradeNote}
                    </div>
                    <div style={{
                      fontSize: 12, display: "inline-block", padding: "4px 10px", borderRadius: 0, fontWeight: 600,
                      background: dataNote?.ok ? "#E4EBF3" : "#F3E9E4",
                      color: dataNote?.ok ? "#3B6EA5" : "#9C5A2E",
                    }}>
                      {dataNote?.ok ? "국토부 실거래가 반영" : "가정치 기반 추정(실거래가 미반영)"}
                    </div>
                  </div>
                  {dataNote && !dataNote.ok && (
                    <div style={{ fontSize: 11, color: "#9C5A2E", marginTop: 4 }}>사유: {dataNote.reason}</div>
                  )}

                  {result.financialModelInvalid && (
                    <div style={{ fontSize: 12, color: "#9C3B34", background: "#F3E4E1", border: "1px solid #9C3B34", borderRadius: 0, padding: "8px 12px", marginTop: 10, lineHeight: 1.6 }}>
                      ⚠ 입력하신 대출금리·취급수수료·대출기간 조합에서는 대출구조가 수학적으로 성립하지 않습니다
                      (금융비용이 총사업비를 초과해 대출금액이 발산). 등급은 자동으로 D 처리되었습니다.
                      금리 또는 대출기간을 낮춰 다시 시도해주세요.
                    </div>
                  )}

                  {result.scoreModel.gateApplied && (
                    <div style={{ fontSize: 12, color: "#9C5A2E", background: "#F3E9E4", border: "1px solid #9C5A2E", borderRadius: 0, padding: "8px 12px", marginTop: 10, lineHeight: 1.6 }}>
                      ⚠ 종합점수는 {result.scoreModel.totalScore.toFixed(1)}점이지만, {
                        result.scoreModel.gateApplied === "financial" ? "금융 안정성 항목 중 2개 이상이 위험 등급으로 판정되어"
                        : result.scoreModel.gateApplied === "stability" ? "인허가·시행사·시공사 항목 중 2개 이상이 위험 등급으로 판정되어"
                        : "금융 안정성 항목 다수와 인허가·시행사·시공사 항목이 모두 위험 등급으로 판정되어"
                      } 등급을 BB(투기적) 이하로 제한했습니다. 다른 항목 점수가 아무리 좋아도 이 리스크는 상쇄되지 않습니다.
                      {gateIsOnlyDueToDefaults(result) && (
                        <><br /><br />※ 이 제한은 실제로 나쁜 값이 입력돼서가 아니라, <b>시행사·시공사·신용보강 등 고급설정 항목을 입력하지 않아</b> 보수적으로
                        위험 처리된 결과입니다. 좌측 &ldquo;고급 설정&rdquo;에서 실제 값을 입력하면 등급이 달라질 수 있습니다.</>
                      )}
                    </div>
                  )}

                  {/* ② 심사의견 */}
                  <div style={{ marginTop: 14, padding: "12px 14px", background: "#F2F2F2", borderRadius: 0, border: `1.5px solid ${result.gradeColor}` }}>
                    <div style={{ fontSize: 11, color: "#000000", textTransform: "uppercase", letterSpacing: "0.05em" }}>최종 심사의견</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "#000000", marginTop: 2 }}>
                      {DECISION_LABEL[result.gradeBand]}
                    </div>
                    <div style={{ fontSize: 12.5, color: "#000000", marginTop: 6, lineHeight: 1.6 }}>
                      {buildDecisionReason(result)}
                    </div>
                  </div>

                  {/* ③ 핵심 리스크 */}
                  <h2 style={{ fontSize: 15, marginTop: 20, marginBottom: 4, color: "#000000", borderTop: "1px solid #DDDDDD", paddingTop: 14 }}>핵심 리스크</h2>
                  <div style={{ fontSize: 11, color: "#333333", marginBottom: 8 }}>
                    종합 평가항목(아래 1번 표) 중 배점 손실이 큰 순으로 자동 추출한 실제 채점 근거입니다.
                  </div>
                  {topRiskItems(result.scoreModel, 3).length === 0 ? (
                    <div style={{ fontSize: 13, color: "#2F6F5E", marginBottom: 12 }}>모든 평가항목이 우수로 판정되어 특별한 리스크가 없습니다.</div>
                  ) : topRiskItems(result.scoreModel, 3).map((item) => (
                    <ScoreItemRow key={item.key} item={item} />
                  ))}

                  {/* ④ 핵심 강점 */}
                  <h2 style={{ fontSize: 15, marginTop: 16, marginBottom: 4, color: "#000000" }}>핵심 강점</h2>
                  {topStrengthItems(result.scoreModel, 2).length === 0 ? (
                    <div style={{ fontSize: 13, color: "#9C3B34", marginBottom: 12 }}>우수로 판정된 항목이 없습니다.</div>
                  ) : topStrengthItems(result.scoreModel, 2).map((item) => (
                    <ScoreItemRow key={item.key} item={item} />
                  ))}

                  {/* ⑤ 핵심 지표 */}
                  <h2 style={{ fontSize: 15, marginTop: 20, marginBottom: 10, color: "#000000", borderTop: "1px solid #DDDDDD", paddingTop: 14 }}>핵심 지표</h2>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
                    {result.scoreModel.categories[0].items.slice(0, 3).map((item) => (
                      <div className="metric-card" key={item.key}>
                        <div style={{ fontSize: 11, color: "#000000" }}>{item.name}</div>
                        <div className="metric-num">{item.detail}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: TIER_COLOR[item.tier], marginTop: 2 }}>{item.tier}</div>
                      </div>
                    ))}
                    <div className="metric-card">
                      <div style={{ fontSize: 11, color: "#000000" }}>담보가치 (참고, 미채점)</div>
                      <div className="metric-num">대출금의 {Math.round(100 / result.ltv * 100)}%</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: TIER_COLOR[result.collateralRef], marginTop: 2 }}>{result.collateralRef}</div>
                    </div>
                  </div>

                  {/* ⑥ 상세 분석 */}
                  {expanded && (
                  <>
                  <h2 style={{ fontSize: 15, marginTop: 20, marginBottom: 8, color: "#000000" }}>Executive Summary</h2>
                  <ul style={{ fontSize: 13, lineHeight: 1.8, color: "#000000", paddingLeft: 18, margin: 0 }}>
                    <li>본건은 {form.address} ‘{form.projectType} 사업’의 PF 대출을 요청하는 건으로, 대출금은 토지비·공사비·금융비 등의 용도로 사용될 예정임.</li>
                    <li>대출조건은 대출금리 {result.interestRate}%, 취급수수료 {result.originationFee}%(All-in cost {result.allInCost.toFixed(1)}%), 대출기간 {result.loanTermMonths}개월, LTV {result.ltv.toFixed(1)}%, Exit 분양률 {result.expectedSaleRate}% 가정.</li>
                    <li>세전이익 {fmt(result.profit)}만원(세전이익률 {result.margin.toFixed(1)}%) 수준으로 산출되어 종합 등급 {result.grade}({result.gradeNote})로 평가됨.</li>
                  </ul>

                  <h2 style={{ fontSize: 15, marginTop: 20, marginBottom: 12, color: "#000000" }}>1. 사업 개요</h2>
                  <div style={{ fontSize: 11, color: "#333333", marginBottom: 4 }}>출처: 대지면적(사용자 입력) · 용적률(국토계획법 시행령·서울시 도시계획조례)</div>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginBottom: 4 }}>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000", width: 140 }}>대지면적</td><td style={{ padding: "6px 4px" }}>{fmt(result.landAreaPy)}평</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>적용 용적률</td><td style={{ padding: "6px 4px" }}>{result.far}%</td></tr>
                      <tr><td style={{ padding: "6px 4px", color: "#000000" }}>연면적</td><td style={{ padding: "6px 4px" }}>{fmt(result.grossFloorPy)}평</td></tr>
                    </tbody>
                  </table>

                  <h2 style={{ fontSize: 15, marginTop: 20, marginBottom: 4, color: "#000000" }}>2. 시장성 분석</h2>
                  <div style={{ fontSize: 11, color: "#333333", marginBottom: 8 }}>
                    입지·공급경쟁·주변 실거래·예상 분양률(아래 5번 종합 평가항목 표에서 이미 채점된 값)을 시장 관점으로 모아본 것입니다. 별도 시장 데이터를 새로 수집하지 않았습니다.
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
                    <div className="metric-card">
                      <div style={{ fontSize: 11, color: "#000000" }}>분양 경쟁력</div>
                      <div className="metric-num" style={{ color: TIER_COLOR[market.salesCompetitiveness === "취약" ? "위험" : market.salesCompetitiveness === "우수" ? "우수" : "보통"] }}>{market.salesCompetitiveness}</div>
                    </div>
                    <div className="metric-card">
                      <div style={{ fontSize: 11, color: "#000000" }}>공급 리스크</div>
                      <div className="metric-num" style={{ color: TIER_COLOR[market.supplyRiskLabel === "높음" ? "위험" : market.supplyRiskLabel === "낮음" ? "우수" : "보통"] }}>{market.supplyRiskLabel}</div>
                    </div>
                    <div className="metric-card">
                      <div style={{ fontSize: 11, color: "#000000" }}>시장 종합 평가</div>
                      <div className="metric-num" style={{ color: TIER_COLOR[market.overallTier] }}>{market.overallTier}</div>
                    </div>
                  </div>
                  <div style={{ background: "#F2F2F2", border: "1px solid #CCCCCC", borderRadius: 0, padding: "10px 12px", fontSize: 13, lineHeight: 1.7, color: "#000000", marginBottom: 12 }}>
                    {market.opinion}
                  </div>

                  {dataNote?.ok && comps.length > 0 && (
                    <>
                      <h3 style={{ fontSize: 13, marginBottom: 8, color: "#000000" }}>인근 실거래 비교 (Comps)</h3>
                      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginBottom: 4 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #555555", fontWeight: 600, color: "#000000" }}>
                            <td style={{ padding: "6px 4px" }}>단지/건물명</td>
                            <td style={{ padding: "6px 4px", textAlign: "right" }}>거래금액</td>
                            <td style={{ padding: "6px 4px", textAlign: "right" }}>전용면적</td>
                            <td style={{ padding: "6px 4px", textAlign: "right" }}>평당가</td>
                            <td style={{ padding: "6px 4px", textAlign: "right" }}>거래시점</td>
                          </tr>
                        </thead>
                        <tbody>
                          {comps.slice(0, 8).map((c, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #CCCCCC" }}>
                              <td style={{ padding: "6px 4px" }}>{c.name}</td>
                              <td style={{ padding: "6px 4px", textAlign: "right" }}>{fmt(c.dealAmount)}만원</td>
                              <td style={{ padding: "6px 4px", textAlign: "right" }}>{c.area}㎡</td>
                              <td style={{ padding: "6px 4px", textAlign: "right" }}>{fmt(c.pricePerPy)}만원</td>
                              <td style={{ padding: "6px 4px", textAlign: "right", color: "#000000" }}>{c.dealYear}.{c.dealMonth}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{ fontSize: 11, color: "#333333", marginBottom: 8 }}>
                        ※ 국토교통부 실거래가 API로 조회된 실제 거래 내역입니다(최대 8건 표시, 조회 조건: 동일 시군구·최근 공시월).
                        본 사업지와 정확히 인접하지 않을 수 있습니다.
                      </div>
                    </>
                  )}

                  <h2 style={{ fontSize: 15, marginTop: 20, marginBottom: 12, color: "#000000" }}>3. 금융 개요</h2>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginBottom: 4 }}>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000", width: 140 }}>차주사(시행사)</td><td style={{ padding: "6px 4px" }}>[T.B.D] — 실적: {form.developerTrack}</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>시공사</td><td style={{ padding: "6px 4px" }}>[T.B.D] — 등급: {form.contractorGrade}</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>심사 대상 기관</td><td style={{ padding: "6px 4px" }}>{form.lender}</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>대출금액</td><td style={{ padding: "6px 4px" }}>{fmt(result.loanAmount)}만원</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>대출금리 / 취급수수료 / All-in cost</td><td style={{ padding: "6px 4px" }}>{result.interestRate}% / {result.originationFee}% / {result.allInCost.toFixed(1)}%</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>LTV / Exit 분양률</td><td style={{ padding: "6px 4px" }}>{result.ltv.toFixed(1)}% / {result.expectedSaleRate}%</td></tr>
                      <tr><td style={{ padding: "6px 4px", color: "#000000" }}>대출기간</td><td style={{ padding: "6px 4px" }}>{result.loanTermMonths}개월</td></tr>
                    </tbody>
                  </table>

                  <h3 style={{ fontSize: 13, marginTop: 16, marginBottom: 8, color: "#000000" }}>PF 자금용도 (단위: 만원)</h3>
                  <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse", marginBottom: 4 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #555555", fontWeight: 600, color: "#000000" }}>
                        <td style={{ padding: "6px 4px" }}>구분</td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>Equity</td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>PF 대출</td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>합계</td>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["토지비", result.landCost],
                        ["공사비", result.constructionCost],
                        ["일반관리비(판매비·부대비용·제세공과금 등, 가정치)", result.generalCost],
                        ["금융비용", result.financeCost],
                      ].map(([label, amount]) => (
                        <tr key={label} style={{ borderBottom: "1px solid #CCCCCC" }}>
                          <td style={{ padding: "6px 4px" }}>{label}</td>
                          <td style={{ padding: "6px 4px", textAlign: "right" }}>{fmt(amount * (result.equityRatio / 100))}</td>
                          <td style={{ padding: "6px 4px", textAlign: "right" }}>{fmt(amount * (1 - result.equityRatio / 100))}</td>
                          <td style={{ padding: "6px 4px", textAlign: "right" }}>{fmt(amount)}</td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 700 }}>
                        <td style={{ padding: "6px 4px" }}>합계</td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>{fmt(result.equityAmount)}</td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>{fmt(result.loanAmount)}</td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>{fmt(result.totalCost)}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "6px 4px", color: "#333333", fontSize: 11 }}>비율</td>
                        <td style={{ padding: "6px 4px", textAlign: "right", color: "#333333", fontSize: 11 }}>{result.equityRatio}%</td>
                        <td style={{ padding: "6px 4px", textAlign: "right", color: "#333333", fontSize: 11 }}>{(100 - result.equityRatio).toFixed(1)}%</td>
                        <td style={{ padding: "6px 4px", textAlign: "right", color: "#333333", fontSize: 11 }}>100%</td>
                      </tr>
                    </tbody>
                  </table>
                  <div style={{ fontSize: 11, color: "#333333", marginBottom: 8 }}>
                    ※ Equity/PF대출 배분은 항목별로 자기자본비율({result.equityRatio}%)을 균등 적용한 단순화 값입니다.
                    실제로는 토지비 선투입 등 조달 순서에 따라 배분이 달라질 수 있습니다.
                  </div>

                  <h2 style={{ fontSize: 15, marginTop: 20, marginBottom: 12, color: "#000000" }}>4. 사업성 지표</h2>
                  <div style={{ fontSize: 11, color: "#333333", marginBottom: 4 }}>
                    출처: 총사업비({result.totalCostSource}) · 분양수입 평당가({dataNote?.ok ? "국토교통부 실거래가 API" : "가정치(실거래가 조회 실패)"}) ·
                    토지매입비({result.landCostSource}) · 공사비({result.constructionCostSource}) · 소프트비용({result.generalCostSource}) · 대출조건(사용자 입력 또는 기본값)
                  </div>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginBottom: 4 }}>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000", width: 140 }}>총사업비</td><td style={{ padding: "6px 4px" }}>{fmt(result.totalCost)}만원</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>예상 분양수입</td><td style={{ padding: "6px 4px" }}>{fmt(result.salesRevenue)}만원</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>사업수지 (이익)</td><td style={{ padding: "6px 4px", color: profitColor(result.profit), fontWeight: 600 }}>{fmt(result.profit)}만원</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>사업수익률</td><td style={{ padding: "6px 4px" }}>{result.margin.toFixed(1)}%</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>PF 대출금액</td><td style={{ padding: "6px 4px" }}>{fmt(result.loanAmount)}만원</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>자기자본</td><td style={{ padding: "6px 4px" }}>{fmt(result.equityAmount)}만원</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>금융비용</td><td style={{ padding: "6px 4px" }}>{fmt(result.financeCost)}만원</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>LTV</td><td style={{ padding: "6px 4px" }}>{result.ltv.toFixed(1)}%</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>DSCR</td><td style={{ padding: "6px 4px" }}>{result.dscr}x</td></tr>
                      <tr style={{ borderBottom: "1px solid #CCCCCC" }}><td style={{ padding: "6px 4px", color: "#000000" }}>All-in cost</td><td style={{ padding: "6px 4px" }}>{result.allInCost.toFixed(1)}%</td></tr>
                      <tr><td style={{ padding: "6px 4px", color: "#000000" }}>공사비(평당)</td><td style={{ padding: "6px 4px" }}>{fmt(result.constructionCostPerPy)}만원</td></tr>
                    </tbody>
                  </table>

                  <h2 style={{ fontSize: 15, marginTop: 20, marginBottom: 4, color: "#000000" }}>
                    5. 종합 평가항목 (종합점수 {result.scoreModel.totalScore.toFixed(1)}/100 — 금융안정성40·사업성30·사업안정성20·입지경쟁력10 가중합산)
                  </h2>
                  <div style={{ fontSize: 11, color: "#333333", marginBottom: 8 }}>
                    “정량”은 공식으로 산출되어 재현 가능한 값, “정성”은 사용자 입력·선택에 따른 정성적 판정입니다.
                  </div>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginBottom: 4 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #555555", fontWeight: 600, color: "#000000" }}>
                        <td style={{ padding: "6px 4px" }}>항목</td>
                        <td style={{ padding: "6px 4px" }}>구분</td>
                        <td style={{ padding: "6px 4px" }}>값</td>
                        <td style={{ padding: "6px 4px", textAlign: "center" }}>점수</td>
                        <td style={{ padding: "6px 4px", textAlign: "center" }}>등급</td>
                        <td style={{ padding: "6px 4px" }}>출처</td>
                      </tr>
                    </thead>
                    <tbody>
                      {result.scoreModel.categories.map((cat) => (
                        <React.Fragment key={cat.key}>
                          <tr style={{ background: "#EFEFEF" }}>
                            <td colSpan={6} style={{ padding: "6px 4px", fontWeight: 700, color: "#000000" }}>
                              {cat.name} ({cat.score.toFixed(1)}/{cat.maxPoints})
                            </td>
                          </tr>
                          {cat.items.map((item) => (
                            <tr key={item.key} style={{ borderBottom: "1px solid #CCCCCC" }}>
                              <td style={{ padding: "6px 4px" }} title={item.reason}>{item.name}</td>
                              <td style={{ padding: "6px 4px" }}>
                                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 0, border: "1px solid #CCCCCC", background: "#F2F2F2", color: "#333333" }}>
                                  {item.type}
                                </span>
                              </td>
                              <td style={{ padding: "6px 4px", color: "#000000" }}>{item.detail}</td>
                              <td style={{ padding: "6px 4px", textAlign: "center" }}>{item.score.toFixed(1)}/{item.maxPoints}</td>
                              <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: 600, color: TIER_COLOR[item.tier] }}>{item.tier}</td>
                              <td style={{ padding: "6px 4px", fontSize: 11, color: "#555555" }}>{item.source}</td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                      <tr style={{ fontWeight: 700 }}>
                        <td colSpan={3} style={{ padding: "6px 4px" }}>종합점수 (4개 카테고리 가중합산)</td>
                        <td style={{ padding: "6px 4px", textAlign: "center" }}>{result.scoreModel.totalScore.toFixed(1)}/100</td>
                        <td style={{ padding: "6px 4px", textAlign: "center", color: "#000000" }}>{result.grade}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>

                  <h2 style={{ fontSize: 15, marginTop: 20, marginBottom: 4, color: "#000000" }}>6. 리스크 분석</h2>
                  <div style={{ fontSize: 11, color: "#333333", marginBottom: 8 }}>
                    5번 종합 평가항목 표에서 “위험”·“보통”으로 판정된 항목 전체를 배점 손실이 큰 순으로 모은 것입니다(새 데이터 없이 기존 채점 결과 재구성).
                  </div>
                  {result.financialModelInvalid && (
                    <div style={{ fontSize: 12, color: "#9C3B34", marginBottom: 8 }}>⚠ 대출구조가 수학적으로 성립하지 않아 등급이 자동 D 처리되었습니다.</div>
                  )}
                  {result.scoreModel.gateApplied && (
                    <div style={{ fontSize: 12, color: "#9C5A2E", marginBottom: 8 }}>
                      ⚠ {
                        result.scoreModel.gateApplied === "financial" ? "금융 안정성 항목 중 2개 이상이 위험 등급으로 판정되어"
                        : result.scoreModel.gateApplied === "stability" ? "인허가·시행사·시공사 항목 중 2개 이상이 위험 등급으로 판정되어"
                        : "금융 안정성 항목 다수와 인허가·시행사·시공사 항목이 모두 위험 등급으로 판정되어"
                      } 등급이 BB(투기적) 이하로 제한되었습니다.
                      {gateIsOnlyDueToDefaults(result) && " (고급설정 미입력에 따른 보수적 처리 — 실제 값을 입력하면 달라질 수 있음)"}
                    </div>
                  )}
                  {topRiskItems(result.scoreModel, 99).length === 0 ? (
                    <div style={{ fontSize: 13, color: "#2F6F5E" }}>모든 평가항목이 우수로 판정되어 특별한 리스크가 없습니다.</div>
                  ) : topRiskItems(result.scoreModel, 99).map((item) => (
                    <ScoreItemRow key={item.key} item={item} />
                  ))}

                  <h2 style={{ fontSize: 15, marginTop: 20, marginBottom: 4, color: "#000000" }}>스트레스 테스트 요약 비교</h2>
                  <div style={{ fontSize: 11, color: "#333333", marginBottom: 8 }}>
                    금리·공사비·분양률 스트레스를 시나리오별로 한 번에 비교합니다(아래 개별 스트레스 표 3종의 요약본).
                    각 시나리오의 등급은 재무 4항목만 재계산해 기존 채점 로직에 그대로 대입한 값입니다.
                  </div>
                  <StressComparisonTable rows={buildStressComparison(form, result, comps.length)} />

                  <StressTestTable
                    title="분양률 스트레스 테스트"
                    warning="⚠️ 단순화 가정: 대출조건·총사업비는 고정하고 실현 분양수입만 변동시킨 것입니다. 미분양분은 수입 0으로 가정(보수적)."
                    scenarioLabel="분양률 시나리오" col2Label="분양수입"
                    rows={[60, 80, 100].map((rate) => {
                      const row = stressTestRow(result, rate);
                      return {
                        key: rate,
                        label: `분양률 ${rate}%${rate === Math.round(result.expectedSaleRate) ? " (가정치)" : ""}`,
                        highlight: rate === Math.round(result.expectedSaleRate),
                        col2Value: row.revenue, profit: row.profit, margin: row.margin, dscr: row.dscr,
                      };
                    })}
                  />

                  <StressTestTable
                    topMargin={12}
                    title="금리 상승 스트레스 테스트"
                    warning="⚠️ 단순화 가정: 대출금액·분양수입은 고정하고 대출금리만 변동시킨 것입니다(대출금액 재산정은 반영 안 함)."
                    scenarioLabel="금리 시나리오" col2Label="총사업비"
                    rows={[0, 1, 3, 5].map((delta) => {
                      const row = interestRateStressRow(result, delta);
                      return {
                        key: delta,
                        label: delta === 0 ? `현재 금리 ${row.newRate.toFixed(1)}% (가정치)` : `+${delta}%p (${row.newRate.toFixed(1)}%)`,
                        highlight: delta === 0,
                        col2Value: row.totalCost, profit: row.profit, margin: row.margin, dscr: row.dscr,
                      };
                    })}
                  />

                  <StressTestTable
                    topMargin={12}
                    title="공사비 상승 스트레스 테스트"
                    warning="⚠️ 단순화 가정: 대출금액·금리·분양수입은 고정하고 공사비 초과분만큼 사업수지가 그대로 악화된다고 가정한 것입니다 (대출금액 재산정, 소프트비용 연동 재계산은 반영 안 함)."
                    scenarioLabel="공사비 시나리오" col2Label="총사업비"
                    rows={[0, 5, 10, 15].map((overrun) => {
                      const row = costOverrunStressRow(result, overrun);
                      return {
                        key: overrun,
                        label: overrun === 0 ? "현재 공사비 (가정치)" : `공사비 +${overrun}%`,
                        highlight: overrun === 0,
                        col2Value: row.totalCost, profit: row.profit, margin: row.margin, dscr: row.dscr,
                      };
                    })}
                  />

                  <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 8, color: "#000000" }}>7. AI 종합의견</h2>
                  <div style={{ background: "#F2F2F2", border: `1.5px solid ${result.gradeColor}`, borderRadius: 0, padding: "16px 18px" }}>
                    <p style={{ fontSize: 14, lineHeight: 1.8, color: "#000000", margin: 0 }}>
                      본 사업지는 사업수익률 {result.margin.toFixed(1)}% 수준으로 산출되어
                      종합 등급 {result.grade}({result.gradeNote})로 평가됩니다. (종합점수 {result.scoreModel.totalScore.toFixed(1)}/100)
                      {result.gradeBand === "high" && " 분양가 가정과 공사비 변동에 대한 민감도가 낮은 편으로, 표준 심사 절차 진행을 검토할 수 있습니다."}
                      {result.gradeBand === "good" && " 전반적으로 양호하나, 일부 리스크 항목에 대한 보완 자료(분양 흡수율 근거, 시공사 신용등급 등) 확보 후 심사를 진행하는 것을 권고합니다."}
                      {result.gradeBand === "speculative" && " 투기적 등급 구간으로, 조달구조·분양전략에 대한 보완 없이는 심사 승인이 어려울 수 있습니다."}
                      {(result.gradeBand === "weak" || result.gradeBand === "default") && " 사업수지 또는 리스크 스코어가 기준선에 크게 미달하여, 조건 변경(용도·규모·조달구조) 또는 재검토가 필요합니다."}
                    </p>
                  </div>

                  <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid #CCCCCC", fontSize: 11, color: "#333333", lineHeight: 1.6 }}>
                    <ShieldCheck size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                    {dataNote?.ok
                      ? "실제 데이터 기반: 평당가(국토교통부 실거래가 API), 용적률(국토계획법 시행령·서울시 도시계획조례), 자기자본비율 20%↑ 기준(2011년 저축은행 사태 이후 금융당국 규제 기준). 근거 없는 가정치: 공사비·소프트비용 비율(임의 범위), 시행사·시공사·입지·분양률·대출조건 기본값. 실 서비스 전환 시 브이월드·건축물대장·실제 입력값으로 교체가 필요합니다."
                      : "실거래가 연동에 실패해 용도지역별 평당가도 가정치로 대체되었습니다. 이 리포트의 숫자 대부분이 근거 없는 임의값이니 참고용으로만 사용하세요. 실제 데이터 기반은 자기자본비율 20%↑ 기준(금융당국 규제)과 법정 용적률뿐입니다."}
                  </div>

                  <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 8, color: "#000000" }}>8. 심사 체크리스트</h2>
                  <div style={{ fontSize: 11, color: "#333333", marginBottom: 8 }}>
                    5번 종합 평가항목의 모든 세부 지표를 자동 판정한 결과입니다(&ldquo;위험&rdquo;이면 미충족 ☐로 표시). 새 판정 기준 없이 기존 채점 결과를 그대로 재구성합니다.
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 20px", marginBottom: 16 }}>
                    {result.scoreModel.categories.flatMap((c) => c.items).map((item) => (
                      <div key={item.key} style={{ fontSize: 12.5, color: item.tier === "위험" ? "#9C3B34" : "#000000" }}>
                        {item.tier === "위험" ? "☐" : "☑"} {item.name} {item.tier === "위험" ? `— ${item.detail} (미충족)` : "적정"}
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: "10px 14px", background: "#F2F2F2", borderRadius: 0, border: `1px solid ${result.gradeColor}` }}>
                    <div style={{ fontSize: 10.5, color: "#000000", textTransform: "uppercase", letterSpacing: "0.05em" }}>최종 심사의견</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#000000", marginTop: 2 }}>{DECISION_LABEL[result.gradeBand]}</div>
                  </div>
                  </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <footer style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid #262C34", fontSize: 11, color: "#6B7078", lineHeight: 1.6 }}>
          본 서비스는 부동산 PF 사업성에 대한 1차 검토(Quick Screening)를 지원하는 참고도구입니다.
          투자권유 또는 투자자문을 제공하지 않습니다. 최종 투자 판단은 이용자 본인의 책임이며 전문가 검토를 권장합니다.
        </footer>
      </div>

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
