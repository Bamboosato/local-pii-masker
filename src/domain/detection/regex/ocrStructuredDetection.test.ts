import { describe, expect, it } from "vitest";
import { runRegexDetection } from "./runRegexDetection";

describe("OCR structured detection", () => {
  it("全角ASCIIのメールを原文表記のまま検出する", () => {
    const email = "ｔａｒｏ．ｙａｍａｄａ＠ｅｘａｍｐｌｅ．ｃｏ．ｊｐ";
    const candidates = runRegexDetection(`連絡先は${email}です。`);
    const candidate = candidates.find((item) => item.originalText === email);

    expect(candidate).toMatchObject({
      category: "EMAIL",
      restorationText: "taro.yamada@example.co.jp",
    });
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
            restorationText: email.replace(/\r?\n/gu, ""),
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

    expect(candidate).toMatchObject({
      category: "OTHER",
      restorationText: "https://dev.example.jp/login",
    });
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
            restorationText: url.replace(/\r?\n/gu, ""),
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

  it("複数行と行末ハイフンを含むメールを原文範囲で検出する", () => {
    const email = "taro-\nyamada@\nexample.\nco.jp";
    const candidate = runRegexDetection(`連絡先は${email}です。`).find(
      (item) => item.category === "EMAIL",
    );

    expect(candidate).toMatchObject({
      originalText: email,
      restorationText: "taro-yamada@example.co.jp",
    });
    expect(candidate?.normalizationRules).toEqual(
      expect.arrayContaining(["email_line_break", "line_end_hyphen"]),
    );
  });

  it("複数行と行末ハイフンを含むURLを原文範囲で検出する", () => {
    const url = "https://dev.\nexample.jp/long-\npath";
    const candidate = runRegexDetection(`参照先は${url}です。`).find(
      (item) => item.originalText === url,
    );

    expect(candidate).toMatchObject({
      category: "OTHER",
      restorationText: "https://dev.example.jp/long-path",
    });
    expect(candidate?.normalizationRules).toEqual(
      expect.arrayContaining(["url_line_break", "line_end_hyphen"]),
    );
  });

  it("複数行に折り返された住所を原文範囲で検出する", () => {
    const address = "愛知県\n豊田市\n若宮町二丁目15番地";
    const addressCandidates = runRegexDetection(
      `登録住所は${address}です。`,
    ).filter((item) => item.category === "ADDRESS");
    const candidate = addressCandidates.find(
      (item) => item.originalText === address,
    );

    expect(addressCandidates).toHaveLength(1);
    expect(candidate).toMatchObject({
      originalText: address,
      restorationText: "愛知県豊田市若宮町二丁目15番地",
      normalizationRules: ["address_line_break"],
    });
  });

  it("番と号の間で折り返された住所を前半候補へ分割しない", () => {
    const address = "東京都新宿区西新宿二丁目8番\n1号";
    const addressCandidates = runRegexDetection(address).filter(
      (item) => item.category === "ADDRESS",
    );

    expect(addressCandidates).toEqual([
      expect.objectContaining({
        originalText: address,
        restorationText: "東京都新宿区西新宿二丁目8番1号",
        normalizationRules: ["address_line_break"],
      }),
    ]);
  });

  it("空行や通常文をまたいで住所候補を作らない", () => {
    const candidates = runRegexDetection(
      "愛知県で会議を行った。\n豊田市から参加した。\n\n愛知県\n\n豊田市若宮町二丁目15番地",
    );

    expect(
      candidates.some((candidate) =>
        candidate.normalizationRules?.includes("address_line_break"),
      ),
    ).toBe(false);
  });
});
