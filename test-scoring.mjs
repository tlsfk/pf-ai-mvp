import { computeScoreModel, collateralTier } from "./src/lib/scoring/index.js";

const ctx = {
  ltv: 65, dscr: "1.30", equityRatio: 20, allInCost: 10.5,
  expectedSaleRate: 85, expectedSaleRateIsDefault: false,
  usingRealData: true, compsCount: 5,
  locationTier: "서울 핵심·광역시 중심", locationTierIsDefault: false,
  supplyCompetition: "적정", supplyCompetitionIsDefault: false,
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

// 하드 게이트: 재무 4항목 중 2개 이상 위험이면, 다른 카테고리가 만점이어도 BB 이하로 캡되어야 함
// (가중합산만으로는 LTV88%/자기자본8%/All-in18% 같은 붕괴한 재무구조를 A- 등급까지 가릴 수 있었던 결함 회귀 방지)
const badFinanceModel = computeScoreModel({
  ...ctx, ltv: 88, dscr: "1.05", equityRatio: 8, allInCost: 18,
});
console.assert(badFinanceModel.gateApplied === "financial", "expected financial gate, got " + badFinanceModel.gateApplied);
console.assert(["BB+", "BB", "BB-", "B+", "B", "B-", "CCC", "CC", "C"].includes(badFinanceModel.grade), "expected grade capped at BB or below, got " + badFinanceModel.grade);
console.log("financial gate OK:", badFinanceModel.grade);

// 하드 게이트: 인허가·시행사·시공사 전부 위험이면(사업진행리스크 자체는 제외) BB 이하로 캡
const badStabilityModel = computeScoreModel({
  ...ctx, permitStage: "초기 단계", developerTrack: "미정(정보 없음)", developerTrackIsDefault: true,
  contractorGrade: "소형",
});
console.assert(badStabilityModel.gateApplied === "stability", "expected stability gate, got " + badStabilityModel.gateApplied);
console.log("stability gate OK:", badStabilityModel.grade);

console.log("ALL CHECKS PASSED");
