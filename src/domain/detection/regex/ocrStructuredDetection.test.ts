import { describe, expect, it } from "vitest";
import { runRegexDetection } from "./runRegexDetection";

describe("OCR structured detection", () => {
  it("全角ASCIIのメールを原文表記のまま検出する", () => {
    const email = "ｔａｒｏ．ｙａｍａｄａ＠ｅｘａｍｐｌｅ．ｃｏ．ｊｐ";
    const candidates = runRegexDetection(`連絡先は${email}です。`);
    const candidate = candidates.find((item) => item.originalText === email);

    expect(candidate).toMatchObject({ category: "EMAIL" });
    expect(candidate?.normalizationRules).toContain("fullwidth_ascii");
  });

  it("@またはドメイン区切りで改行したメールを原文範囲で検出する", () => {
    const emails = [
      "taro.yamada@\nexample.co.jp",
      "hanako.sato@example.\nco.jp",
    ];
    const candidates = runRegexDetection(emails.join("\n---\n"));

    for (const email of emails) {
      expect(candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "EMAIL",
            originalText: email,
            normalizationRules: expect.arrayContaining(["email_line_break"]),
          }),
        ]),
      );
    }
  });

  it("全角ASCIIのURLを原文表記のまま検出する", () => {
    const url = "ｈｔｔｐｓ：／／ｄｅｖ．ｅｘａｍｐｌｅ．ｊｐ／ｌｏｇｉｎ";
    const candidates = runRegexDetection(`参照先は${url}です。`);
    const candidate = candidates.find((item) => item.originalText === url);

    expect(candidate).toMatchObject({ category: "OTHER" });
    expect(candidate?.normalizationRules).toContain("fullwidth_ascii");
  });

  it("ドメインまたはパス区切りで改行したURLを原文範囲で検出する", () => {
    const urls = [
      "https://dev.example.\njp/login",
      "https://dev.example.jp/\nlogin",
    ];
    const candidates = runRegexDetection(urls.join("\n---\n"));

    for (const url of urls) {
      expect(candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "OTHER",
            originalText: url,
            normalizationRules: expect.arrayContaining(["url_line_break"]),
          }),
        ]),
      );
    }
  });

  it("通常のURL直後にある次行の英字はURLへ結合しない", () => {
    const candidates = runRegexDetection(
      "参照先はhttps://example.com\nNext sectionです。",
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ originalText: "https://example.com" }),
      ]),
    );
    expect(
      candidates.some(
        (candidate) =>
          candidate.originalText.includes("\n") ||
          candidate.originalText.includes("Next"),
      ),
    ).toBe(false);
  });
});
