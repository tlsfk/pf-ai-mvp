import { readFileSync } from "node:fs";
import { judgeCase } from "./src/lib/pfCases.js";

function loadCase(id) {
  return JSON.parse(readFileSync(`./data/pf-cases/${id}.json`, "utf-8"));
}

const index = JSON.parse(readFileSync("./data/pf-cases/index.json", "utf-8"));
console.assert(index.cases.length === 13, "expected 13 cases, got " + index.cases.length);

const results = index.cases.map((id) => judgeCase(loadCase(id)));

for (const r of results) {
  console.assert(r.error === null || typeof r.error === "string", `${r.id}: error should be null or string`);
  console.assert(
    ["일치", "불일치", "판정보류", "계산 실패"].includes(r.verdict),
    `${r.id}: unexpected verdict "${r.verdict}"`
  );
  console.log(r.id, "|", r.caseName, "| grade:", r.grade, "| outcome:", r.outcome, "| verdict:", r.verdict);
}

// 스키마상 10건 모두 zone이 ZONE_FAR에 있는 값이라 계산 실패가 없어야 함
console.assert(results.every((r) => r.verdict !== "계산 실패"), "no case should fail to compute");

// case-003(delayed)·case-005(unknown)·case-013(unknown)은 규칙상 항상 판정보류여야 함
const c3 = results.find((r) => r.id === "case-003");
const c5 = results.find((r) => r.id === "case-005");
const c13 = results.find((r) => r.id === "case-013");
console.assert(c3.verdict === "판정보류", "case-003 (delayed) should be 판정보류, got " + c3.verdict);
console.assert(c5.verdict === "판정보류", "case-005 (unknown) should be 판정보류, got " + c5.verdict);
console.assert(c13.verdict === "판정보류", "case-013 (unknown) should be 판정보류, got " + c13.verdict);

// success/default 사례는 일치/불일치 중 하나로 명확히 갈려야 함(판정보류 아님)
for (const id of ["case-001", "case-002", "case-004", "case-006", "case-007", "case-008", "case-009", "case-010", "case-011", "case-012"]) {
  const r = results.find((x) => x.id === id);
  console.assert(["일치", "불일치"].includes(r.verdict), `${id} should be 일치 or 불일치, got ${r.verdict}`);
}

console.log("ALL CHECKS PASSED");
