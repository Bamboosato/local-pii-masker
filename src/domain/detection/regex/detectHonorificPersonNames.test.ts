import { describe, expect, it } from "vitest";
import { detectHonorificPersonNames } from "./detectHonorificPersonNames";

describe("detectHonorificPersonNames", () => {
  it("一般的な姓名と敬称・役職を一つの候補として検出する", () => {
    const sourceText =
      "山田太郎さん、佐藤花子 様、鈴木部長代理、山田先生に連絡する。";
    const candidates = detectHonorificPersonNames(sourceText);

    expect(candidates.map((candidate) => candidate.originalText)).toEqual([
      "山田太郎さん",
      "佐藤花子 様",
      "鈴木部長代理",
      "山田先生",
    ]);
    expect(
      candidates.every(
        (candidate) =>
          candidate.start !== undefined &&
          candidate.end !== undefined &&
          sourceText.slice(candidate.start, candidate.end) ===
            candidate.originalText,
      ),
    ).toBe(true);
  });

  it("敬称だけ、一般語の一部、境界のない後続文字列は候補にしない", () => {
    const sourceText = "さん、山田線、山田太郎さん太郎、通常の文章です。";

    expect(detectHonorificPersonNames(sourceText)).toEqual([]);
  });

  it("仕様を敬称付き人名として誤検出しない", () => {
    const sourceText = "仕様、既存仕様、検出仕様。鬼頭さんは対象にする。";

    expect(
      detectHonorificPersonNames(sourceText).map(
        (candidate) => candidate.originalText,
      ),
    ).toEqual(["鬼頭さん"]);
  });
});
