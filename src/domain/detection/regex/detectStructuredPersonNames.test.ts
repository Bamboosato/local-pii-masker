import { describe, expect, it } from "vitest";
import { detectStructuredPersonNames } from "./detectStructuredPersonNames";

describe("detectStructuredPersonNames", () => {
  it("ラベル・Markdown表・JSON・CSVの人名フィールドから日本語と英字の姓名を抽出する", () => {
    const sourceText = [
      "司会：山田太郎",
      "Name: Taro Yamada",
      "",
      "| 部署 | Name |",
      "| --- | --- |",
      "| 営業部 | Hanako Yamada |",
      "",
      "```text",
      "Owner: JOHN SMITH",
      "```",
      "",
      "```json",
      '{"manager":"佐藤健一","designer":"Yumi Takahashi"}',
      "```",
      "",
      "```csv",
      '"部署","full_name","備考"',
      '"開発,第一","Jane Doe","UI"',
      "```",
    ].join("\n");

    const candidates = detectStructuredPersonNames(sourceText);

    expect([...new Set(candidates.map((candidate) => candidate.originalText))]).toEqual([
      "山田太郎",
      "Taro Yamada",
      "JOHN SMITH",
      "Hanako Yamada",
      "佐藤健一",
      "Yumi Takahashi",
      "Jane Doe",
    ]);
    expect(
      candidates.every(
        (candidate) =>
          candidate.start !== undefined &&
          candidate.end !== undefined &&
          sourceText.slice(candidate.start, candidate.end) === candidate.originalText,
      ),
    ).toBe(true);
  });

  it("不正JSON・氏名列のない表・人名ではない類似語を候補にしない", () => {
    const sourceText = [
      "| 部署 | 製品 |",
      "| --- | --- |",
      "| 開発部 | 山田製作所 |",
      "",
      "```json",
      '{"manager":"山田太郎",',
      "```",
      "",
      "```csv",
      "部署,役割",
      "佐藤医院,顧客",
      "```",
      "",
      "高橋駅",
      "鈴木模型店",
    ].join("\n");

    expect(detectStructuredPersonNames(sourceText)).toEqual([]);
  });

  it("構造や人名ラベルのない英単語2語は候補にしない", () => {
    const sourceText = [
      "Taro Yamada",
      "Project Orion",
      "Local Masker",
    ].join("\n");

    expect(detectStructuredPersonNames(sourceText)).toEqual([]);
  });
});
