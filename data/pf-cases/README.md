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

## 향후 계획 (아직 구현 안 됨)

1. `input`을 `runAnalysis()`에 넣어 `aiResult`를 채우는 로더/스크립트
2. `aiResult.grade` vs `actual.outcome`/`actual.actualGrade`를 비교하는 검증 리포트
   (예: "AI가 BB 이하로 게이트 캡한 사례 중 실제로 `default`가 된 비율" 같은 정밀도 지표)
3. `status: "dummy"` 사례를 실제 사례로 하나씩 교체(계약서·공시자료 등 출처 명시 필수)

## 주의

- 아래 5개 사례는 전부 **더미 데이터**입니다(`status: "dummy"`, `source`에 명시). 실제
  사업지·시행사 정보가 아니므로 그대로 실서비스 근거로 쓰면 안 됩니다.
