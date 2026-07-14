import { describe, expect, it } from "vitest";
import { detectCredentials } from "./detectCredentials";

describe("detectCredentials", () => {
  it("ユーザーIDとパスワードの引用値だけを機密候補にする", () => {
    const sourceText =
      "ユーザーID「test.yamada」、パスワード「TempPass-2026!」を使用します。";
    const candidates = detectCredentials(sourceText);

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "test.yamada",
        category: "SECRET",
        source: "regex",
      }),
      expect.objectContaining({
        originalText: "TempPass-2026!",
        category: "SECRET",
        source: "regex",
      }),
    ]);
    expect(
      candidates.map(({ start, end }) => sourceText.slice(start, end)),
    ).toEqual(["test.yamada", "TempPass-2026!"]);
  });

  it("代表的なIDラベルとコロン・イコール区切りに対応する", () => {
    const candidates = detectCredentials(
      "ログインID: demo_user アカウントID＝A-123 Password = P@ssw0rd!",
    );

    expect(candidates.map((candidate) => candidate.originalText)).toEqual([
      "demo_user",
      "A-123",
      "P@ssw0rd!",
    ]);
  });

  it("引用符内では空白と記号を含む値を原文どおり保持する", () => {
    const candidates = detectCredentials(
      'ユーザ名 "team member"、パスワードは「A b#1!」です。',
    );

    expect(candidates.map((candidate) => candidate.originalText)).toEqual([
      "team member",
      "A b#1!",
    ]);
  });

  it("ラベルのない文字列、空値、不完全な引用値を候補にしない", () => {
    const candidates = detectCredentials(
      "test.yamada TempPass-2026! ユーザーID「」 パスワード「not-closed",
    );

    expect(candidates).toEqual([]);
  });

  it("別の英単語に含まれるIDをラベルとして扱わない", () => {
    const candidates = detectCredentials(
      "SSID: office-network identifier: sample ID「A-123」",
    );

    expect(candidates.map((candidate) => candidate.originalText)).toEqual([
      "A-123",
    ]);
  });

  it("同じ機密値の各出現位置を保持する", () => {
    const sourceText = "ユーザーID「demo」 ログインID「demo」";
    const candidates = detectCredentials(sourceText);

    expect(candidates).toHaveLength(2);
    expect(candidates.map(({ start, end }) => sourceText.slice(start, end))).toEqual(
      ["demo", "demo"],
    );
  });
});
