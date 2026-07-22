# PF 사례 검증 패널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `data/pf-cases`의 더미 5건에 대해 AI 등급을 재현하고, 실제 사업결과와 규칙 기반으로
비교(일치/불일치/판정보류)하는 패널을 앱에 추가한다.

**Architecture:** 기존 `PFReportMVP.jsx` 안에 있던 순수 계산 함수 `runAnalysis`를 `src/lib/analysis.js`로
분리해 Node에서도 직접 테스트 가능하게 만든 뒤, 그 위에 `src/lib/pfCases.js`(사례 로딩 + 판정 로직)를
쌓고, 마지막으로 `PFReportMVP.jsx`에 토글 패널 UI를 붙인다.

**Tech Stack:** React 18(JSX), Vite 5(`import.meta.glob`), plain Node ESM 스크립트(회귀테스트, 프레임워크 없음)

## Global Constraints

- 기존 채점 엔진(`src/lib/scoring/index.js`) 로직은 변경하지 않는다 (설계 문서 범위 제한).
- 더미 케이스 데이터(`data/pf-cases/case-*.json`)는 이번 작업에서 수정하지 않는다.
- 코드 스타일: 이 프로젝트는 세미콜론 사용, 큰따옴표(`"`) 문자열 컨벤션을 따른다(기존 파일 참고).
- 기능 하나당 커밋 하나(`CLAUDE.md` 커밋 규칙) — 이 계획의 태스크 3개가 각각 하나의 커밋 단위다.
- 매 태스크 끝에 `npm run build`와 `npm run lint` 통과 확인(프로젝트 DoD).

---

### Task 1: `runAnalysis` 계산 엔진을 `src/lib/analysis.js`로 분리

**Files:**
- Create: `src/lib/analysis.js`
- Modify: `src/components/PFReportMVP.jsx:1-253` (정의 제거 + import 추가)
- Test: `test-scoring.mjs` (기존 회귀 스크립트, 변경 없이 재실행해 이 리팩터가 채점 로직에
  영향 없음을 확인)

**Interfaces:**
- Produces (Task 2가 사용): `export function runAnalysis(form, realPricePerPy = null, compsCount = 0)`
  — 반환값에 최소한 `{ grade: string, gradeColor: string, gradeBand: string }` 포함
- Produces (Task 3이 계속 사용): `export const ZONE_FAR`, `export const PLACEHOLDER_DEFAULTS`

이 태스크는 로직을 한 글자도 바꾸지 않는 순수 이동(move)이다. 새 테스트를 추가하지 않고,
기존 회귀 스크립트가 여전히 통과하는지로 검증한다.

- [ ] **Step 1: 이동 전 베이스라인 확인**

Run: `node test-scoring.mjs`
Expected: 마지막 줄에 `ALL CHECKS PASSED` 출력 (지금은 통과해야 정상 — 이 리팩터와 무관한 채점
엔진 자체의 회귀 테스트이므로, 실패 시 이 작업을 시작하기 전에 먼저 원인을 확인할 것)

- [ ] **Step 2: `src/lib/analysis.js` 생성**

`src/components/PFReportMVP.jsx`의 79~126번 줄(`// ---- deterministic pseudo-analysis engine`
주석부터 `DEFAULT_SOFT_COST_RATIO` 선언까지)과 128~253번 줄(`runAnalysis` 함수 전체, JSDoc 포함)을
그대로 옮기되 각 선언에 `export`를 붙인다:

