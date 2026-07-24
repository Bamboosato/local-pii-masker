import { describe, expect, it } from "vitest";
import type { MaskEntry } from "../types";
import {
  countMaskableOccurrences,
  decideMaskOccurrence,
} from "./contextualMasking";
import { buildHighlightSegments } from "./highlightText";
import { maskText } from "./maskText";
import { SINGLE_SURNAME_COMMON_WORD_RULES } from "../reference/singleSurnameCommonWordRules";

function entry(
  originalText: string,
  options: { sources?: MaskEntry["sources"]; category?: MaskEntry["category"] } = {},
): Pick<MaskEntry, "category" | "originalText" | "sources"> {
  return {
    category: options.category ?? "PERSON",
    originalText,
    sources: options.sources ?? ["regex"],
  };
}

describe("contextualMasking", () => {
  describe("機能観点", () => {
    it("一般語パターン辞書を姓辞書とは別に保持する", () => {
      expect(SINGLE_SURNAME_COMMON_WORD_RULES).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ surname: "森", pattern: "森林", type: "prefix" }),
          expect.objectContaining({ surname: "原", pattern: "原材料", type: "prefix" }),
        ]),
      );

      const keys = SINGLE_SURNAME_COMMON_WORD_RULES.map(
        (rule) => `${rule.surname}:${rule.pattern}:${rule.type}`,
      );
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("辞書に登録された各一般語パターンを一文字姓の除外へ反映する", () => {
      for (const rule of SINGLE_SURNAME_COMMON_WORD_RULES) {
        const targetEntry = {
          ...entry(rule.surname),
          id: rule.surname,
          normalizedText: rule.surname,
          token: `[${rule.surname}]`,
          enabled: true,
          reviewStatus: "approved" as const,
        };

        expect(maskText(rule.pattern, [targetEntry], "contextual_ambiguous_surnames")).toBe(rule.pattern);
      }
    });

    it("明らかな一般語中の一文字姓だけを除外する", () => {
      expect(
        maskText(
          "森林を保護する。原材料を確認する。",
          [
            { ...entry("森"), id: "mori", normalizedText: "森", token: "[森]", enabled: true, reviewStatus: "approved" },
            { ...entry("原"), id: "hara", normalizedText: "原", token: "[原]", enabled: true, reviewStatus: "approved" },
          ],
          "contextual_ambiguous_surnames",
        ),
      ).toBe("森林を保護する。原材料を確認する。");
    });

    it("テストデータに含まれる一般用語中の一文字姓を除外する", () => {
      const text = [
        "森林を保護する活動に参加しました。",
        "森の中を自然散策しました。深い森には多くの動物が生息しています。",
        "原材料の価格が上昇しています。原文の内容を維持してください。原則として変更できません。",
        "関係部署へ連絡してください。外部システムと関係があります。関数の戻り値を確認してください。",
        "森林保護に関する資料を作成しました。城の堀について説明します。道の辻に標識があります。",
        "建物の東側に入口があります。南側の窓を開けてください。日本の南には太平洋があります。南北方向に道路があります。",
        "岡の上に神社があります。堀を埋める工事です。先に辻があります。林業の従事者です。林の中で鳥を見ました。",
      ].join("\\n");
      const entries = ["森", "原", "関", "東", "南", "岡", "堀", "辻", "林"].map(
        (surname) => ({
          ...entry(surname),
          id: surname,
          normalizedText: surname,
          token: `[${surname}]`,
          enabled: true,
          reviewStatus: "approved" as const,
        }),
      );

      expect(maskText(text, entries, "contextual_ambiguous_surnames")).toBe(text);
    });

    it("同じ一文字姓が人名と一般語で混在する場合は人名だけをマスクする", () => {
      expect(
        maskText(
          "森さんが参加した。森林を保護する。担当者：原。原材料を確認する。",
          [
            { ...entry("森"), id: "mori", normalizedText: "森", token: "[森]", enabled: true, reviewStatus: "approved" },
            { ...entry("原"), id: "hara", normalizedText: "原", token: "[原]", enabled: true, reviewStatus: "approved" },
          ],
          "contextual_ambiguous_surnames",
        ),
      ).toBe("[森]さんが参加した。森林を保護する。担当者：[原]。原材料を確認する。");
    });

    it("NER由来の人名候補は一般語パターンより優先する", () => {
      expect(
        maskText(
          "森林",
          [{
            ...entry("森", { sources: ["ner"] }),
            id: "mori",
            normalizedText: "森",
            token: "[森]",
            enabled: true,
            reviewStatus: "approved",
          }],
          "contextual_ambiguous_surnames",
        ),
      ).toBe("[森]林");
    });

    it("原文ハイライトも文脈付きマスク結果と同じ出現箇所だけを示す", () => {
      const segments = buildHighlightSegments(
        "森さん。森林。",
        [
          {
            ...entry("森"),
            id: "mori",
            normalizedText: "森",
            enabled: true,
            reviewStatus: "approved",
          },
        ],
        "contextual_ambiguous_surnames",
      );

      expect(segments.filter((segment) => segment.type === "highlight")).toHaveLength(1);
      expect(segments.find((segment) => segment.type === "highlight")?.value).toBe("森");
    });

    it("人名ラベル、敬称、リスト、改行姓名では一般語辞書より人名判定を優先する", () => {
      const cases = [
        { text: "氏名：森", surname: "森", start: 3 },
        { text: "森さん", surname: "森", start: 0 },
        { text: "1. 原", surname: "原", start: 3 },
        { text: "関\n太郎", surname: "関", start: 0 },
      ];

      for (const { text, surname, start } of cases) {
        expect(
          decideMaskOccurrence({
            text,
            entry: entry(surname),
            start,
            end: start + surname.length,
            mode: "contextual_ambiguous_surnames",
          }).decision,
        ).toBe("mask");
      }
    });
  });

  describe("状態・境界観点", () => {
    it("文脈付きモードでマスク対象となる出現数を数える", () => {
      expect(
        countMaskableOccurrences(
          "森さん。森林。森。",
          entry("森"),
          "contextual_ambiguous_surnames",
        ),
      ).toBe(2);
    });

    it("一括モードでは従来どおり同一文字列を全件マスクする", () => {
      expect(
        maskText(
          "森さん。森林。",
          [{ ...entry("森", { sources: ["regex"] }), id: "mori", normalizedText: "森", token: "[森]", enabled: true, reviewStatus: "approved" }],
          "global",
        ),
      ).toBe("[森]さん。[森]林。");
    });

    it("手動追加候補は文脈付きモードでも明示操作を優先して一括マスクする", () => {
      expect(
        maskText(
          "森さん。森林。",
          [{ ...entry("森", { sources: ["manual"] }), id: "mori", normalizedText: "森", token: "[森]", enabled: true, reviewStatus: "approved" }],
          "contextual_ambiguous_surnames",
        ),
      ).toBe("[森]さん。[森]林。");
    });
  });
});
