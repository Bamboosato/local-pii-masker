import { describe, expect, it } from "vitest";
import { buildNormalizationPreview } from "./buildPreviewSegments";
import { normalizeDocumentText } from "./normalizeDocumentText";

describe("normalizeDocumentText", () => {
  it("normalizes NFC and full-width ASCII in ordinary text", () => {
    const result = normalizeDocumentText("e\u0301 と ０１２３", "standard");

    expect(result.normalizedText).toBe("é と 0123");
    expect(result.summary.map((item) => item.ruleId)).toEqual(
      expect.arrayContaining(["unicode_nfc", "fullwidth_ascii"]),
    );
  });

  it("joins and normalizes a spaced phone number", () => {
    const result = normalizeDocumentText("電話 ０９０ - １２３４ - ５６７８", "standard");
    expect(result.normalizedText).toBe("電話 090-1234-5678");
    expect(result.summary.map((item) => item.ruleId)).toEqual(
      expect.arrayContaining(["fullwidth_ascii", "phone_spacing"]),
    );
  });

  it("joins a line-broken email address", () => {
    const result = normalizeDocumentText("sample @ example.\ncom", "standard");

    expect(result.normalizedText).toBe("sample@example.com");
    expect(result.summary.map((item) => item.ruleId)).toEqual(
      expect.arrayContaining(["email_line_break"]),
    );
  });

  it("removes repeated spaces around an email structure", () => {
    const result = normalizeDocumentText("sample  @  example  .  jp", "standard");

    expect(result.normalizedText).toBe("sample@example.jp");
  });

  it("keeps adjacent emails and ordinary hyphenated text outside the email", () => {
    const source =
      "taro.yamada@\naoba-digital.example.jp\nhanako.yamada\n@\naoba-digital.example.jp\nProject Ori-\non\ncustomer-manage-\nment-system";
    const result = normalizeDocumentText(source, "standard");

    expect(result.normalizedText).toContain(
      "taro.yamada@aoba-digital.example.jp\nhanako.yamada@aoba-digital.example.jp",
    );
    expect(result.normalizedText).toContain("Project Ori-\non");
    expect(result.normalizedText).toContain("customer-manage-\nment-system");
    expect(result.normalizedText).not.toContain("example.jphanako");
  });

  it("joins a line-broken local part without consuming the following line", () => {
    const result = normalizeDocumentText(
      "taro.\nyamada@\nexample.\njp\n次の行",
      "standard",
    );

    expect(result.normalizedText).toBe("taro.yamada@example.jp\n次の行");
  });

  it("completes on long hyphen runs without regex backtracking", () => {
    const source = `${"a-".repeat(1000)}@${"a-".repeat(1000)}.com`;

    const result = normalizeDocumentText(source, "standard");

    expect(result.normalizedText).toBe(source);
  });

  it("joins a label and its value without joining an unrelated paragraph", () => {
    const result = normalizeDocumentText(
      "氏名：\n山田 太郎\nこれは別の文章です。\n次の段落です。",
      "standard",
    );
    expect(result.normalizedText).toBe(
      "氏名:山田 太郎\nこれは別の文章です。\n次の段落です。",
    );
  });

  it("reports special-space conversion separately from invisible-character removal", () => {
    const result = normalizeDocumentText("前\u3000後", "standard");

    expect(result.normalizedText).toBe("前 後");
    expect(result.summary.map((item) => item.ruleId)).toContain("special_whitespace");
    expect(result.summary.map((item) => item.ruleId)).not.toContain("invisible_character");
  });

  it("does not attach a postal-address paragraph to the preceding prose", () => {
    const result = normalizeDocumentText(
      "株式会社サンプル\nのおかず\n\n123-4567 名古屋市 中村区 細岡町 1 - 54 - 6",
      "standard",
    );

    expect(result.normalizedText).toContain("のおかず\n\n123-4567");
    expect(result.normalizedText).not.toContain("のおかず123-4567");
  });

  it("joins an OCR line break inside a postal code only", () => {
    const result = normalizeDocumentText("説明\n\n123-\n4567", "standard");

    expect(result.normalizedText).toBe("説明\n\n123-4567");
    expect(result.summary.map((item) => item.ruleId)).toContain("postal_code_line_break");
  });

  it("aggressively joins Japanese names and address lines in detection-priority mode", () => {
    const result = normalizeDocumentText(
      "山 田 太 郎\n愛知県名古屋市\n中村区名駅一丁目1番4号",
      "detection_priority",
    );
    expect(result.normalizedText).toBe(
      "山田太郎愛知県名古屋市中村区名駅一丁目1番4号",
    );
    expect(result.summary.map((item) => item.ruleId)).toEqual(
      expect.arrayContaining(["japanese_inter_character_space", "address_line_break"]),
    );
  });

  it("reports generic Japanese spacing for postal-address text", () => {
    const result = normalizeDocumentText(
      "123-4567 名古屋市 中村区 細岡町",
      "detection_priority",
    );

    expect(result.normalizedText).toBe("123-4567名古屋市中村区細岡町");
    expect(result.summary.map((item) => item.ruleId)).toContain("japanese_inter_character_space");
    expect(result.summary.map((item) => item.ruleId)).not.toContain("person_inter_character_space");
  });

  it("joins a wrapped list item but preserves the next item boundary", () => {
    const result = normalizeDocumentText(
      "・申請者の氏名および\n住所を記載してください。\n・本人確認書類を添付してください。",
      "standard",
    );

    expect(result.normalizedText).toBe(
      "・申請者の氏名および住所を記載してください。\n・本人確認書類を添付してください。",
    );
  });

  it("does not normalize inside a fenced code block", () => {
    const source = "```text\n０９０ - １２３４\n```";
    const result = normalizeDocumentText(source, "detection_priority");

    expect(result.normalizedText).toBe(source);
    expect(result.changedLocationCount).toBe(0);
  });

  it("does not normalize an indented code line", () => {
    const source = "説明\n\n\n    ０９０ - １２３４\n\n\n続き";
    const result = normalizeDocumentText(source, "detection_priority");

    expect(result.normalizedText).toContain("    ０９０ - １２３４");
  });

  it("returns source mappings and preview segments for changed text", () => {
    const source = "０９０";
    const result = normalizeDocumentText(source, "standard");
    const preview = buildNormalizationPreview(source, result);

    expect(result.mappings).toHaveLength(result.normalizedText.length);
    expect(preview.before.some((segment) => segment.changed)).toBe(true);
    expect(preview.after.some((segment) => segment.changed)).toBe(true);
  });

  it("is idempotent for the same mode", () => {
    const first = normalizeDocumentText("０９０ - １２３４", "standard");
    const second = normalizeDocumentText(first.normalizedText, "standard");

    expect(second.normalizedText).toBe(first.normalizedText);
    expect(second.events).toHaveLength(0);
  });
});
