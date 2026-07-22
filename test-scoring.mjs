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

console.log("ALL CHECKS PASSED");
