import { describe, expect, it } from "vitest";
import { detectPersonNamesWithNormalization } from "./detectPersonNamesWithNormalization";

describe("detectPersonNamesWithNormalization", () => {
  it.each([
    ["氏名：佐藤\n太郎", "佐藤\n太郎"],
    ["患者氏名：髙橋\r\n美咲", "髙橋\r\n美咲"],
  ])("ラベル付き姓名の改行を原文範囲のまま検出する: %s", (sourceText, name) => {
    expect(detectPersonNamesWithNormalization(sourceText)).toEqual([
      expect.objectContaining({
        originalText: name,
        category: "PERSON",
        source: "regex",
        normalizationRules: ["person_name_line_break"],
      }),
    ]);
  });

  it.each(["山 田 太 郎", "山 田　太郎", "山　田太　郎", "佐　藤　健　一"])(
    "空白を含む一般姓の姓名を原文表記の形式候補にする: %s",
    (name) => {
      expect(detectPersonNamesWithNormalization(name)).toEqual([
        {
          originalText: name,
          category: "PERSON",
          source: "regex",
          start: 0,
          end: name.length,
          normalizationRules: ["japanese_inter_character_space"],
        },
      ]);
    },
  );

  it.each([
    "確認 事項",
    "山 田太郎",
    "山  田 太 郎",
    "山\t田 太 郎",
    "高山 田 太 郎",
    "山 田 太 郎介",
  ])("曖昧または境界不正な空白表記は形式候補にしない: %s", (value) => {
    expect(detectPersonNamesWithNormalization(value)).toEqual([]);
  });
});
