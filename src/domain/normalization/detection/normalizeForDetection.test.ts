import { describe, expect, it } from "vitest";
import { mapNormalizedRange } from "./mapNormalizedRange";
import { normalizeForDetection } from "./normalizeForDetection";

describe("normalizeForDetection", () => {
  it("メールアドレスの@前後にある半角空白だけを除去する", () => {
    const sourceText = [
      "taro.yamada @example.co.jp",
      "taro.yamada@ example.co.jp",
      "taro.yamada @ example.co.jp",
    ].join("\n");

    const result = normalizeForDetection(sourceText);

    expect(result.text).toBe(
      [
        "taro.yamada@example.co.jp",
        "taro.yamada@example.co.jp",
        "taro.yamada@example.co.jp",
      ].join("\n"),
    );
    expect(result.appliedRules).toHaveLength(3);
    expect(
      result.appliedRules.every((event) => event.rule === "email_at_spacing"),
    ).toBe(true);
  });

  it("全角空白とコードブロック内のメールにも適用してMarkdown構造を維持する", () => {
    const sourceText = [
      "```text",
      "連絡先: taro.yamada　@　example.co.jp",
      "```",
    ].join("\n");

    const result = normalizeForDetection(sourceText);

    expect(result.text).toBe(
      ["```text", "連絡先: taro.yamada@example.co.jp", "```"].join("\n"),
    );
    expect(sourceText).toContain("taro.yamada　@　example.co.jp");
  });

  it("メール形式ではない通常文と空白のないメールは変更しない", () => {
    const sourceText =
      "担当者 A @ B と相談し、通常連絡先はtaro.yamada@example.co.jpです。";

    const result = normalizeForDetection(sourceText);

    expect(result.text).toBe(sourceText);
    expect(result.appliedRules).toEqual([]);
  });

  it("正規化メールの範囲を空白込みの原文範囲へ戻す", () => {
    const originalEmail = "taro.yamada @ example.co.jp";
    const sourceText = `🙂連絡先: ${originalEmail}です。`;
    const result = normalizeForDetection(sourceText);
    const normalizedEmail = "taro.yamada@example.co.jp";
    const normalizedStart = result.text.indexOf(normalizedEmail);

    const originalRange = mapNormalizedRange(result, {
      start: normalizedStart,
      end: normalizedStart + normalizedEmail.length,
    });

    expect(originalRange).toBeDefined();
    expect(sourceText.slice(originalRange?.start, originalRange?.end)).toBe(
      originalEmail,
    );
    expect(result.appliedRules[0]).toMatchObject({
      normalizedStart,
      normalizedEnd: normalizedStart + normalizedEmail.length,
      originalStart: sourceText.indexOf(originalEmail),
      originalEnd: sourceText.indexOf(originalEmail) + originalEmail.length,
    });
  });

  it("空範囲または正規化テキスト外の範囲は原文へ変換しない", () => {
    const result = normalizeForDetection("taro @example.co.jp");

    expect(mapNormalizedRange(result, { start: 0, end: 0 })).toBeUndefined();
    expect(
      mapNormalizedRange(result, { start: 0, end: result.text.length + 1 }),
    ).toBeUndefined();
  });
});
