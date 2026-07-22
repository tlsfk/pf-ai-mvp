import { computeScoreModel, collateralTier, topRiskItems, topStrengthItems } from "./src/lib/scoring/index.js";

const ctx = {
  ltv: 65, dscr: "1.30", equityRatio: 20, allInCost: 10.5,
  expectedSaleRate: 85, expectedSaleRateIsDefault: false,
  usingRealData: true, compsCount: 5,
  locationTier: "서울 핵심·광역시 중심", locationTierIsDefault: false,
  supplyCompetition: "적정", supplyCompetitionIsDefault: false,
  creditEnhancement: "책임준공확약 있음", creditEnhancementIsDefault: false,
  projectType: "재건축", permitStage: "진행 중",
  developerTrack: "대형·실적 풍부", developerTrackIsDefault: false,
  contractorGrade: "1군 건설사", contractorGradeIsDefault: false,
  financialModelInvalid: false, profit: 50000,
};

const model = computeScoreModel(ctx);
console.log("totalScore:", model.totalScore, "grade:", model.grade);
console.assert(model.categories.length === 4, "expected 4 categories");
const sumMax = model.categories.reduce((s, c) => s + c.maxPoints, 0);
console.assert(sumMax === 100, "category maxPoints should sum to 100, got " + sumMax);
const sumScore = model.categories.reduce((s, c) => s + c.score, 0);
console.assert(Math.abs(sumScore - model.totalScore) < 1e-9, "category scores should sum to totalScore");
console.assert(model.grade !== "D", "expected non-D grade for healthy inputs, got " + model.grade);
console.log("collateralTier(65):", collateralTier(65));

const dModel = computeScoreModel({ ...ctx, profit: -1 });
console.assert(dModel.grade === "D", "expected D grade when profit <= 0");
console.log("D-grade path OK:", dModel.grade);

const defaultModel = computeScoreModel({
  ...ctx, developerTrack: "미정(정보 없음)", developerTrackIsDefault: true,
  contractorGrade: "미정(정보 없음)", contractorGradeIsDefault: true,
  supplyCompetition: "미확인(정보 없음)", supplyCompetitionIsDefault: true,
});
const dev = defaultModel.categories.flatMap(c => c.items).find(i => i.key === "developerTrack");
console.assert(dev.tier === "위험", "expected 위험 tier for missing developerTrack, got " + dev.tier);
console.log("missing-info conservative path OK:", dev.tier);

// 신용보강구조 미입력(기본값)은 다른 항목과 마찬가지로 보수적으로 위험 처리되어야 하지만,
// "실행 3항목"(인허가·시행사·시공사)이 전부 정상이면 게이트는 걸리지 않아야 함(별개 축이므로).
const noEnhancementModel = computeScoreModel({ ...ctx, creditEnhancement: "신용보강 없음/미확인", creditEnhancementIsDefault: true });
const ce = noEnhancementModel.categories.flatMap(c => c.items).find(i => i.key === "creditEnhancement");
console.assert(ce.tier === "위험", "expected 위험 tier for missing creditEnhancement, got " + ce.tier);
console.assert(noEnhancementModel.gateApplied === null, "creditEnhancement alone should not trigger the stability gate, got " + noEnhancementModel.gateApplied);
console.log("creditEnhancement default is conservative but isolated from execution gate: OK");

// 하드 게이트: 재무 4항목 중 2개 이상 위험이면, 다른 카테고리가 만점이어도 BB 이하로 캡되어야 함
// (가중합산만으로는 LTV88%/자기자본8%/All-in18% 같은 붕괴한 재무구조를 A- 등급까지 가릴 수 있었던 결함 회귀 방지)
const badFinanceModel = computeScoreModel({
  ...ctx, ltv: 88, dscr: "1.05", equityRatio: 8, allInCost: 18,
});
console.assert(badFinanceModel.gateApplied === "financial", "expected financial gate, got " + badFinanceModel.gateApplied);
console.assert(["BB+", "BB", "BB-", "B+", "B", "B-", "CCC", "CC", "C"].includes(badFinanceModel.grade), "expected grade capped at BB or below, got " + badFinanceModel.grade);
console.log("financial gate OK:", badFinanceModel.grade);

// 하드 게이트: 인허가·시행사·시공사 3개 전부 위험이면(사업진행리스크 자체는 제외) BB 이하로 캡
const badStabilityModel = computeScoreModel({
  ...ctx, permitStage: "초기 단계", developerTrack: "미정(정보 없음)", developerTrackIsDefault: true,
  contractorGrade: "소형",
});
console.assert(badStabilityModel.gateApplied === "stability", "expected stability gate, got " + badStabilityModel.gateApplied);
console.log("stability gate OK (3/3 risky):", badStabilityModel.grade);

// v1.4.0: 3개 중 2개만 위험이어도(인허가는 "진행 중"으로 정상) 게이트가 발동해야 함 —
// 실제 부도 사례 대부분이 착공 이후(인허가 진행 중)에 발생한다는 PF 사례 검증 결과 반영.
const twoOfThreeStabilityModel = computeScoreModel({
  ...ctx, permitStage: "진행 중", developerTrack: "미정(정보 없음)", developerTrackIsDefault: true,
  contractorGrade: "소형",
});
console.assert(twoOfThreeStabilityModel.gateApplied === "stability", "expected stability gate for 2/3 risky, got " + twoOfThreeStabilityModel.gateApplied);
console.log("stability gate OK (2/3 risky, permit 정상):", twoOfThreeStabilityModel.grade);

// 1개만 위험이면 게이트가 발동하면 안 됨(과도한 하드 게이트 방지)
const oneOfThreeStabilityModel = computeScoreModel({
  ...ctx, permitStage: "진행 중", developerTrack: "미정(정보 없음)", developerTrackIsDefault: true,
  contractorGrade: "1군 건설사",
});
console.assert(oneOfThreeStabilityModel.gateApplied === null, "expected no gate for 1/3 risky, got " + oneOfThreeStabilityModel.gateApplied);
console.log("no gate for 1/3 risky: OK");

// Executive Summary용 TOP 리스크/강점 추출: 배점 손실(deficit) 큰 순 / 배점 큰 순 정렬 검증
const risks = topRiskItems(badFinanceModel, 3);
console.assert(risks.every((i) => i.tier !== "우수"), "risk items must not be 우수 tier");
for (let i = 1; i < risks.length; i++) {
  console.assert(risks[i - 1].deficit >= risks[i].deficit, "risks not sorted by deficit desc");
}
const strengths = topStrengthItems(model, 2);
console.assert(strengths.every((i) => i.tier === "우수"), "strength items must be 우수 tier");
console.log("topRiskItems/topStrengthItems sorting OK");

console.log("ALL CHECKS PASSED");
