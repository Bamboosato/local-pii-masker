import { describe, expect, it } from "vitest";
import { runRegexDetection } from "./runRegexDetection";

describe("runRegexDetection", () => {
  it("メール、電話番号、郵便番号を形式検出候補として返す", () => {
    const candidates = runRegexDetection(
      "連絡先は yamada@example.com、090-1234-5678、〒123-4567 です。",
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "yamada@example.com",
        category: "EMAIL",
        source: "regex",
      }),
      expect.objectContaining({
        originalText: "090-1234-5678",
        category: "PHONE",
        source: "regex",
      }),
      expect.objectContaining({
        originalText: "〒123-4567",
        category: "POSTAL_CODE",
        source: "regex",
      }),
    ]);
  });

  it("メール末尾の句読点や括弧を候補に含めない", () => {
    const candidates = runRegexDetection(
      "宛先は（support@example.co.jp）。確認してください。",
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      originalText: "support@example.co.jp",
      start: 4,
      end: 25,
    });
  });

  it("全角数字と全角ハイフンの電話番号・郵便番号を表記維持で検出する", () => {
    const candidates = runRegexDetection(
      "電話：０９０－１２３４－５６７８ 郵便：１２３－４５６７",
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "０９０－１２３４－５６７８",
        category: "PHONE",
      }),
      expect.objectContaining({
        originalText: "１２３－４５６７",
        category: "POSTAL_CODE",
      }),
    ]);
  });

  it("日付や桁数が不足する電話番号を候補にしない", () => {
    const candidates = runRegexDetection(
      "日付は2026-07-10、短い番号は03-12-345です。",
    );

    expect(candidates).toEqual([]);
  });

  it("一般的なメール形式から外れるドメインは候補にしない", () => {
    const candidates = runRegexDetection(
      "候補外は user@example.c と user@example.123 です。",
    );

    expect(candidates).toEqual([]);
  });
});
