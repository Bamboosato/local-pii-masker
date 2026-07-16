import { describe, expect, it } from "vitest";
import { normalizeForDetection } from "./normalizeForDetection";

describe("organization_line_break normalization", () => {
  it("会社種別接頭辞から最大3行の組織名を結合する", () => {
    const sourceText = "株式会社\n青葉デジタル\nソリューションズ";
    const result = normalizeForDetection(sourceText, [
      "organization_line_break",
    ]);

    expect(result.text).toBe("株式会社青葉デジタルソリューションズ");
    expect(result.appliedRules).toEqual([
      expect.objectContaining({
        rule: "organization_line_break",
        originalStart: 0,
        originalEnd: sourceText.length,
      }),
    ]);
  });

  it("会社種別接頭辞のない一般文は結合しない", () => {
    const sourceText = "青葉デジタル\nソリューションズ";

    expect(
      normalizeForDetection(sourceText, ["organization_line_break"]),
    ).toMatchObject({
      text: sourceText,
      appliedRules: [],
    });
  });

  it.each([
    [
      "株式会社青葉デジタルソリューショ\nンズ",
      "株式会社青葉デジタルソリューションズ",
    ],
    ["合同会社みらいテクノロ\nジー", "合同会社みらいテクノロジー"],
    ["北星メディカル株式\n会社", "北星メディカル株式会社"],
    ["東海システム開発セン\nター", "東海システム開発センター"],
  ])("組織名の途中改行を結合する: %s", (sourceText, expectedText) => {
    const result = normalizeForDetection(sourceText, [
      "organization_line_break",
    ]);

    expect(result.text).toBe(expectedText);
    expect(result.appliedRules).toEqual([
      expect.objectContaining({ rule: "organization_line_break" }),
    ]);
  });

  it("組織名の後ろにある一般的な文脈語を候補範囲へ含めない", () => {
    const sourceText = "合同会社みらいテクノロ\nジーです。";
    const result = normalizeForDetection(sourceText, [
      "organization_line_break",
    ]);

    expect(result.text).toBe("合同会社みらいテクノロジーです。");
    expect(result.appliedRules).toEqual([
      expect.objectContaining({
        rule: "organization_line_break",
        originalStart: 0,
        originalEnd: "合同会社みらいテクノロ\nジー".length,
      }),
    ]);
  });

  it.each([
    "株式会社青葉デジタルソリューションズ\n機密資料",
    "株式会社青葉デジタルソリューションズ\n株式会社青葉デジタルソリューションズ",
  ])("組織名の後ろにある別行を結合しない: %s", (sourceText) => {
    expect(
      normalizeForDetection(sourceText, ["organization_line_break"]),
    ).toMatchObject({
      text: sourceText,
      appliedRules: [],
    });
  });

  it("Markdown見出しとコードブロック内は結合しない", () => {
    const sourceText = [
      "# 株式会社",
      "青葉デジタル",
      "ソリューションズ",
      "```text",
      "株式会社",
      "青葉デジタル",
      "ソリューションズ",
      "```",
    ].join("\n");

    expect(
      normalizeForDetection(sourceText, ["organization_line_break"]),
    ).toMatchObject({
      text: sourceText,
      appliedRules: [],
    });
  });
});
