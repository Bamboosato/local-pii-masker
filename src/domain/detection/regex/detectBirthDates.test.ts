import { describe, expect, it } from "vitest";
import { detectBirthDates } from "./detectBirthDates";

describe("detectBirthDates", () => {
  it("生年月日と誕生日のラベルを除き、年月日の値だけを候補にする", () => {
    const sourceText =
      "生年月日「1985年4月12日」、誕生日は2000年2月29日です。";
    const candidates = detectBirthDates(sourceText);

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "1985年4月12日",
        category: "OTHER",
        source: "regex",
      }),
      expect.objectContaining({ originalText: "2000年2月29日" }),
    ]);
    expect(
      candidates.map(({ start, end }) => sourceText.slice(start, end)),
    ).toEqual(["1985年4月12日", "2000年2月29日"]);
  });

  it("スラッシュ・ハイフン・全角表記の西暦日付に対応する", () => {
    const candidates = detectBirthDates(
      "生年月日: 1985/04/12 DOB=2001-9-8 誕生日：１９９０／１２／３１",
    );

    expect(candidates.map((candidate) => candidate.originalText)).toEqual([
      "1985/04/12",
      "2001-9-8",
      "１９９０／１２／３１",
    ]);
  });

  it("有効な和暦と元年表記を検出する", () => {
    const candidates = detectBirthDates(
      "生年月日は昭和60年4月12日、誕生日「令和元年5月1日」です。",
    );

    expect(candidates.map((candidate) => candidate.originalText)).toEqual([
      "昭和60年4月12日",
      "令和元年5月1日",
    ]);
  });

  it("存在しない日付と元号の期間外の日付を除外する", () => {
    const candidates = detectBirthDates(
      "生年月日2001年2月29日 誕生日2026/13/1 生年月日平成31年5月1日 誕生日令和元年4月30日",
    );

    expect(candidates).toEqual([]);
  });

  it("400年規則の閏日は許可し、平年の2月29日は除外する", () => {
    const candidates = detectBirthDates(
      "生年月日2000年2月29日 誕生日1900年2月29日",
    );

    expect(candidates.map((candidate) => candidate.originalText)).toEqual([
      "2000年2月29日",
    ]);
  });

  it("ラベルのない日付や一般的な予定日は候補にしない", () => {
    const candidates = detectBirthDates(
      "1985年4月12日生まれです。会議日は2026年7月15日です。",
    );

    expect(candidates).toEqual([]);
  });
});
