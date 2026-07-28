import { describe, expect, it } from "vitest";
import type { MaskEntry, ReviewStatus } from "../types";
import { maskText } from "./maskText";

function entry(
  originalText: string,
  token: string,
  options: { enabled?: boolean; reviewStatus?: ReviewStatus } = {},
): MaskEntry {
  return {
    id: token,
    originalText,
    normalizedText: originalText.normalize("NFC"),
    restorationText: originalText.normalize("NFC"),
    token,
    category: "PERSON",
    sources: ["manual"],
    enabled: options.enabled ?? true,
    occurrenceCount: 0,
    reviewStatus: options.reviewStatus ?? "approved",
    displayOrder: 0,
  };
}

describe("maskText", () => {
  describe("機能観点", () => {
    it("1つの対象が1回出現する場合に置換する", () => {
      expect(maskText("山田太郎です", [entry("山田太郎", "[人名_1]")])).toBe(
        "[人名_1]です",
      );
    });

    it("同一文字列の複数出現を同じトークンで一括置換する", () => {
      expect(maskText("山田さん、山田です", [entry("山田", "[人名_1]")])).toBe(
        "[人名_1]さん、[人名_1]です",
      );
    });

    it("無効化した対象は全出現箇所が原文のまま残る", () => {
      expect(
        maskText("山田さん、山田です", [
          entry("山田", "[人名_1]", { enabled: false }),
        ]),
      ).toBe("山田さん、山田です");
    });

    it("未確認候補は有効化されるまでマスク結果へ反映しない", () => {
      expect(
        maskText("山田さん", [
          entry("山田", "[人名_1]", { reviewStatus: "unreviewed" }),
        ]),
      ).toBe("山田さん");
    });
  });

  describe("境界値・重なり観点", () => {
    it("山田と山田太郎が同じ位置で一致する場合は最長一致を採用する", () => {
      expect(
        maskText("山田さんと山田太郎さん", [
          entry("山田", "[人名_1]"),
          entry("山田太郎", "[人名_2]"),
        ]),
      ).toBe("[人名_1]さんと[人名_2]さん");
    });

    it("異なる位置で重なる候補は先に消費された範囲を再置換しない", () => {
      expect(
        maskText("abc", [entry("ab", "[A_1]"), entry("bc", "[B_1]")]),
      ).toBe("[A_1]c");
    });

    it("同じ長さの候補がある場合も入力順に依存せず一致した文字列だけを置換する", () => {
      expect(
        maskText("ab ac", [entry("ac", "[AC_1]"), entry("ab", "[AB_1]")]),
      ).toBe("[AB_1] [AC_1]");
    });
  });

  describe("データ観点", () => {
    it("Unicode NFC 正規化後の文字列として一致させる", () => {
      expect(maskText("ガク", [entry("ガク", "[人名_1]")])).toBe("[人名_1]");
    });

    it("全角と半角は区別する", () => {
      expect(maskText("ABC ＡＢＣ", [entry("ABC", "[CODE_1]")])).toBe(
        "[CODE_1] ＡＢＣ",
      );
    });

    it("大文字と小文字は区別する", () => {
      expect(maskText("Yamada yamada", [entry("Yamada", "[人名_1]")])).toBe(
        "[人名_1] yamada",
      );
    });

    it("0件になった対象は一覧に残っていてもマスク結果を変えない", () => {
      expect(maskText("佐藤です", [entry("山田", "[人名_1]")])).toBe("佐藤です");
    });
  });
});
