import { describe, expect, it } from "vitest";
import { createMaskToken, isMaskToken } from "./tokenFactory";

describe("tokenFactory", () => {
  it("カテゴリ名を含むセッション内一意のトークンを生成する", () => {
    const token = createMaskToken("PERSON", {
      originalText: "",
      entries: [{ token: "[人名_1]" }],
    });

    expect(token).toBe("[人名_2]");
  });

  it("原文中に存在するトークン候補との衝突を避ける", () => {
    const token = createMaskToken("PHONE", {
      originalText: "既に [電話番号_1] を含む文",
      entries: [],
    });

    expect(token).toBe("[電話番号_2]");
  });

  it("トークン形式を検証できる", () => {
    expect(isMaskToken("[人名_1]")).toBe(true);
    expect(isMaskToken("人名_1")).toBe(false);
  });
});