```js
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
  equityRatio = Number(equityRatio);
  interestRate = Number(interestRate);
  originationFee = Number(originationFee);
  loanTermMonths = Number(loanTermMonths);
  expectedSaleRate = Number(expectedSaleRate);
  const far = ZONE_FAR[zone];
  const landAreaPy = Number(area) / 3.3058;
  const grossFloorPy = landAreaPy * (far / 100);

  const usingRealData = realPricePerPy != null;
  const priceMultiplier = 1.7 + seededRand(seed, 2) * 0.9;
  const landPricePerPy = usingRealData ? realPricePerPy / priceMultiplier : 900 + Math.floor(seededRand(seed, 1) * 2200);
  const salesPricePerPy = usingRealData ? realPricePerPy : landPricePerPy * priceMultiplier;

  const constructionCostPerPyUser = Number(constructionCostPerPyInput);
  const constructionCostPerPy = constructionCostPerPyUser > 0 ? constructionCostPerPyUser : DEFAULT_CONSTRUCTION_COST_PER_PY;
  const constructionCostSource = constructionCostPerPyUser > 0 ? "사용자 입력값" : "기본값(근거 없음, 미입력)";

  const landCostOverrideNum = Number(landCostOverride);
  const landCost = landCostOverrideNum > 0 ? landCostOverrideNum : landAreaPy * landPricePerPy;
  const landCostSource = landCostOverrideNum > 0 ? "사용자 입력값(총액)" : (usingRealData ? "국토교통부 실거래가 역산" : "가정치(근거 없음, 미입력)");
  const constructionCost = grossFloorPy * constructionCostPerPy;

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
  const baseCost = landCost + constructionCost + generalCost;

  const er = equityRatio / 100;
  const years = loanTermMonths / 12;
  const r = (interestRate / 100) * years + originationFee / 100;
  const loanDenominator = 1 - r * (1 - er);
  const financialModelInvalid = loanDenominator <= 0.05;
  const calcLoanAmount = financialModelInvalid ? baseCost * (1 - er) : (baseCost * (1 - er)) / loanDenominator;
  const calcFinanceCost = calcLoanAmount * r;
  const calcTotalCost = baseCost + calcFinanceCost;

  const totalCostOverrideNum = Number(totalCostOverride);
  const usingTotalCostOverride = totalCostOverrideNum > 0;
  const totalCost = usingTotalCostOverride ? totalCostOverrideNum : calcTotalCost;
  const loanAmount = usingTotalCostOverride ? totalCost * (1 - er) : calcLoanAmount;
  const financeCost = usingTotalCostOverride ? totalCost - baseCost : calcFinanceCost;
  const equityAmount = totalCost - loanAmount;
  const totalCostSource = usingTotalCostOverride ? "사용자 입력값(우선 적용)" : "자동 계산(토지비+공사비+소프트비용+금융비용)";

  const salesRevenue = grossFloorPy * salesPricePerPy;
  const profit = salesRevenue - totalCost;
  const margin = (profit / totalCost) * 100;

  const ltv = (loanAmount / salesRevenue) * 100;
  const annualProfit = profit / years;
  const annualInterest = loanAmount * (interestRate / 100);
  const dscr = (annualProfit / annualInterest).toFixed(2);
  const allInCost = allInCostRate(interestRate, originationFee, loanTermMonths);

  const scoreModel = computeScoreModel({
    ltv, dscr, equityRatio, allInCost,
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
```

주의: `computeScoreModel`/`collateralTier` import는 `./scoring/index.js`처럼 확장자와 `index.js`를
명시한다(원본 컴포넌트의 `"../lib/scoring"` 축약형은 Vite 번들러 전용 해석이라, 이후 Task 2의
Node 회귀 스크립트에서 이 파일을 그대로 import할 때 plain Node ESM은 확장자 없는 폴더 import를
지원하지 않아 실패한다).

- [ ] **Step 3: `PFReportMVP.jsx`에서 이동한 정의 제거하고 import로 교체**

`src/components/PFReportMVP.jsx`의 79~126번 줄과 128~253번 줄(옮긴 블록 전체)을 삭제하고,
파일 상단 import 블록(1~11번 줄)에 아래 줄을 추가:

```js
import { runAnalysis, ZONE_FAR, PLACEHOLDER_DEFAULTS } from "../lib/analysis";
```

(`hashSeed`/`seededRand`/`allInCostRate`/`DEFAULT_CONSTRUCTION_COST_PER_PY`/`DEFAULT_SOFT_COST_RATIO`는
`runAnalysis` 내부에서만 쓰였으므로 컴포넌트 쪽에서 별도로 import할 필요 없음. `ZONE_FAR`는 489·753번
줄, `PLACEHOLDER_DEFAULTS`는 461번 줄에서 계속 쓰이므로 반드시 import에 포함.)

- [ ] **Step 4: 빌드·린트·회귀 테스트로 검증**

