import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_JAPANESE_SURNAMES,
  COMMON_JAPANESE_SURNAMES,
  createSurnamePattern,
  JAPANESE_SURNAMES,
  normalizeJapaneseName,
} from "./japanesePersonNames";

describe("japanesePersonNames", () => {
  it("姓辞書を重複なく200姓以上で保持する", () => {
    expect(JAPANESE_SURNAMES.length).toBeGreaterThanOrEqual(200);
    expect(new Set(JAPANESE_SURNAMES).size).toBe(JAPANESE_SURNAMES.length);
    expect(COMMON_JAPANESE_SURNAMES).toEqual(JAPANESE_SURNAMES);
    expect(JAPANESE_SURNAMES).toEqual(
      expect.arrayContaining([
        "山下",
        "金子",
        "五十嵐",
        "久保田",
        "大久保",
        "富田",
      ]),
    );
    expect(AMBIGUOUS_JAPANESE_SURNAMES).toEqual(
      new Set(["林", "森", "原", "東", "南", "関", "堀", "岡", "辻"]),
    );
  });

  it("正規表現パターンを長い姓から安定して生成する", () => {
    expect(createSurnamePattern(["久保", "久保田", "佐々木", "久保"])).toBe(
      "久保田|佐々木|久保",
    );
  });

  it.each([
    ["髙橋", "高橋"],
    ["山﨑", "山崎"],
    ["渡邉", "渡辺"],
    ["渡邊", "渡辺"],
    ["齋藤", "斎藤"],
    ["齊藤", "斎藤"],
    ["濱田", "浜田"],
    ["𠮷田", "吉田"],
  ])("異体字を代表字へ正規化する: %s", (value, expected) => {
    expect(normalizeJapaneseName(value)).toBe(expected);
  });
});
