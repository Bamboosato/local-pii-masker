import { describe, expect, it } from "vitest";
import { mapNormalizedRange } from "../../normalization/detection/mapNormalizedRange";
import { normalizeForDetection } from "../../normalization/detection/normalizeForDetection";
import { detectPhoneNumbersWithNormalization } from "./detectPhoneNumbersWithNormalization";

describe("detectPhoneNumbersWithNormalization", () => {
  it.each([
    "090-1234-\n5678",
    "052-\n123-4567",
    "080-9876-\n5432",
    "03-5123-\n8800",
  ])("電話番号の途中改行を検出する: %s", (phone) => {
    const sourceText = `連絡先：${phone}`;
    const candidate = detectPhoneNumbersWithNormalization(sourceText)[0];

    expect(candidate).toMatchObject({
      originalText: phone,
      restorationText: phone.replace(/\r?\n/gu, ""),
      category: "PHONE",
      source: "regex",
      normalizationRules: ["phone_line_break"],
    });
    expect(sourceText.slice(candidate.start, candidate.end)).toBe(phone);
  });

  it("全角数字・ハイフンと途中改行を組み合わせて検出する", () => {
    const phone = "０９０－１２３４－\n５６７８";
    const sourceText = `連絡先：${phone}`;
    const candidate = detectPhoneNumbersWithNormalization(sourceText)[0];

    expect(candidate).toMatchObject({
      originalText: phone,
      restorationText: "090-1234-5678",
      category: "PHONE",
      normalizationRules: expect.arrayContaining([
        "fullwidth_ascii",
        "phone_line_break",
      ]),
    });
  });

  it("通常文の改行は電話番号として結合しない", () => {
    const sourceText = "次の行に連絡先を記載します。\n確認してください。";

    expect(detectPhoneNumbersWithNormalization(sourceText)).toEqual([]);
  });

  it("正規化範囲を改行込みの原文範囲へ戻せる", () => {
    const phone = "090-1234-\n5678";
    const sourceText = `連絡先：${phone}です。`;
    const normalized = normalizeForDetection(sourceText, ["phone_line_break"]);
    const start = normalized.text.indexOf("090-1234-5678");
    const originalRange = mapNormalizedRange(normalized, {
      start,
      end: start + "090-1234-5678".length,
    });

    expect(normalized.text).toContain("090-1234-5678");
    expect(sourceText.slice(originalRange?.start, originalRange?.end)).toBe(
      phone,
    );
  });
});
