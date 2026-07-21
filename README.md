# PF 사업성 심사 리포트 생성기 — 이식용 프로젝트

부동산 PF(프로젝트 파이낸싱) 심사역(신탁사·캐피탈·저축은행·자산운용사)을 위한
사업성 분석 리포트 MVP. 지금은 용도지역별 평균 시세/용적률 가정으로 동작하는
데모이며, 이 프로젝트는 실제 공공데이터 연동까지 이어서 작업할 수 있게
구조를 잡아둔 상태입니다.

## 이 폴더를 다른 Claude 계정으로 옮기는 법

1. 이 폴더 전체(zip)를 다운로드
2. 업그레이드된 계정에서 **Claude Code**를 열고, 이 zip을 압축 해제한 폴더를 프로젝트로 열기
   (또는 Claude Code 웹/데스크톱 앱에서 "새 프로젝트 → 폴더 선택")
3. 새 세션 시작 시 `CONTEXT.md` 파일 내용을 그대로 붙여넣으면, 지금까지의 사업 방향·
   경쟁사 분석·피벗 결정 배경을 새 계정의 Claude도 바로 파악합니다.
   (메모리는 계정 간에 자동으로 옮겨지지 않기 때문에, 이 파일이 그 역할을 대신합니다.)

## 로컬 실행

```bash
npm install
npm run dev
```

`http://localhost:5173` 에서 지금 채팅에서 본 것과 동일한 데모가 그대로 뜹니다.

## API 키 상태

`.env.local`에 국토부 실거래가 서비스키(`VITE_MOLIT_API_KEY`)가 이미 채워져 있습니다.
7개 데이터셋(아파트/아파트상세/연립다세대/오피스텔/단독다가구/상업업무용/토지) 모두
이 키 하나로 호출되도록 `src/lib/realDataFetcher.js`에 연결해뒀습니다.

**다만 이 키가 실제로 동작하는지는 이 대화 세션에서 검증하지 못했습니다.**
Claude의 작업 환경(샌드박스)은 네트워크 정책상 `apis.data.go.kr` 접속이 막혀 있어서입니다.
(`Host not in allowlist` 오류) 아래 명령으로 직접 확인해보세요:

```bash
node test-api.mjs
```

정상이면 `HTTP status: 200`과 함께 XML 응답(거래 목록)이 출력됩니다.
`SERVICE KEY IS NOT REGISTERED ERROR` 같은 메시지가 나오면 data.go.kr에서 해당
데이터셋 활용신청이 아직 "승인대기" 상태일 수 있으니 마이페이지에서 승인 여부를 확인하세요.

## 실데이터 연동까지 이어서 하려면 (Claude Code에서 요청할 작업)

지금 이 프로젝트는 **목업 로직(`src/components/PFReportMVP.jsx` 안의 `runAnalysis`)**과
**실데이터 스캐폴드(`src/lib/realDataFetcher.js`)**가 분리되어 있습니다. 새 계정에서
Claude Code에게 아래처럼 요청하면 이어서 진행할 수 있습니다.

> "`src/lib/realDataFetcher.js`의 `fetchAptTrades`, `fetchLandUseZone`을
> `PFReportMVP.jsx`의 `runAnalysis`에 연결해서, 가정치 대신 실제 실거래가·용도지역
> 데이터를 쓰도록 리팩터링해줘."

### 직접 해야 하는 것 (제가 대신 할 수 없는 부분)

- **data.go.kr 회원가입 + "국토교통부_아파트매매 실거래 상세 자료" 활용신청** →
  `VITE_MOLIT_API_KEY` 발급 (본인 명의 계정으로만 발급 가능, 보통 즉시~1일)
- **vworld.kr 회원가입 + Open API 키 발급** → `VITE_VWORLD_API_KEY`
- 발급받은 키를 `.env.example`을 복사한 `.env.local`에 채워넣기
- (선택) 주소 → 법정동코드/PNU 변환용 지오코딩 키 (카카오·네이버 지도 API 등, 별도 발급 필요)

이 세 가지는 전부 본인 명의로 개인정보·이용약관 동의가 필요한 절차라 제가 대신
가입하거나 키를 발급받을 수 없습니다. 키만 발급받아 `.env.local`에 넣으면, 나머지
연동 작업(파싱, 리포트 반영, 에러 처리)은 Claude Code에서 이어서 요청하시면 됩니다.

## 폴더 구조

```
pf-project/
├── CONTEXT.md              ← 새 세션에 붙여넣을 사업 배경 요약
├── README.md                ← 이 파일
├── package.json
├── vite.config.js            ← MOLIT/V-World API 프록시 설정 (CORS 우회)
├── .env.example
├── index.html
└── src/
    ├── main.jsx
    ├── components/
    │   └── PFReportMVP.jsx   ← 현재 데모 (목업 로직 포함)
    └── lib/
        └── realDataFetcher.js ← 실데이터 연동 스캐폴드 (키만 넣으면 동작)
```
