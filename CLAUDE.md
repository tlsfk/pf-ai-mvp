# 개발 워크플로 규칙

이 프로젝트에서 작업할 때 아래 규칙을 따릅니다.

## 커밋 규칙

- 기능 하나 완료할 때마다 커밋. **여러 기능을 한 커밋에 절대 묶지 않는다.**
- 커밋 메시지 접두사:
  - `feat:` 새 기능 (예: `feat: 브이월드 API 구조 추가`, `feat: 공사비 직접 입력`, `feat: 엑셀 업로드`)
  - `fix:` 버그 수정 (예: `fix: 금융비용 계산 수정`)
  - `refactor:` 동작 변화 없는 구조 정리 (예: `refactor: 계산 로직 정리`)

## 브랜치 전략

- `main`: 항상 배포 가능한 상태 유지
- 기능별 브랜치에서 작업: `feature/vworld`, `feature/excel`, `feature/pdf`, `feature/pf-data` 등
- `main`에 merge하기 전에 반드시 build 확인

## 릴리즈 기준

| 버전 | 내용 |
|---|---|
| v1.0 | 현재 MVP |
| v1.1 | 브이월드 연동 |
| v1.2 | 엑셀 |
| v1.3 | PF 사례 검증 |
| v2.0 | 정밀 재무분석 (IRR, ROE 등) |

## 작업 종료 시 확인 (Definition of Done)

- [ ] `npm install` 성공
- [ ] `npm run build` 성공
- [ ] `node test-scoring.mjs` / `node test-pf-cases.mjs` / `node test-excel-extractor.mjs` 전부 통과
- [ ] TypeScript 오류 없음 *(이 프로젝트는 TypeScript 미적용 — 순수 JSX. 해당 없음)*
- [ ] `npm run lint` 오류/경고 없음 *(2026-07-21 ESLint 9 + flat config 설정 완료)*
- [ ] 콘솔 오류 없음
- [ ] 기존 기능 정상 동작
- [ ] Git commit 완료
- [ ] Git push 완료

## 알려진 제약 (2026-07-21 기준)

- `src/lib/lawdCodes.js`의 전남광주통합특별시 관련 코드는 미검증 — code.go.kr 재확인 필요
- 실거래가/브이월드 API 키(`VITE_` 접두사)는 프로덕션 빌드 시 클라이언트에 노출됨 —
  실제 배포 전 서버 프록시로 이전 필요
- `xlsx` 패키지의 npm audit 취약점은 읽기(파싱) 경로 전용이라 이 프로젝트(쓰기만 사용)에는
  해당 없음
