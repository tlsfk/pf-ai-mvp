# PF 사업성 심사 리포트 생성기 (Quick Screening MVP)

부동산 PF(프로젝트 파이낸싱) 심사역(신탁사·캐피탈·저축은행·자산운용사)을 위한
1차 사업성 검토 도구. 주소 입력 → 실거래가/용도지역 자동조회 → AI 채점 →
심사 리포트 생성(PDF/Excel)까지 전 플로우가 동작하는 MVP입니다.

**현재 상태**: 실거래가(국토부)·용도지역/공시지가(브이월드) 실데이터 연동 완료,
자체 채점모델(v1.4.1)로 등급 산정, 실제 PF 사례 13건(성공3·지연1·부도7·진행중(결과미확정)1·더미1)으로
검증 완료. 상세 진행상황은 `CONTEXT.md` 참고.

## 이 폴더를 다른 Claude 계정으로 옮기는 법

1. 이 폴더 전체(zip)를 다운로드
2. 업그레이드된 계정에서 **Claude Code**를 열고, 이 zip을 압축 해제한 폴더를 프로젝트로 열기
   (또는 Claude Code 웹/데스크톱 앱에서 "새 프로젝트 → 폴더 선택")
3. 새 세션 시작 시 `CONTEXT.md` 파일 내용을 그대로 붙여넣으면, 지금까지의 사업 방향·
   경쟁사 분석·기능 구현 이력·미해결 과제를 새 계정의 Claude도 바로 파악합니다.
   (메모리는 계정 간에 자동으로 옮겨지지 않기 때문에, 이 파일이 그 역할을 대신합니다.)

## 로컬 실행

```bash
npm install
npm run dev
```

`http://localhost:5173` 에서 데모가 뜹니다. 주소를 입력하고 필드에서 벗어나면
용도지역·공시지가가 자동조회되고(브이월드), "사업성 분석 실행"을 누르면
실거래가 반영 리포트가 생성됩니다.

## API 키 상태

`.env.local`에 아래 키들이 채워져 있습니다(전부 실제 호출 검증 완료). `VITE_` 접두사가
**없는** 것이 의도된 설계입니다 — 서버(로컬은 vite dev 프록시, 배포는 `api/molit`·
`api/vworld` Vercel 서버리스 함수)에서만 읽고 클라이언트 번들에는 절대 포함되지 않습니다
(2026-07-24, 프로덕션 노출 문제 수정 완료 — 아래 참고):

- `MOLIT_API_KEY` — 국토부 실거래가 7종(아파트/아파트상세/연립다세대/오피스텔/
  단독다가구/상업업무용/토지), `src/lib/realDataFetcher.js`에서 사용
- `VWORLD_API_KEY` — 브이월드 지오코딩+토지특성정보(용도지역·개별공시지가),
  같은 파일에서 사용
- `VITE_HUG_*` 3종(사고사업장정보/이행사업장정보/분양이력정보) — **앱 코드에서는
  아직 안 씀**, PF 사례 검증용 실제 사례 리서치(`data/pf-cases/`)에만 사용한 키

Vercel 배포 시 프로젝트 환경변수(Settings → Environment Variables)에 `MOLIT_API_KEY`,
`VWORLD_API_KEY`를 등록하면 `api/molit`, `api/vworld` 서버리스 함수가 자동으로 읽습니다.

실거래가 API가 정상 동작하는지 직접 확인하려면:

```bash
node test-api.mjs
```

## 검증 스크립트

```bash
node test-scoring.mjs          # 채점모델(scoring/index.js) 회귀 테스트
node test-pf-cases.mjs         # PF 사례 13건 AI등급 vs 실제결과 비교 검증
node test-excel-extractor.mjs  # 사업수지 엑셀 업로드 자동추출(excelExtractor.js) 회귀 테스트
```

`npm run build` / `npm run lint`와 함께 코드 변경 후 항상 이 5개를 통과 확인하는 게
이 프로젝트의 관행입니다(`CLAUDE.md`의 Definition of Done 참고).

## 폴더 구조

```
pf-project-FINAL/
├── CONTEXT.md                 ← 새 세션에 붙여넣을 사업 배경 + 진행상황 요약
├── CLAUDE.md                  ← 개발 워크플로 규칙(커밋 컨벤션, DoD 등)
├── README.md                  ← 이 파일
├── package.json
├── vite.config.js             ← MOLIT/V-World API 프록시 설정(CORS 우회)
├── .env.example / .env.local
├── test-api.mjs               ← MOLIT API 연결 확인용
├── test-scoring.mjs           ← 채점모델 회귀 테스트
├── test-pf-cases.mjs          ← PF 사례 검증 회귀 테스트
├── test-excel-extractor.mjs   ← 사업수지 엑셀 자동추출 회귀 테스트
├── data/
│   └── pf-cases/               ← PF 사례 13건(케이스별 JSON) + 스키마 설명(README.md)
├── docs/superpowers/
│   ├── specs/                  ← 브레인스토밍 결과 설계 문서
│   └── plans/                  ← 구현 계획 문서
└── src/
    ├── main.jsx
    ├── components/
    │   └── PFReportMVP.jsx     ← 리포트 UI(입력 폼 + 리포트 렌더링)
    └── lib/
        ├── analysis.js         ← runAnalysis(핵심 계산: 사업수지·LTV·DSCR 등)
        ├── scoring/index.js    ← 채점모델(카테고리별 배점·하드게이트·등급 산정)
        ├── pfCases.js          ← PF 사례 로딩 + AI등급 vs 실제결과 판정 로직
        ├── realDataFetcher.js  ← 국토부 실거래가 + 브이월드 실데이터 연동
        ├── lawdCodes.js        ← 전국 법정동코드(LAWD_CD) 매핑
        ├── excelExtractor.js   ← 사업수지 엑셀 업로드 → 폼 필드 자동 추출(North Star 1단계)
        └── analysisStorage.js  ← 분석 이력 localStorage 저장/조회
```
