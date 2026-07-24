import { describe, expect, it } from "vitest";
import type { DetectionCandidate } from "./mergeCandidates";
import { extendHonorificCandidates } from "./extendHonorificCandidates";

function candidate(
  originalText: string,
  category: DetectionCandidate["category"],
  start?: number,
): DetectionCandidate {
  return {
    originalText,
    category,
    source: "ner",
    ...(start === undefined ? {} : { start, end: start + originalText.length }),
  };
}

describe("extendHonorificCandidates", () => {
  it.each([
    ["山田太郎さんに連絡する。", "山田太郎", "山田太郎さん"],
    ["山田 太郎 様へ送付する。", "山田 太郎", "山田 太郎 様"],
    ["山田太郎先生に確認する。", "山田太郎", "山田太郎先生"],
  ])("人名の直後の敬称を候補へ含める: %s", (sourceText, name, expected) => {
    const result = extendHonorificCandidates(sourceText, [
      candidate(name, "PERSON", sourceText.indexOf(name)),
    ]);

    expect(result[0]).toMatchObject({
      originalText: expected,
      end: sourceText.indexOf(expected) + expected.length,
    });
  });

  it("組織名の直後の敬称・役職を含め、長い役職名を優先する", () => {
    const sourceText = "株式会社青葉御中へ。株式会社青葉最高経営責任者の判断。";
    const organization = "株式会社青葉";
    const result = extendHonorificCandidates(sourceText, [
      candidate(organization, "ORGANIZATION", sourceText.indexOf(organization)),
      candidate(
        organization,
        "ORGANIZATION",
        sourceText.lastIndexOf(organization),
      ),
    ]);

    expect(result.map((item) => item.originalText)).toEqual([
      "株式会社青葉御中",
      "株式会社青葉最高経営責任者",
    ]);
  });

  it("敬称だけ、境界のない文字列、住所候補は拡張しない", () => {
    const sourceText = "さん 山田太郎さん太郎 愛知県豊田市若宮町二丁目15番地様";
    const result = extendHonorificCandidates(sourceText, [
      candidate("山田太郎", "PERSON", sourceText.indexOf("山田太郎")),
      candidate(
        "愛知県豊田市若宮町二丁目15番地",
        "ADDRESS",
        sourceText.indexOf("愛知県"),
      ),
    ]);

    expect(result.map((item) => item.originalText)).toEqual([
      "山田太郎",
      "愛知県豊田市若宮町二丁目15番地",
    ]);
  });

  it("位置情報がない候補は同一文字列が一度だけなら補完する", () => {
    const sourceText = "山田太郎さんに連絡する。";
    const result = extendHonorificCandidates(sourceText, [
      candidate("山田太郎", "PERSON"),
    ]);

    expect(result[0]).toMatchObject({
      originalText: "山田太郎さん",
      start: 0,
      end: "山田太郎さん".length,
    });
  });

  it("位置情報がない候補で同一文字列が複数回ある場合は誤った出現箇所を選ばない", () => {
    const sourceText = "山田太郎です。山田太郎さんです。";
    const result = extendHonorificCandidates(sourceText, [
      candidate("山田太郎", "PERSON"),
    ]);

    expect(result[0].originalText).toBe("山田太郎");
  });
});
