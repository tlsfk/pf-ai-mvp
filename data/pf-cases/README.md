# PF 사례 검증 데이터 (data/pf-cases)

이 폴더는 AI(이 앱)의 분석 결과와 **실제 PF 사업 결과**를 나중에 비교·검증하기 위한
데이터 구조입니다. 지금은 구조와 더미 데이터만 있고, 비교 로직/UI는 아직 없습니다
(향후 별도 기능으로 추가 예정).

## 파일 구성

- `index.json` — 이 폴더에 있는 사례 파일 목록(향후 로더가 이 파일만 보고 전체 사례를
  동적 glob 없이 나열할 수 있게 하기 위함)
- `case-XXX.json` — 사례 1건. 스키마는 아래 참고

## 사례 스키마 (`case-XXX.json`)

```jsonc
{
  "id": "case-001",                 // 파일명과 동일하게 유지
  "caseName": "사람이 읽을 사례명",
  "status": "dummy",                // "dummy"(더미) | "verified"(실제 사례로 확인됨)
  "source": "출처 — 실제 사례로 교체 시 여기에 근거(계약서/공시자료 등) 명시",
  "input": {
    // src/components/PFReportMVP.jsx의 `form` state와 동일한 필드 구조.
    // 이렇게 맞춰두면 향후 로더가 이 값을 그대로 runAnalysis()에 넣어
    // "AI가 이 입력값으로 냈을 결과"를 재현할 수 있습니다.
    "address": "", "area": "", "zone": "", "projectType": "", "lender": "",
    "developerTrack": "", "contractorGrade": "", "locationTier": "",
    "supplyCompetition": "", "creditEnhancement": "", "permitStage": "",
    "expectedSaleRate": "", "equityRatio": "", "interestRate": "",
    "originationFee": "", "loanTermMonths": ""
  },
  "actual": {
    // 실제 사업 진행 결과(더미 사례는 값을 비워두거나 가정치로 채움)
    "totalCost": null,       // 실제 총사업비(만원)
    "salesRate": null,       // 실제 최종 분양률(%)
    "outcome": "unknown",    // "success" | "delayed" | "default" | "unknown"
    "actualGrade": null,     // 사후 평가 등급(있다면, 예: 대주단 자체 평가)
    "notes": ""              // 실제 사례 특이사항
  },
  "aiResult": null           // 이 앱으로 분석을 돌린 결과 캐시(등급/총점 등). 향후 비교
                              // 기능에서 채워 넣는 자리 — 지금은 항상 null
}
```

## 진행 상황 (2026-07-22)

1. `input`을 `runAnalysis()`에 넣어 `aiResult`를 채우는 로더/스크립트 — 완료
   (`src/lib/pfCases.js`의 `judgeCase`/`loadCases`, 앱 UI의 "PF 사례 검증" 패널)
2. `actual.outcome`과 AI 등급을 비교하는 판정 로직 — 완료(규칙 기반 일치/불일치/판정보류).
   정식 precision/recall 같은 통계 리포트는 아직 없음(사례 수가 적어 보류)
3. `status: "dummy"` 사례를 실제 사례로 교체 — `case-001`(성공)·`case-003`(지연)·`case-004`(부도)
   완료(공공기관 공시자료·언론보도 근거, 아래 "주의" 참고). 나머지 2건(`case-002`·`case-005`)은 아직 더미

## 주의

- `case-001`·`case-003`·`case-004`를 제외한 나머지 2개 사례는 **더미 데이터**입니다
  (`status: "dummy"`, `source`에 명시). 실제 사업지·시행사 정보가 아니므로 그대로 실서비스
  근거로 쓰면 안 됩니다.
- `case-001`(`status: "verified"`)은 서울시 정비사업 정보몽땅(공공포털)의 대지면적·세대수와
  언론보도(청약경쟁률·분양가·입주일)가 근거인 실제 사례(래미안 원베일리)입니다. 용도지역과
  PF 금융조건(금리·자기자본비율 등)은 비공개라 앱의 기본 미정값을 그대로 썼습니다.
- `case-003`(`status: "verified"`)은 지역신문 보도가 근거인 실제 사례(통영 더유엘 윈썸)로,
  주소·대지면적·규모·시공사 부도 경위·HUG 처리 방식(계속사업)은 실제 수치입니다. 용도지역·
  PF 대출조건·정확한 분양률은 비공개라 앱의 기본 미정값을 썼습니다.
- `case-004`(`status: "verified"`)는 주소·대지면적·연면적·타임라인·공매 이력은 언론 보도(제주의소리)
  기준 실제 수치이지만, 정확한 지번·용도지역·시행사명·PF 금융조건(금리·자기자본비율 등)은 비공개
  정보라 앱의 기본 미정값을 그대로 썼습니다 — `source` 필드에 어떤 값이 실제고 어떤 값이 미정
  기본값인지 명시되어 있으니 참고하세요.
