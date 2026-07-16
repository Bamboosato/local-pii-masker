import { describe, expect, it } from "vitest";
import { detectOrganizationsWithNormalization } from "./detectOrganizationsWithNormalization";

describe("detectOrganizationsWithNormalization", () => {
  it.each([
    "株式会社青葉デジタルソリューショ\nンズ",
    "合同会社みらいテクノロ\nジー",
    "北星メディカル株式\n会社",
    "東海システム開発セン\nター",
  ])("改行された組織名を原文範囲で候補化する: %s", (sourceText) => {
    const candidates = detectOrganizationsWithNormalization(sourceText);

    expect(candidates).toEqual([
      {
        originalText: sourceText,
        category: "ORGANIZATION",
        source: "regex",
        start: 0,
        end: sourceText.length,
        normalizationRules: ["organization_line_break"],
      },
    ]);
  });

  it("改行のない組織名はこの補完検出の対象にしない", () => {
    expect(
      detectOrganizationsWithNormalization("株式会社青葉デジタルソリューションズ"),
    ).toEqual([]);
  });

  it("組織名の後ろにある文脈語を候補へ含めない", () => {
    const sourceText = "所属：合同会社みらいテクノロ\nジーです。";

    expect(detectOrganizationsWithNormalization(sourceText)).toEqual([
      expect.objectContaining({
        originalText: "合同会社みらいテクノロ\nジー",
        category: "ORGANIZATION",
        source: "regex",
        normalizationRules: ["organization_line_break"],
      }),
    ]);
  });

  it("組織名の次行にある部署名を同じ候補へ含めない", () => {
    const sourceText =
      "株式会社青葉デジタルソリューショ\nンズ\n営業企画部";

    expect(detectOrganizationsWithNormalization(sourceText)).toEqual([
      expect.objectContaining({
        originalText: "株式会社青葉デジタルソリューショ\nンズ",
        category: "ORGANIZATION",
        source: "regex",
        start: 0,
        end: "株式会社青葉デジタルソリューショ\nンズ".length,
        normalizationRules: ["organization_line_break"],
      }),
    ]);
  });

  it("一般文、見出し、コードブロックは組織候補にしない", () => {
    const sourceText = [
      "青葉デジタル\nソリューションズ",
      "# 株式会社",
      "青葉デジタル",
      "ソリューションズ",
      "```text",
      "株式会社",
      "青葉デジタル",
      "ソリューションズ",
      "```",
    ].join("\n");

    expect(detectOrganizationsWithNormalization(sourceText)).toEqual([]);
  });
});
