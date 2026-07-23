// 사업수지 엑셀 업로드 → 필드 자동 추출(src/lib/excelExtractor.js) 회귀 테스트.
// 실행: node test-excel-extractor.mjs
import * as XLSX from "xlsx";
import { extractFromWorkbook, toFormPatch, FIELD_LABELS } from "./src/lib/excelExtractor.js";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// ---- 케이스 1: 흔한 사업수지표 레이아웃(라벨 | 값 두 칸짜리 표) ----
function buildSampleSheet1() {
  const rows = [
    ["항목", "값", "비고"],
    ["사업부지 주소", "서울특별시 성동구 성수동1가 685"],
    ["대지면적", 1200, "㎡"],
    ["용도지역", "제3종일반주거지역"],
    ["사업유형", "재건축"],
    ["총사업비", "1,234,500", "만원"],
    ["토지매입비", 300000],
    ["평당 공사비", 950],
    ["대출금리", "9.5%"],
    ["취급수수료", 1.2],
    ["대출기간(개월)", 27],
    ["자기자본비율", 25],
    ["예상분양률", 82],
    ["설계비", 5000],
    ["감리비", 3000],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "사업수지표");
  return wb;
}

function wbToArrayBuffer(wb) {
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out;
}

const wb1 = buildSampleSheet1();
const buf1 = wbToArrayBuffer(wb1);
const result1 = extractFromWorkbook(buf1);

const byField = Object.fromEntries(result1.extracted.map((e) => [e.field, e]));

assert(byField.address?.value === "서울특별시 성동구 성수동1가 685", "address 추출 실패: " + JSON.stringify(byField.address));
assert(byField.address.sourceCell === "사업수지표!B2", "address sourceCell 추적 실패: " + byField.address.sourceCell);
assert(byField.area?.value === 1200, "area 추출 실패: " + JSON.stringify(byField.area));
assert(byField.zone?.value === "제3종일반주거지역", "zone 추출 실패");
assert(byField.projectType?.value === "재건축", "projectType 추출 실패");
assert(byField.totalCostOverride?.value === 1234500, "총사업비 콤마 파싱 실패: " + JSON.stringify(byField.totalCostOverride));
assert(byField.landCostOverride?.value === 300000, "토지매입비 추출 실패");
assert(byField.constructionCostPerPyInput?.value === 950, "평당 공사비 추출 실패");
assert(byField.interestRate?.value === 9.5, "대출금리 % 파싱 실패: " + JSON.stringify(byField.interestRate));
assert(byField.originationFee?.value === 1.2, "취급수수료 추출 실패");
assert(byField.loanTermMonths?.value === 27, "대출기간 추출 실패");
assert(byField.equityRatio?.value === 25, "자기자본비율 추출 실패");
assert(byField.expectedSaleRate?.value === 82, "예상분양률 추출 실패");
assert(byField.designFee?.value === 5000, "설계비 추출 실패");
assert(byField.supervisionFee?.value === 3000, "감리비 추출 실패");

// 못 찾은 항목은 missingFields에 남아야 함(조용히 기본값으로 채우면 안 됨)
assert(result1.missingFields.includes("demolitionCost"), "미추출 항목이 missingFields에 안 남음(철거비 없는 케이스인데)");
assert(result1.warnings.length > 0, "일부 미추출 시 warnings가 비어있으면 안 됨");

// ---- 케이스 2: 완전히 빈 시트 → 전부 미추출, 크래시 없이 처리 ----
const emptyWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(emptyWb, XLSX.utils.aoa_to_sheet([["", ""]]), "빈시트");
const result2 = extractFromWorkbook(wbToArrayBuffer(emptyWb));
assert(result2.extracted.length === 0, "빈 시트인데 뭔가 추출됨: " + JSON.stringify(result2.extracted));
assert(result2.missingFields.length === Object.keys(FIELD_LABELS).length, "빈 시트면 전체 필드가 missingFields여야 함");

// ---- 케이스 3: 엑셀 형식이 아닌 임의 바이트 → 크래시 없이 "추출 실패"로만 처리(값 조작 없이) ----
// (SheetJS는 순수 텍스트도 1셀짜리 시트로 관대하게 파싱하므로 예외를 던지지 않음 — 여기서 중요한 건
//  "예외로 죽지 않는 것"과 "아무 필드도 잘못 채워지지 않는 것")
const garbage = new TextEncoder().encode("이건 엑셀 파일이 아닙니다").buffer;
const result3 = extractFromWorkbook(garbage);
assert(result3.extracted.length === 0, "형식이 아닌 파일인데 값이 추출됨(잘못된 값 채움 위험)");
assert(result3.warnings.length > 0, "형식이 아닌 파일 처리 시 경고 메시지 누락");

// ---- 케이스 4: 진짜로 깨진 바이너리(zip 헤더 자체가 손상) → 예외 잡아서 에러 메시지로 변환 ----
const brokenBinary = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0x00, 0x00]).buffer; // zip 헤더 흉내만 내고 나머지 손상
const result4 = extractFromWorkbook(brokenBinary);
assert(result4.extracted.length === 0, "손상 바이너리인데 값이 추출됨");
assert(result4.warnings.length > 0, "손상 바이너리 처리 시 경고 메시지 누락: " + JSON.stringify(result4.warnings));

// ---- toFormPatch: form state에 바로 merge 가능한 문자열 맵으로 변환되는지 ----
const patch = toFormPatch(result1.extracted);
assert(patch.area === "1200", "toFormPatch 숫자→문자열 변환 실패: " + patch.area);
assert(patch.address === "서울특별시 성동구 성수동1가 685", "toFormPatch address 실패");
assert(Object.keys(patch).length === result1.extracted.length, "toFormPatch 필드 개수 불일치");

console.log("추출된 필드 수:", result1.extracted.length, "/ 미추출:", result1.missingFields.length);
console.log("ALL CHECKS PASSED");
