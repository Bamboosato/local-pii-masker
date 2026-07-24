import { describe, expect, it } from "vitest";
import {
  mapLabelToCategory,
  mapNerOutputsToCandidates,
} from "./mapNerOutputs";

describe("mapNerOutputsToCandidates", () => {
  it("モデルの位置情報がある場合は原文から候補文字列を切り出す", () => {
    const sourceText = "山田太郎さんは株式会社青葉へ行きました。";

    expect(
      mapNerOutputsToCandidates(
        [
          {
            entity_group: "PER",
            score: 0.93,
            word: "別文字列",
            start: 0,
            end: 4,
          },
          {
            entity_group: "ORG",
            score: 0.88,
            start: 7,
            end: 13,
          },
        ],
        sourceText,
      ),
    ).toEqual([
      {
        originalText: "山田太郎",
        category: "PERSON",
        source: "ner",
        start: 0,
        end: 4,
        confidence: 0.93,
      },
      {
        originalText: "株式会社青葉",
        category: "ORGANIZATION",
        source: "ner",
        start: 7,
        end: 13,
        confidence: 0.88,
      },
    ]);
  });

  it("文脈のない英語氏名でもPER出力なら人名候補として維持する", () => {
    const sourceText = "Taro Yamada attended the meeting.";

    expect(
      mapNerOutputsToCandidates(
        [
          {
            entity_group: "PER",
            score: 0.91,
            word: "Taro Yamada",
            start: 0,
            end: 11,
          },
        ],
        sourceText,
      ),
    ).toEqual([
      {
        originalText: "Taro Yamada",
        category: "PERSON",
        source: "ner",
        start: 0,
        end: 11,
        confidence: 0.91,
      },
    ]);
  });

  it("BIO接頭辞を取り除き、MVPカテゴリへ写像する", () => {
    expect(mapLabelToCategory("B-PER")).toBe("PERSON");
    expect(mapLabelToCategory("I-ORG-P")).toBe("ORGANIZATION");
    expect(mapLabelToCategory("LOC")).toBe("ADDRESS");
    expect(mapLabelToCategory("INS")).toBe("ADDRESS");
    expect(mapLabelToCategory("O")).toBeUndefined();
  });

  it("位置情報がない場合はサブワード表現を整形し、空候補とOラベルを除外する", () => {
    expect(
      mapNerOutputsToCandidates(
        [
          { entity_group: "LOC", word: "▁東京都", score: 0.81 },
          { entity_group: "PRD", word: "##契約書", score: 0.72 },
          { entity_group: "O", word: "山田" },
          { entity_group: "PER", word: "   " },
        ],
        "東京都の契約書です。",
      ),
    ).toEqual([
      {
        originalText: "東京都",
        category: "ADDRESS",
        source: "ner",
        confidence: 0.81,
      },
      {
        originalText: "契約書",
        category: "OTHER",
        source: "ner",
        confidence: 0.72,
      },
    ]);
  });

  it("短い候補とメール・URL・住所内の部分文字列候補を除外する", () => {
    expect(
      mapNerOutputsToCandidates(
        [
          { entity_group: "ORG", word: "社", score: 0.99 },
          { entity_group: "ORG", word: "ken", score: 0.95 },
          { entity_group: "ORG", word: "sato", score: 0.92 },
          { entity_group: "ORG", word: "Project Orion", score: 0.87 },
          { entity_group: "INS", word: "青葉ビル10階", score: 0.82 },
          { entity_group: "ORG", word: ".example.jp", score: 0.91 },
          {
            entity_group: "LOC",
            word: "愛知県豊田市若宮町二丁目15番",
            score: 0.9,
          },
          {
            entity_group: "LOC",
            word: "愛知県豊田市若宮町二丁目15番地",
            score: 0.89,
          },
        ],
        [
          "株式会社青葉の担当は sato.kenichi@example.com です。",
          "Project Orion は青葉ビル10階で扱います。",
          "参照先はhttps://dev.orion.example.jp/loginです。",
          "所在地は愛知県豊田市若宮町二丁目15番地です。",
        ].join(""),
      ),
    ).toEqual([
      {
        originalText: "Project Orion",
        category: "ORGANIZATION",
        source: "ner",
        confidence: 0.87,
      },
      {
        originalText: "青葉ビル10階",
        category: "ADDRESS",
        source: "ner",
        confidence: 0.82,
      },
      {
        originalText: "愛知県豊田市若宮町二丁目15番地",
        category: "ADDRESS",
        source: "ner",
        confidence: 0.89,
      },
    ]);
  });

  it("位置情報がなく、原文に完全一致しないNER候補は除外する", () => {
    expect(
      mapNerOutputsToCandidates(
        [
          {
            entity_group: "PER",
            word: "佐藤山田太郎山田花子鈴木一郎",
            score: 1,
          },
          {
            entity_group: "PER",
            word: "山田太郎",
            score: 0.9,
          },
        ],
        "佐藤さん、山田太郎さん、山田花子さん、鈴木一郎さん",
      ),
    ).toEqual([
      {
        originalText: "山田太郎",
        category: "PERSON",
        source: "ner",
        confidence: 0.9,
      },
    ]);
  });

  it("構造上のフルネームを優先し、姓の住所誤分類と複合語内の短い候補を除外する", () => {
    const sourceText = [
      "| 部署 | 氏名 |",
      "| --- | --- |",
      "| 開発部 | 鈴木一郎 |",
      "鈴木模型店を訪問した。",
      "品質保証部が確認した。",
    ].join("\n");
    const surnameStart = sourceText.indexOf("鈴木一郎");
    const modelStart = sourceText.indexOf("模型");
    const qualityStart = sourceText.indexOf("品質保証");

    expect(
      mapNerOutputsToCandidates(
        [
          {
            entity_group: "LOC",
            word: "鈴木",
            score: 0.74,
            start: surnameStart,
            end: surnameStart + 2,
          },
          {
            entity_group: "ORG",
            word: "模型",
            score: 0.56,
            start: modelStart,
            end: modelStart + 2,
          },
          {
            entity_group: "ORG",
            word: "品質保証",
            score: 0.43,
            start: qualityStart,
            end: qualityStart + 4,
          },
        ],
        sourceText,
      ),
    ).toEqual([
      {
        originalText: "品質保証",
        category: "ORGANIZATION",
        source: "ner",
        confidence: 0.43,
        start: qualityStart,
        end: qualityStart + 4,
      },
    ]);
  });

  it("一般姓のLOC候補は明示的な住所文脈にある場合だけ維持する", () => {
    const addressText = "所在地：鈴木";
    const addressStart = addressText.indexOf("鈴木");

    expect(
      mapNerOutputsToCandidates(
        [
          {
            entity_group: "LOC",
            word: "鈴木",
            score: 0.8,
            start: addressStart,
            end: addressStart + 2,
          },
        ],
        addressText,
      ),
    ).toEqual([
      {
        originalText: "鈴木",
        category: "ADDRESS",
        source: "ner",
        confidence: 0.8,
        start: addressStart,
        end: addressStart + 2,
      },
    ]);

    expect(
      mapNerOutputsToCandidates(
        [
          {
            entity_group: "LOC",
            word: "鈴木",
            score: 0.8,
            start: 0,
            end: 2,
          },
        ],
        "鈴木さんが参加した。",
      ),
    ).toEqual([]);
  });

  it("曖昧姓のPER候補は敬称・人名ラベルがある場合だけ維持する", () => {
    const generalText = "森の中を歩く。";
    expect(
      mapNerOutputsToCandidates(
        [
          {
            entity_group: "PER",
            word: "森",
            score: 0.91,
            start: 0,
            end: 1,
          },
        ],
        generalText,
      ),
    ).toEqual([]);

    const honorificText = "森さんが参加した。";
    expect(
      mapNerOutputsToCandidates(
        [
          {
            entity_group: "PER",
            word: "森さん",
            score: 0.91,
            start: 0,
            end: 3,
          },
        ],
        honorificText,
      ),
    ).toEqual([
      {
        originalText: "森さん",
        category: "PERSON",
        source: "ner",
        confidence: 0.91,
        start: 0,
        end: 3,
      },
    ]);

    const labelText = "担当者：森";
    const labelStart = labelText.indexOf("森");
    expect(
      mapNerOutputsToCandidates(
        [
          {
            entity_group: "PER",
            word: "森",
            score: 0.91,
            start: labelStart,
            end: labelStart + 1,
          },
        ],
        labelText,
      ),
    ).toEqual([
      {
        originalText: "森",
        category: "PERSON",
        source: "ner",
        confidence: 0.91,
        start: labelStart,
        end: labelStart + 1,
      },
    ]);
  });
});
