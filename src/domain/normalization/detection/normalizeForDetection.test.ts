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

  it("全角ASCIIとハイフン類を検出用テキストだけで正規化する", () => {
    const sourceText = "管理番号ＡＢＣ−１２３";
    const result = normalizeForDetection(sourceText, [
      "fullwidth_ascii",
      "hyphen_variants",
    ]);

    expect(result.text).toBe("管理番号ABC-123");
    expect(sourceText).toBe("管理番号ＡＢＣ−１２３");
    expect(result.appliedRules.map((event) => event.rule)).toEqual(
      expect.arrayContaining(["fullwidth_ascii", "hyphen_variants"]),
    );
  });

  it("メール区切り位置のCRLFを除去し、全角メール全体を原文範囲へ戻す", () => {
    const originalEmail = "ｔａｒｏ＠\r\nｅｘａｍｐｌｅ．ｃｏｍ";
    const sourceText = `連絡先:${originalEmail}です。`;
    const result = normalizeForDetection(sourceText, [
      "fullwidth_ascii",
      "email_line_break",
    ]);
    const normalizedEmail = "taro@example.com";
    const start = result.text.indexOf(normalizedEmail);
    const originalRange = mapNormalizedRange(result, {
      start,
      end: start + normalizedEmail.length,
    });

    expect(result.text).toContain(normalizedEmail);
    expect(sourceText.slice(originalRange?.start, originalRange?.end)).toBe(
      originalEmail,
    );
    expect(result.appliedRules.map((event) => event.rule)).toContain(
      "email_line_break",
    );
  });

  it("通常文の改行はOCR正規化対象にしない", () => {
    const sourceText = "確認しました。\nNext section";
    const result = normalizeForDetection(sourceText, [
      "email_line_break",
      "url_line_break",
    ]);

    expect(result.text).toBe(sourceText);
    expect(result.appliedRules).toEqual([]);
  });

  it("Markdownコードフェンスを維持したままメールだけを正規化する", () => {
    const sourceText = [
      "```text",
      "ｔａｒｏ＠",
      "ｅｘａｍｐｌｅ．ｃｏｍ",
      "```",
    ].join("\n");
    const result = normalizeForDetection(sourceText, [
      "fullwidth_ascii",
      "email_line_break",
    ]);

    expect(result.text).toBe(["```text", "taro@example.com", "```"].join("\n"));
    expect(sourceText.startsWith("```text\n")).toBe(true);
    expect(sourceText.endsWith("\n```")).toBe(true);
  });

  it("姓名間の改行を除去し、改行込みの原文範囲へ戻す", () => {
    const originalName = "山田\n太郎";
    const sourceText = `氏名：${originalName}さん`;
    const result = normalizeForDetection(sourceText, [
      "person_name_line_break",
    ]);
    const normalizedName = "山田太郎";
    const start = result.text.indexOf(normalizedName);
    const originalRange = mapNormalizedRange(result, {
      start,
      end: start + normalizedName.length,
    });

    expect(result.text).toBe("氏名：山田太郎さん");
    expect(sourceText.slice(originalRange?.start, originalRange?.end)).toBe(
      originalName,
    );
    expect(result.appliedRules).toEqual([
      expect.objectContaining({
        rule: "person_name_line_break",
        originalStart: sourceText.indexOf(originalName),
        originalEnd: sourceText.indexOf(originalName) + originalName.length,
      }),
    ]);
  });

  it("姓名間のCRLFと周辺空白を検出用テキストだけから除去する", () => {
    const sourceText = "担当：佐藤 \r\n　健一さん";
    const result = normalizeForDetection(sourceText, [
      "person_name_line_break",
    ]);

    expect(result.text).toBe("担当：佐藤健一さん");
    expect(sourceText).toBe("担当：佐藤 \r\n　健一さん");
  });

  it.each([
    ["担当者は山田太\n郎です。", "担当者は山田太郎です。"],
    ["品質確認は佐藤健\n一が担当します。", "品質確認は佐藤健一が担当します。"],
    ["問い合わせ先は田中美\n咲です。", "問い合わせ先は田中美咲です。"],
    ["開発責任者は高橋健\n太です。", "開発責任者は高橋健太です。"],
  ])("文中で分断された姓名を結合する: %s", (sourceText, expectedText) => {
    const result = normalizeForDetection(sourceText, [
      "person_name_line_break",
    ]);

    expect(result.text).toBe(expectedText);
    expect(result.appliedRules).toEqual([
      expect.objectContaining({ rule: "person_name_line_break" }),
    ]);
  });

  it.each([
    "本日は山田\n太郎さんと会議を行った",
    "山田。\n太郎",
    "山田\n\n太郎",
    "株式会社\n青葉商事",
    "# 山田\n太郎",
    ["```text", "山田", "太郎", "```"].join("\n"),
  ])("通常文やMarkdownの改行を姓名として誤結合しない: %s", (sourceText) => {
    const result = normalizeForDetection(sourceText, [
      "person_name_line_break",
    ]);

    expect(result.text).toBe(sourceText);
    expect(result.appliedRules).toEqual([]);
  });

  it.each([
    ["山 田 太 郎", "山田太郎"],
    ["山 田　太郎", "山田太郎"],
    ["山　田太　郎", "山田太郎"],
    ["佐　藤　健　一", "佐藤健一"],
    ["ヤ マ ダ タ ロ ウ", "ヤマダタロウ"],
  ])(
    "日本語の各文字間にある単一空白をNER用に除去する: %s",
    (originalName, normalizedName) => {
      const sourceText = `氏名：${originalName}さん`;
      const result = normalizeForDetection(sourceText, [
        "japanese_inter_character_space",
      ]);
      const start = result.text.indexOf(normalizedName);
      const originalRange = mapNormalizedRange(result, {
        start,
        end: start + normalizedName.length,
      });

      expect(result.text).toBe(`氏名：${normalizedName}さん`);
      expect(sourceText.slice(originalRange?.start, originalRange?.end)).toBe(
        originalName,
      );
      expect(result.appliedRules).toEqual([
        expect.objectContaining({
          rule: "japanese_inter_character_space",
        }),
      ]);
    },
  );

  it.each([
    "確認 事項を記載する",
    "山田 太郎",
    "山 田太郎",
    "山  田 太 郎",
    "山\t田 太 郎",
    "高山 田 太 郎",
    "山 田 太 郎介",
  ])("通常の単語間空白や曖昧な表記を除去しない: %s", (sourceText) => {
    const result = normalizeForDetection(sourceText, [
      "japanese_inter_character_space",
    ]);

    expect(result.text).toBe(sourceText);
    expect(result.appliedRules).toEqual([]);
  });

  it("改行を越えて結合せず、各行の空白表記を独立して正規化する", () => {
    const sourceText = "山 田 太 郎\n佐 藤 健 一";
    const result = normalizeForDetection(sourceText, [
      "japanese_inter_character_space",
    ]);

    expect(result.text).toBe("山田太郎\n佐藤健一");
    expect(result.appliedRules).toHaveLength(2);
  });

  it("コードブロック内でも原文構造を変えずに検出用空白を除去する", () => {
    const sourceText = ["```text", "山 田 太 郎", "```"].join("\n");
    const result = normalizeForDetection(sourceText, [
      "japanese_inter_character_space",
    ]);

    expect(result.text).toBe(["```text", "山田太郎", "```"].join("\n"));
    expect(sourceText).toBe(["```text", "山 田 太 郎", "```"].join("\n"));
  });

  it("複数箇所で折り返されたメールを1つの検出用文字列へ結合する", () => {
    const sourceText = "taro.\nyamada@\nexample.\nco.jp";
    const result = normalizeForDetection(sourceText, ["email_line_break"]);

    expect(result.text).toBe("taro.yamada@example.co.jp");
    expect(result.appliedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "email_line_break" }),
      ]),
    );
    expect(
      result.appliedRules.every((event) => event.rule === "email_line_break"),
    ).toBe(true);
  });

  it("メールの行末ハイフンを保持して改行だけを除去する", () => {
    const sourceText = "taro-\nyamada@example.co.jp";
    const result = normalizeForDetection(sourceText, ["email_line_break"]);

    expect(result.text).toBe("taro-yamada@example.co.jp");
    expect(result.appliedRules.map((event) => event.rule)).toEqual([
      "email_line_break",
      "line_end_hyphen",
    ]);
  });

  it("構造記号で複数回折り返されたURLを順番に結合する", () => {
    const sourceText = "https://dev.\nexample.\njp/\nlogin";
    const result = normalizeForDetection(sourceText, ["url_line_break"]);

    expect(result.text).toBe("https://dev.example.jp/login");
    expect(
      result.appliedRules.filter((event) => event.rule === "url_line_break"),
    ).toHaveLength(3);
  });

  it("URLの行末ハイフンを保持して改行だけを除去する", () => {
    const sourceText = "https://example.jp/long-\npath";
    const result = normalizeForDetection(sourceText, ["url_line_break"]);

    expect(result.text).toBe("https://example.jp/long-path");
    expect(result.appliedRules.map((event) => event.rule)).toEqual([
      "url_line_break",
      "line_end_hyphen",
    ]);
  });

  it("都道府県・市区町村・町域の境界で折り返された住所を結合する", () => {
    const sourceText = "愛知県\n豊田市\n若宮町二丁目15番地";
    const result = normalizeForDetection(sourceText, ["address_line_break"]);

    expect(result.text).toBe("愛知県豊田市若宮町二丁目15番地");
    expect(result.appliedRules).toEqual([
      expect.objectContaining({ rule: "address_line_break" }),
    ]);
  });

  it.each([
    "東京都新宿区西新宿二丁目8番\n1号",
    "大阪府大阪市北区梅田一丁目\n1番1号",
  ])("丁目・番・号の途中で折り返された住所を結合する: %s", (sourceText) => {
    const result = normalizeForDetection(sourceText, ["address_line_break"]);

    expect(result.text).toBe(sourceText.replace("\n", ""));
    expect(result.appliedRules).toEqual([
      expect.objectContaining({ rule: "address_line_break" }),
    ]);
  });

  it.each([
    "愛知県で会議を行った。\n豊田市から参加した。",
    "愛知県\n\n豊田市若宮町二丁目15番地",
    "# 愛知県\n豊田市若宮町二丁目15番地",
  ])("住所として連続しない改行は結合しない: %s", (sourceText) => {
    const result = normalizeForDetection(sourceText, ["address_line_break"]);

    expect(result.text).toBe(sourceText);
    expect(result.appliedRules).toEqual([]);
  });
});