Run: `npm run build`
Expected: 에러 없이 `dist/` 생성 (import 경로가 틀렸다면 여기서 모듈 resolve 에러로 드러남)

Run: `npm run lint`
Expected: 에러 없음(사용하지 않게 된 지역 변수가 남아있으면 `no-unused-vars` 경고 발생 — 있다면 제거)

Run: `node test-scoring.mjs`
Expected: `ALL CHECKS PASSED` (Step 1과 동일한 결과 — 채점 엔진 자체는 손대지 않았으므로 변화 없어야 함)

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis.js src/components/PFReportMVP.jsx
git commit -m "refactor: runAnalysis 계산 엔진을 src/lib/analysis.js로 분리"
```

---

### Task 2: 사례 판정 로직 (`src/lib/pfCases.js`) + 회귀 테스트

**Files:**
- Create: `src/lib/pfCases.js`
- Create: `test-pf-cases.mjs` (프로젝트 루트, `test-scoring.mjs`와 동일한 컨벤션)

**Interfaces:**
- Consumes: `runAnalysis(form, realPricePerPy, compsCount)` from Task 1
  (`src/lib/analysis.js`) — 반환값의 `grade`, `gradeColor`, `gradeBand` 사용
- Produces (Task 3이 사용):
  - `export function judgeCase(caseObj)` → `{ id, caseName, grade, gradeColor, gradeBand, outcome, verdict, error }`
    (`verdict`는 `"일치" | "불일치" | "판정보류" | "계산 실패"` 중 하나, `error`는 실패 시 메시지 문자열 아니면 `null`)
  - `export function loadCases()` → 5건의 케이스 객체 배열(`data/pf-cases/README.md` 스키마와 동일)
  - `export function loadCaseComparisons()` → `loadCases().map(judgeCase)`

`judgeCase`는 `import.meta.glob`을 쓰지 않는 순수 함수라 plain Node에서 직접 테스트 가능하다.
`loadCases`/`loadCaseComparisons`만 Vite 전용(`import.meta.glob`)이라 브라우저 안에서만 동작 —
그래서 회귀 테스트는 `judgeCase`만 직접 검증하고, 케이스 파일은 `fs`로 직접 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test-pf-cases.mjs` (프로젝트 루트, 신규 파일):

```js
import { readFileSync } from "node:fs";
import { judgeCase } from "./src/lib/pfCases.js";

function loadCase(id) {
  return JSON.parse(readFileSync(`./data/pf-cases/${id}.json`, "utf-8"));
}

const index = JSON.parse(readFileSync("./data/pf-cases/index.json", "utf-8"));
console.assert(index.cases.length === 5, "expected 5 dummy cases, got " + index.cases.length);

const results = index.cases.map((id) => judgeCase(loadCase(id)));

for (const r of results) {
  console.assert(r.error === null || typeof r.error === "string", `${r.id}: error should be null or string`);
  console.assert(
    ["일치", "불일치", "판정보류", "계산 실패"].includes(r.verdict),
    `${r.id}: unexpected verdict "${r.verdict}"`
  );
  console.log(r.id, "|", r.caseName, "| grade:", r.grade, "| outcome:", r.outcome, "| verdict:", r.verdict);
}

// 스키마상 5건 모두 zone이 ZONE_FAR에 있는 값이라 계산 실패가 없어야 함
console.assert(results.every((r) => r.verdict !== "계산 실패"), "no dummy case should fail to compute");

// case-003(delayed)과 case-005(unknown)는 규칙상 항상 판정보류여야 함
const c3 = results.find((r) => r.id === "case-003");
const c5 = results.find((r) => r.id === "case-005");
console.assert(c3.verdict === "판정보류", "case-003 (delayed) should be 판정보류, got " + c3.verdict);
console.assert(c5.verdict === "판정보류", "case-005 (unknown) should be 판정보류, got " + c5.verdict);

// case-001/002(success)와 case-004(default)는 일치/불일치 중 하나로 명확히 갈려야 함(판정보류 아님)
for (const id of ["case-001", "case-002", "case-004"]) {
  const r = results.find((x) => x.id === id);
  console.assert(["일치", "불일치"].includes(r.verdict), `${id} should be 일치 or 불일치, got ${r.verdict}`);
}

console.log("ALL CHECKS PASSED");
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node test-pf-cases.mjs`
Expected: `Cannot find module './src/lib/pfCases.js'` 에러로 실패 (아직 파일이 없으므로 정상)

