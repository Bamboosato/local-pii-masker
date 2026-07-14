import { describe, expect, it } from "vitest";
import {
  normalizeModelLabel,
  parseAnnotatedText,
  parseCorpus,
  scoreEntities,
  type ScoredEntity,
} from "./evaluation";

describe("NER評価ユーティリティ", () => {
  it("注釈を除いた原文とUTF-16位置を生成する", () => {
    expect(
      parseAnnotatedText(
        "担当は[[PERSON|山田太郎]]、所属は[[ORGANIZATION|青葉株式会社]]です。",
      ),
    ).toEqual({
      text: "担当は山田太郎、所属は青葉株式会社です。",
      entities: [
        { category: "PERSON", start: 3, end: 7, text: "山田太郎" },
        { category: "ORGANIZATION", start: 11, end: 17, text: "青葉株式会社" },
      ],
    });
  });

  it("不正注釈と重複文書IDを拒否する", () => {
    expect(() => parseAnnotatedText("[[UNKNOWN|山田太郎]]")).toThrow(
      "Invalid NER evaluation annotation",
    );
    expect(() =>
      parseCorpus({
        version: 1,
        description: "test",
        documents: [
          { id: "duplicate", annotatedText: "本文" },
          { id: "duplicate", annotatedText: "本文" },
        ],
      }),
    ).toThrow("Duplicate evaluation document id");
  });

  it("現行ラベルと日本語BIOラベルを共通ラベルへ正規化する", () => {
    expect(normalizeModelLabel("B-PER")).toBe("PER");
    expect(normalizeModelLabel("I-人名")).toBe("PER");
    expect(normalizeModelLabel("B-法人名")).toBe("ORG");
    expect(normalizeModelLabel("施設名")).toBe("INS");
    expect(normalizeModelLabel("LABEL_1")).toBeUndefined();
  });

  it("出現単位と文字列単位を分けてPrecision・Recallを集計する", () => {
    const expected: ScoredEntity[] = [
      entity("doc", "PERSON", "山田太郎", 0, 4),
      entity("doc", "PERSON", "山田太郎", 5, 9),
    ];
    const predicted = [entity("doc", "PERSON", "山田太郎", 0, 4)];

    expect(scoreEntities({ expected, predicted, mode: "occurrence" }).overall).toMatchObject({
      truePositive: 1,
      falseNegative: 1,
      falsePositive: 0,
      precision: 1,
      recall: 0.5,
    });
    expect(scoreEntities({ expected, predicted, mode: "target" }).overall).toMatchObject({
      truePositive: 1,
      falseNegative: 0,
      falsePositive: 0,
      precision: 1,
      recall: 1,
    });
  });
});

function entity(
  documentId: string,
  category: "PERSON" | "ORGANIZATION" | "ADDRESS",
  text: string,
  start: number,
  end: number,
): ScoredEntity {
  return { documentId, category, text, start, end };
}
