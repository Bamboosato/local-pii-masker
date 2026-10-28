import { describe, expect, it } from "vitest";
import { sourceQuoteChoices } from "./sourceQuotes";

describe("原文の引用候補", () => {
  it("短い文・行の比較案も連続引用だけを使い、全体とサロゲート境界を保つ", () => {
    const text = '😀碧波研究所。\n水羽夏帆さん！引用"と\\。'.repeat(100);
    const quotes = sourceQuoteChoices(text, "sentences");
    expect(quotes).toContain("水羽夏帆さん！");
    expect(quotes).toContain(text);
    expect(quotes.length).toBeLessThanOrEqual(64);
    for (const quote of quotes) {
      expect(text.includes(quote)).toBe(true);
      expect(quote).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
  });
  it("短文だけの比較案は固定幅引用を追加せず、長い対象用の全体は残す", () => {
    const text = "😀第一文。\n第二行。第三文。";
    const quotes = sourceQuoteChoices(text, "sentences-only");
    expect(new Set(quotes)).toEqual(new Set([text, "😀第一文。\n", "第二行。", "第三文。"]));
    const long = "長".repeat(300) + "。次文。";
    expect(sourceQuoteChoices(long, "sentences-only")).toContain(long);
    expect(sourceQuoteChoices(long, "sentences-only")).toContain("長".repeat(300) + "。");
  });
  it("JSON特殊文字・絵文字も原文の連続引用だけを返し、全体を必ず残す", () => {
    const text = '引用"と\\と\n😀を含む本文。'.repeat(100);
    const quotes = sourceQuoteChoices(text);
    expect(quotes).toContain(text);
    expect(quotes.length).toBeLessThanOrEqual(64);
    for (const quote of quotes) {
      expect(text.includes(quote)).toBe(true);
      expect(quote).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
  });
  it("窓の境界にある短い対象も全文以外の窓へ完全に残す", () => {
    const target = "砂凪あかり千葉県架空市浜風町1丁目2番3号";
    for (const offset of [47, 48, 111, 112, 159, 160]) {
      const text = "x".repeat(offset) + target + "y".repeat(300);
      expect(sourceQuoteChoices(text).filter((q) => q !== text).some((q) => q.includes(target))).toBe(true);
    }
  });
});
