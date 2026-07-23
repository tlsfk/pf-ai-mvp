import * as XLSX from "xlsx";

/**
 * 사업수지 엑셀(XLSX) 업로드 → PF 심사 입력폼 필드 자동 추출.
 *
 * ⚠️ 설계 원칙(CONTEXT.md "North Star" 참고):
 * - 이 모듈은 심사역이 "새 양식을 다시 입력"하지 않고 기존에 쓰던 사업수지 엑셀을
 *   그대로 올리기만 하면 되도록 하기 위한 것입니다.
 * - AI가 값을 "확정"하지 않습니다 — 반드시 어느 셀(sheet!A1)에서 가져온 값인지
 *   추적 가능한 근거(sourceCell)를 함께 반환하고, 최종 반영 여부는 사람이 결정합니다.
 * - 라벨 매칭에 실패한 필드는 조용히 기본값으로 채우지 않고 "추출 실패"로 명시합니다
 *   (심사 근거를 흐리게 만드는 추측성 채움 방지).
 *
 * 엑셀 양식은 회사·담당자마다 제각각이므로, 정확한 셀 위치가 아니라
 * "라벨 텍스트가 포함된 셀 → 그 옆(오른쪽) 또는 아래 셀을 값으로 추정"하는
 * 휴리스틱 스캔 방식을 사용합니다. 표 형태가 완전히 다르면 추출이 안 될 수 있고,
 * 이 경우 result.warnings에 사유가 남습니다.
 */

// 필드별 라벨 후보(우선순위 순 — 앞에 있을수록 더 확실한 표현). 여러 개가 매칭되면 첫 매칭만 채택.
const FIELD_LABELS = {
  address: ["사업부지 주소", "사업부지주소", "대지위치", "소재지", "주소"],
  area: ["대지면적", "부지면적", "토지면적"],
  zone: ["용도지역"],
  projectType: ["사업유형", "사업구분", "사업방식"],
  totalCostOverride: ["총사업비", "사업비 합계", "총 사업비", "사업비합계"],
  landCostOverride: ["토지매입비", "토지비", "용지비"],
  constructionCostPerPyInput: ["평당 공사비", "공사비(평당)", "평당공사비", "3.3㎡당 공사비"],
  interestRate: ["대출금리", "차입금리", "이자율", "PF금리"],
  originationFee: ["취급수수료", "취급수수료율", "약정수수료"],
  loanTermMonths: ["대출기간(개월)", "대출기간", "차입기간"],
  equityRatio: ["자기자본비율", "자기자본율", "Equity비율"],
  expectedSaleRate: ["예상분양률", "분양률", "목표분양률"],
  demolitionCost: ["철거비"],
  designFee: ["설계비"],
  supervisionFee: ["감리비"],
  salesCost: ["분양마케팅비", "분양경비", "마케팅비"],
  leviesCost: ["부담금", "각종부담금", "제세공과금"],
  contingency: ["예비비"],
  miscCost: ["기타비용", "기타"],
};

// 숫자로 변환해야 하는 필드(나머지는 문자열 그대로 사용 — 주소, 용도지역, 사업유형)
const NUMERIC_FIELDS = new Set([
  "area", "totalCostOverride", "landCostOverride", "constructionCostPerPyInput",
  "interestRate", "originationFee", "loanTermMonths", "equityRatio", "expectedSaleRate",
  "demolitionCost", "designFee", "supervisionFee", "salesCost", "leviesCost", "contingency", "miscCost",
]);

/** "1,234만원" / "12.5%" / " 27개월 " 같은 표기에서 숫자만 추려냄. 파싱 불가 시 null. */
function parseNumericCell(raw) {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return cleaned ? Number(cleaned[0]) : null;
}

function colToLetter(colIdx) {
  let letter = "";
  let n = colIdx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/**
 * 워크북 전체를 스캔해 필드별 후보값 1개씩을 찾는다.
 * @param {ArrayBuffer} arrayBuffer - 업로드된 .xlsx 파일의 raw 바이트.
 * @returns {{ extracted: Array<{field:string,label:string,value:*,rawValue:*,sourceCell:string,sheet:string}>, missingFields: string[], warnings: string[] }}
 */
export function extractFromWorkbook(arrayBuffer) {
  const warnings = [];
  let workbook;
  try {
    workbook = XLSX.read(arrayBuffer, { type: "array" });
  } catch (e) {
    return { extracted: [], missingFields: Object.keys(FIELD_LABELS), warnings: [`엑셀 파일을 읽을 수 없습니다: ${e.message}`] };
  }

  const foundByField = {}; // field -> 추출결과 (첫 매칭만 유지)

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[cellAddr];
        if (!cell || typeof cell.v !== "string") continue;
        const cellText = cell.v.trim();
        if (!cellText) continue;

        for (const [field, labels] of Object.entries(FIELD_LABELS)) {
          if (foundByField[field]) continue; // 이미 앞에서 찾은 필드는 스킵(첫 매칭 우선)
          const matchedLabel = labels.find((label) => cellText.includes(label));
          if (!matchedLabel) continue;

          // 라벨 셀의 오른쪽 → 그 다음 오른쪽 → 바로 아래 순으로 값 후보 탐색
          const candidates = [
            { r, c: c + 1 }, { r, c: c + 2 }, { r: r + 1, c },
          ];
          for (const cand of candidates) {
            const candAddr = XLSX.utils.encode_cell(cand);
            const candCell = sheet[candAddr];
            if (!candCell || candCell.v === undefined || candCell.v === "") continue;
            const rawValue = candCell.v;
            const value = NUMERIC_FIELDS.has(field) ? parseNumericCell(rawValue) : String(rawValue).trim();
            if (value === null || value === "") continue;

            foundByField[field] = {
              field, label: matchedLabel, value, rawValue,
              sourceCell: `${sheetName}!${candAddr}`, sheet: sheetName,
            };
            break;
          }
        }
      }
    }
  }

  const extracted = Object.values(foundByField);
  const missingFields = Object.keys(FIELD_LABELS).filter((f) => !foundByField[f]);
  if (missingFields.length > 0) {
    warnings.push(
      `다음 항목은 엑셀에서 자동 인식하지 못했습니다 — 라벨 표기가 다르거나 표 구조가 예상과 달라서일 수 있습니다. 직접 확인 후 입력해주세요: ${missingFields.join(", ")}`
    );
  }

  return { extracted, missingFields, warnings };
}

/** extractFromWorkbook 결과를 폼 state에 merge할 수 있는 { field: value } 형태로 변환. */
export function toFormPatch(extracted) {
  const patch = {};
  for (const item of extracted) {
    patch[item.field] = String(item.value);
  }
  return patch;
}

export { FIELD_LABELS, colToLetter };