- [ ] **Step 3: `src/lib/pfCases.js` 구현**

```js
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node test-pf-cases.mjs`
Expected: 5줄의 케이스별 로그 다음 `ALL CHECKS PASSED` 출력, 종료 코드 0

- [ ] **Step 5: 빌드·린트 확인**

Run: `npm run build`
Expected: 에러 없이 성공 (`import.meta.glob`이 Vite 빌드 시 정상적으로 5개 JSON을 정적 포함하는지 확인)

Run: `npm run lint`
Expected: 에러 없음

- [ ] **Step 6: Commit**

```bash
git add src/lib/pfCases.js test-pf-cases.mjs
git commit -m "feat: PF 사례 AI등급 vs 실제결과 판정 로직 추가"
```

---

### Task 3: UI 패널 (`PFReportMVP.jsx`)

**Files:**
- Modify: `src/components/PFReportMVP.jsx` (import 추가, state 추가, 버튼+패널 JSX 추가)

**Interfaces:**
- Consumes: `loadCaseComparisons()` from Task 2 (`src/lib/pfCases.js`) — 반환 배열의 각 원소는
  `{ id, caseName, grade, gradeColor, gradeBand, outcome, verdict, error }` (Task 2 인터페이스 정의 참고)

패널은 기존 "분석 이력" 토글과 같은 자리(좌측 입력 폼 하단)에, 같은 스타일로 추가한다. 패널을
처음 열 때만 `loadCaseComparisons()`를 호출해 결과를 state에 캐시한다(초기 렌더에서 미리 계산하지 않음).

- [ ] **Step 1: import 및 상수 추가**

`src/components/PFReportMVP.jsx` 상단 import 블록에 추가:

```js
import { loadCaseComparisons } from "../lib/pfCases";
```

`ZONE_FAR` 등 기존 상수 선언부 근처(자유 위치, 컴포넌트 함수 바깥)에 표시용 매핑 추가:

```js
const OUTCOME_LABEL = { success: "성공", delayed: "지연", default: "부도", unknown: "미확정" };
const VERDICT_COLOR = { 일치: "#8AB89A", 불일치: "#D98C7A", 판정보류: "#9A9E9F", "계산 실패": "#D98C7A" };
```

- [ ] **Step 2: state 추가**

`showHistory` state 선언(현재 472번 줄) 바로 아래에 추가:

```js
const [showCaseValidation, setShowCaseValidation] = useState(false); // PF 사례 검증 패널 펼침 여부
const [caseComparisons, setCaseComparisons] = useState(null); // 첫 오픈 시 1회만 계산해 캐시
```

- [ ] **Step 3: 토글 버튼과 패널 JSX 추가**

기존 "분석 이력" 패널 블록(937~961번 줄, `{showHistory && ( ... )}` 전체)이 끝나는 `)}` 바로
다음 줄에 추가:

```jsx
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
```

- [ ] **Step 4: 빌드·린트 확인**

Run: `npm run build`
Expected: 에러 없이 성공

Run: `npm run lint`
Expected: 에러 없음

- [ ] **Step 5: 개발 서버에서 육안 확인**

Run: `npm run dev`
브라우저에서 `http://localhost:5173` 접속 → 좌측 폼 하단 "분석 이력" 버튼 아래 "PF 사례 검증"
버튼이 보이는지 확인 → 클릭해서 패널이 펼쳐지고, 5개 사례가 각각 사례명·AI등급·실제결과·판정으로
표시되는지 확인. `case-003`(지연)과 `case-005`(미확정)은 "판정보류"로, 나머지 3건은 "일치" 또는
"불일치"로 표시되어야 한다. 콘솔에 에러가 없는지 확인.

Expected: 5건 전부 정상 표시, 콘솔 에러 없음

- [ ] **Step 6: Commit**

```bash
git add src/components/PFReportMVP.jsx
git commit -m "feat: PF 사례 검증 패널 UI 추가"
```
