import { describe, expect, it, vi } from "vitest";
import { maskText } from "../../mask/maskText";
import { mergeCandidates } from "../mergeCandidates";
import { runNormalizedNerDetection } from "./runNormalizedNerDetection";

describe("runNormalizedNerDetection", () => {
  it("姓名間改行を除去してNERを実行し、候補を改行込みの原文範囲へ戻す", async () => {
    const sourceText = "氏名：山田\n太郎さん";
    const classifier = vi.fn(async (text: string) => {
      expect(text).toBe("氏名：山田太郎さん");

      return [
        {
          entity_group: "PER",
          word: "山田太郎",
          start: 3,
          end: 7,
          score: 0.92,
        },
      ];
    });

    const candidates = await runNormalizedNerDetection(sourceText, classifier);

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "山田\n太郎",
        restorationText: "山田太郎",
        category: "PERSON",
        source: "ner",
        start: 3,
        end: 8,
        confidence: 0.92,
        normalizationRules: ["person_name_line_break"],
      }),
    ]);

    const entries = mergeCandidates({
      originalText: sourceText,
      entries: [],
      candidates,
      createId: () => "line-broken-name",
    });

    expect(entries[0]).toMatchObject({
      originalText: "山田\n太郎",
      restorationText: "山田太郎",
      occurrenceCount: 1,
      enabled: true,
    });
    expect(maskText(sourceText, entries)).toBe("氏名：[人名_1]さん");
  });

  it("同じ正規化候補の別出現位置も改行込みの原文候補へ展開する", async () => {
    const sourceText = "山田太郎です。担当者は山田太\n郎です。";
    const classifier = vi.fn(async (text: string) => {
      expect(text).toBe("山田太郎です。担当者は山田太郎です。");

      return [
        {
          entity_group: "PER",
          word: "山田太郎",
          start: 0,
          end: 4,
          score: 0.92,
        },
      ];
    });

    const candidates = await runNormalizedNerDetection(sourceText, classifier);

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "山田太郎",
        start: 0,
        end: 4,
      }),
      expect.objectContaining({
        originalText: "山田太\n郎",
        start: 11,
        end: 16,
        normalizationRules: ["person_name_line_break"],
      }),
    ]);

    const entries = mergeCandidates({
      originalText: sourceText,
      entries: [],
      candidates,
      createId: () => "expanded-name",
    });

    expect(maskText(sourceText, entries)).toBe(
      "[人名_1]です。担当者は[人名_2]です。",
    );
  });

  it("組織名の通常表記と途中改行表記を別の原文候補へ展開する", async () => {
    const organization = "株式会社青葉デジタルソリューションズ";
    const brokenOrganization = "株式会社青葉デジタルソリューショ\nンズ";
    const sourceText = `${organization}。${brokenOrganization}`;
    const classifier = vi.fn(async (text: string) => {
      expect(text).toBe(`${organization}。${organization}`);

      return [
        {
          entity_group: "ORG",
          word: organization,
          start: 0,
          end: organization.length,
          score: 0.9,
        },
      ];
    });

    const candidates = await runNormalizedNerDetection(sourceText, classifier);

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: organization,
        start: 0,
        end: organization.length,
      }),
      expect.objectContaining({
        originalText: brokenOrganization,
        restorationText: organization,
        start: organization.length + 1,
        end: sourceText.length,
        normalizationRules: ["organization_line_break"],
      }),
    ]);

    const entries = mergeCandidates({
      originalText: sourceText,
      entries: [],
      candidates,
      createId: () => "expanded-organization",
    });

    expect(maskText(sourceText, entries)).toBe("[組織_1]。[組織_2]");
  });

  it("会社種別接頭辞から組織名の改行を除去し、全体を原文範囲へ戻す", async () => {
    const sourceText = "株式会社\n青葉デジタル\nソリューションズ";
    const normalizedOrganization = "株式会社青葉デジタルソリューションズ";
    const classifier = vi.fn(async (text: string) => {
      expect(text).toBe(normalizedOrganization);

      return [
        {
          entity_group: "ORG",
          word: normalizedOrganization,
          start: 0,
          end: normalizedOrganization.length,
          score: 0.9,
        },
      ];
    });

    await expect(
      runNormalizedNerDetection(sourceText, classifier),
    ).resolves.toEqual([
      expect.objectContaining({
        originalText: sourceText,
        restorationText: normalizedOrganization,
        category: "ORGANIZATION",
        source: "ner",
        start: 0,
        end: sourceText.length,
        normalizationRules: ["organization_line_break"],
      }),
    ]);
  });

  it("正規化されていないNER候補も原文位置のまま維持する", async () => {
    const classifier = vi.fn(async () => [
      {
        entity_group: "PER",
        word: "山田太郎",
        start: 0,
        end: 4,
        score: 0.9,
      },
    ]);

    await expect(
      runNormalizedNerDetection("山田太郎さん", classifier),
    ).resolves.toEqual([
      expect.objectContaining({
        originalText: "山田太郎",
        start: 0,
        end: 4,
      }),
    ]);
  });

  it("混在する文字間空白を除去してNERを実行し、空白込みの原文範囲をマスクする", async () => {
    const sourceText = "氏名：山 田　太郎さん";
    const classifier = vi.fn(async (text: string) => {
      expect(text).toBe("氏名：山田太郎さん");

      return [
        {
          entity_group: "PER",
          word: "山田太郎",
          start: 3,
          end: 7,
          score: 0.91,
        },
      ];
    });
    const candidates = await runNormalizedNerDetection(sourceText, classifier);

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "山 田　太郎",
        restorationText: "山田太郎",
        start: 3,
        end: 9,
        normalizationRules: ["japanese_inter_character_space"],
      }),
    ]);

    const entries = mergeCandidates({
      originalText: sourceText,
      entries: [],
      candidates,
      createId: () => "spaced-name",
    });

    expect(maskText(sourceText, entries)).toBe("氏名：[人名_1]さん");
  });

  it("同じ正規化姓名になる複数の原文表記を位置ごとに復元する", async () => {
    const sourceText = "山 田 太 郎\n山 田　太郎";
    const classifier = vi.fn(async (text: string) => {
      expect(text).toBe("山田太郎\n山田太郎");

      return [
        {
          entity_group: "PER",
          word: "山田太郎",
          start: 0,
          end: 4,
          score: 0.92,
        },
        {
          entity_group: "PER",
          word: "山田太郎",
          start: 5,
          end: 9,
          score: 0.9,
        },
      ];
    });

    await expect(
      runNormalizedNerDetection(sourceText, classifier),
    ).resolves.toEqual([
      expect.objectContaining({
        originalText: "山 田 太 郎",
        start: 0,
        end: 7,
      }),
      expect.objectContaining({
        originalText: "山 田　太郎",
        start: 8,
        end: 14,
      }),
    ]);
  });
});
