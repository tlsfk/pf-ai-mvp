# PF 사례 검증 패널 설계

## 배경

`data/pf-cases/`에 스키마와 더미 사례 5건이 이미 존재(README.md 참고). AI 분석결과(`aiResult`)와
실제 사업결과(`actual`)를 비교하는 로직/UI는 아직 없는 상태였다. 이번 작업은 그 비교 기능을
만드는 것이다. 더미 5건을 실제 사례로 교체하는 작업(실계약서/공시자료 필요)은 이번 범위에서
제외한다 — 사용자가 추후 직접 확보해서 JSON만 교체하면 되도록 구조만 맞춘다.

## 목표

- 케이스 5건 각각에 대해 `runAnalysis(case.input)`을 실행해 AI 등급을 재현
- `actual.outcome`과 AI 등급의 `gradeBand`를 규칙 기반으로 비교해 일치/불일치/판정보류 표시
- 앱 UI 안에 패널로 노출(비개발자도 확인 가능)
- 케이스 JSON을 실제 사례로 교체해도 코드 변경 없이 그대로 동작

## 판정 규칙

`src/lib/scoring/index.js`의 `gradeBand`는 `high / good / speculative / weak / default` 5단계.

| actual.outcome | AI band가 high/good | AI band가 speculative/weak/default |
|---|---|---|
| success | 일치 | 불일치 (AI가 과도하게 박함) |
| default | 불일치 (AI가 리스크를 놓침 — 가장 위험한 오판) | 일치 |
| delayed / unknown | 판정 보류 (등급만 표시, 참고용) | 판정 보류 |

## 구현 범위

1. **`PFReportMVP.jsx`**: `runAnalysis` 함수에 `export` 추가(재사용을 위한 최소 변경). 로직
   자체는 건드리지 않음.
2. **`src/lib/pfCases.js`** (신설):
   - `import.meta.glob("../../data/pf-cases/case-*.json", { eager: true })`로 5건 로드
   - `judgeCase(caseObj)` — 위 판정 규칙에 따라 `{ grade, gradeBand, verdict }` 반환
     - `runAnalysis` 실행이 예외를 던지면(예: `zone`이 `ZONE_FAR`에 없는 값) `verdict: "error"`와
       에러 메시지를 반환 — 그 사례만 실패 표시, 나머지 계산에는 영향 없음
   - `loadCaseComparisons()` — 5건 전부에 `judgeCase` 적용한 배열 반환
3. **UI**: `PFReportMVP.jsx` 헤더의 기존 "분석 이력" 토글 옆에 "PF 사례 검증" 토글 버튼 추가.
   열면 `loadCaseComparisons()`를 실행해 표로 렌더링:
   `사례명 | AI등급 | 실제결과(outcome) | 판정 | 근거(간단 설명)`
   - 패널을 열 때만 계산 실행(초기 렌더에서 미리 돌리지 않음)
4. **자체 점검**: `test-scoring.mjs`와 같은 패턴으로 5건을 실행해 각 케이스가 예외 없이 계산되고
   `verdict`가 예상 카테고리(success/default/delayed/unknown) 중 하나로 나오는지 확인하는 assert
   기반 체크를 추가(별도 테스트 프레임워크 없음).

## 범위 밖

- 더미 케이스를 실제 사례로 교체 (사용자가 추후 진행)
- confusion matrix / precision·recall 같은 정식 통계 지표 (5건짜리엔 과함)
- 케이스 추가/편집 UI (지금은 JSON 파일 직접 편집만 지원)
