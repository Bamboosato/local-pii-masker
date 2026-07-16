import { describe, expect, it } from "vitest";
import type { MaskCategory } from "../types";
import type { DetectionCandidate } from "./mergeCandidates";
import { refineDetectionCandidates } from "./refineDetectionCandidates";

describe("refineDetectionCandidates", () => {
  it("氏名直後の読み仮名内で分割されたNER候補を除外する", () => {
    const sourceText = "山田太郎やまだたろう";
    const candidates = [
      createCandidate(sourceText, "山田太郎", "PERSON", "regex"),
      createCandidate(sourceText, "まだ", "ORGANIZATION", "ner"),
      createCandidate(sourceText, "ろう", "ORGANIZATION", "ner"),
    ];

    expect(refineDetectionCandidates(sourceText, candidates)).toEqual([
      candidates[0],
    ]);
  });

  it("独立したひらがな組織候補は一律に除外しない", () => {
    const sourceText = "みずほ銀行";
    const candidate = createCandidate(
      sourceText,
      "みずほ",
      "ORGANIZATION",
      "ner",
    );

    expect(refineDetectionCandidates(sourceText, [candidate])).toEqual([
      candidate,
    ]);
  });

  it("電話番号に包含される郵便番号候補を除外する", () => {
    const sourceText = "連絡先は080-9876-5432です。";
    const phone = createCandidate(
      sourceText,
      "080-9876-5432",
      "PHONE",
      "regex",
    );
    const postalCode = createCandidate(
      sourceText,
      "080-9876",
      "POSTAL_CODE",
      "regex",
    );

    expect(refineDetectionCandidates(sourceText, [phone, postalCode])).toEqual([
      phone,
    ]);
  });

  it("単独の3桁4桁表記は郵便番号候補として維持する", () => {
    const sourceText = "郵便番号は080-9876です。";
    const postalCode = createCandidate(
      sourceText,
      "080-9876",
      "POSTAL_CODE",
      "regex",
    );

    expect(refineDetectionCandidates(sourceText, [postalCode])).toEqual([
      postalCode,
    ]);
  });

  it("メール・URLなどの構造化候補内にあるNER断片を除外する", () => {
    const sourceText =
      "宛先taro@example.co.jp、参照先https://orion.example.jp/path";
    const email = createCandidate(
      sourceText,
      "taro@example.co.jp",
      "EMAIL",
      "regex",
    );
    const url = createCandidate(
      sourceText,
      "https://orion.example.jp/path",
      "OTHER",
      "regex",
    );
    const emailFragment = createCandidate(
      sourceText,
      "example.co.jp",
      "ORGANIZATION",
      "ner",
    );
    const urlFragment = createCandidate(
      sourceText,
      "orion.example.jp",
      "ORGANIZATION",
      "ner",
    );

    expect(
      refineDetectionCandidates(sourceText, [
        email,
        url,
        emailFragment,
        urlFragment,
      ]),
    ).toEqual([email, url]);
  });

  it("メール内だけに存在するPERSON候補を除外する", () => {
    const sourceText = "連絡先taro.yamada@example.co.jpです。";
    const email = createCandidate(
      sourceText,
      "taro.yamada@example.co.jp",
      "EMAIL",
      "regex",
    );
    const person = createCandidate(
      sourceText,
      "taro.yamada",
      "PERSON",
      "ner",
    );

    expect(refineDetectionCandidates(sourceText, [email, person])).toEqual([
      email,
    ]);
  });

  it("メール内と本文に共通して現れるPERSON候補は維持する", () => {
    const sourceText =
      "担当者taro.yamadaです。連絡先taro.yamada@example.co.jpです。";
    const email = createCandidate(
      sourceText,
      "taro.yamada@example.co.jp",
      "EMAIL",
      "regex",
    );
    const person = createCandidate(
      sourceText,
      "taro.yamada",
      "PERSON",
      "ner",
    );

    expect(refineDetectionCandidates(sourceText, [email, person])).toEqual([
      email,
      person,
    ]);
  });

  it("組織・住所の入れ子候補は長い候補を優先する", () => {
    const sourceText = "青葉デジタルソリューションズの20階";
    const fullOrganization = createCandidate(
      sourceText,
      "青葉デジタルソリューションズ",
      "ORGANIZATION",
      "ner",
    );
    const organizationFragment = createCandidate(
      sourceText,
      "デジタルソリューションズ",
      "ORGANIZATION",
      "ner",
    );
    const suffixFragment = createCandidate(
      sourceText,
      "ーションズ",
      "ORGANIZATION",
      "ner",
    );
    const floorOnly = createCandidate(
      sourceText,
      "20階",
      "ADDRESS",
      "ner",
    );

    expect(
      refineDetectionCandidates(sourceText, [
        fullOrganization,
        organizationFragment,
        suffixFragment,
        floorOnly,
      ]),
    ).toEqual([fullOrganization]);
  });

  it("複数箇所にある組織断片が全て長い候補内なら除外する", () => {
    const sourceText =
      "株式会社青葉デジタルソリューションズと株式会社青葉デジタルソリューションズ。";
    const fullOrganization = createCandidate(
      sourceText,
      "株式会社青葉デジタルソリューションズ",
      "ORGANIZATION",
      "ner",
    );
    const fragment = createCandidate(
      sourceText,
      "ジタルソリューションズ",
      "ORGANIZATION",
      "ner",
    );

    expect(refineDetectionCandidates(sourceText, [fullOrganization, fragment])).toEqual([
      fullOrganization,
    ]);
  });

  it("組織断片が単独でも出現する場合は除外しない", () => {
    const sourceText =
      "株式会社青葉デジタルソリューションズの略称はジタルソリューションズです。";
    const fullOrganization = createCandidate(
      sourceText,
      "株式会社青葉デジタルソリューションズ",
      "ORGANIZATION",
      "ner",
    );
    const fragment = createCandidate(
      sourceText,
      "ジタルソリューションズ",
      "ORGANIZATION",
      "ner",
    );

    expect(refineDetectionCandidates(sourceText, [fullOrganization, fragment])).toEqual([
      fullOrganization,
      fragment,
    ]);
  });

  it("改行込みの長い組織候補に含まれる末尾断片を除外する", () => {
    const sourceText = "株式会社\n青葉デジタル\nソリューションズ";
    const fullOrganization: DetectionCandidate = {
      originalText: sourceText,
      category: "ORGANIZATION",
      source: "ner",
      start: 0,
      end: sourceText.length,
    };
    const fragmentStart = sourceText.indexOf("ーションズ");
    const fragment: DetectionCandidate = {
      originalText: "ーションズ",
      category: "ORGANIZATION",
      source: "ner",
      start: fragmentStart,
      end: fragmentStart + "ーションズ".length,
    };

    expect(refineDetectionCandidates(sourceText, [fullOrganization, fragment])).toEqual([
      fullOrganization,
    ]);
  });

  it("姓と姓名のPERSON候補は両方維持する", () => {
    const sourceText = "山田太郎";
    const fullName = createCandidate(
      sourceText,
      "山田太郎",
      "PERSON",
      "ner",
    );
    const surname = createCandidate(sourceText, "山田", "PERSON", "regex");

    expect(refineDetectionCandidates(sourceText, [fullName, surname])).toEqual([
      fullName,
      surname,
    ]);
  });
});

function createCandidate(
  sourceText: string,
  originalText: string,
  category: MaskCategory,
  source: DetectionCandidate["source"],
): DetectionCandidate {
  const start = sourceText.indexOf(originalText);

  return {
    originalText,
    category,
    source,
    start,
    end: start + originalText.length,
  };
}
