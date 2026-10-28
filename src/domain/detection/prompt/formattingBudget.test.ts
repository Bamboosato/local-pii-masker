import { describe, expect, it } from "vitest";
import { JsonFormattingBudget } from "./formattingBudget";

describe("JSON構文空白のストリーム上限", () => {
  it("境界値以下は許可し、任意の分割位置でも超過を検出する", () => {
    for (const [text, exceeded] of [["{    }", false], ["{ \t\r\n }", true]] as const) {
      for (let split = 0; split <= text.length; split++) {
        const budget = new JsonFormattingBudget(4);
        const first = budget.exceeds(text.slice(0, split));
        expect(first || budget.exceeds(text.slice(split))).toBe(exceeded);
      }
    }
  });
  it("引用内の長い空白・引用符・バックスラッシュを原文のまま許可する", () => {
    const text = JSON.stringify({ value: '😀"' + " ".repeat(3000) + "\\ \t\n末尾" });
    for (let split = 0; split < text.length; split++) {
      const budget = new JsonFormattingBudget(4);
      expect(budget.exceeds(text.slice(0, split))).toBe(false);
      expect(budget.exceeds(text.slice(split))).toBe(false);
    }
  });
  it("引用の終端・エスケープを1文字ずつ処理しても状態を維持する", () => {
    const budget = new JsonFormattingBudget(4);
    for (const character of JSON.stringify({ value: '引用" \\    文' })) expect(budget.exceeds(character)).toBe(false);
    expect(budget.exceeds("  ")).toBe(false);
    expect(budget.exceeds("  ")).toBe(false);
    expect(budget.exceeds(" ")).toBe(true);
    expect(budget.exceeds("}")).toBe(true);
    expect(new JsonFormattingBudget(4).exceeds("    {    }    ")).toBe(false);
  });
});
