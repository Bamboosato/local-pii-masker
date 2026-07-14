import { describe, expect, it } from "vitest";
import { enrichPersonCandidates } from "../enrichPersonCandidates";
import { mergeCandidates } from "../mergeCandidates";
import { maskText } from "../../mask/maskText";
import { runRegexDetection } from "./runRegexDetection";
import {
  EXPECTED_COMPACT_JAPANESE_NAMES,
  EXPECTED_JAPANESE_SURNAMES,
  EXPECTED_SPACED_JAPANESE_NAMES,
  NON_PERSON_LOOKALIKES,
  PERSON_NAME_RICH_MARKDOWN,
} from "./personNameRichMarkdown.fixture";

describe("名前多めMarkdown回帰", () => {
  it("基本姓名と空白入り姓名を検出し、検出済み姓名を根拠に姓を補完する", () => {
    const enriched = enrichPersonCandidates(
      PERSON_NAME_RICH_MARKDOWN,
      runRegexDetection(PERSON_NAME_RICH_MARKDOWN),
    );
    const personTexts = new Set(
      enriched
        .filter((candidate) => candidate.category === "PERSON")
        .map((candidate) => candidate.originalText),
    );

    for (const name of [
      ...EXPECTED_COMPACT_JAPANESE_NAMES,
      ...EXPECTED_SPACED_JAPANESE_NAMES,
      "Kenta Takahashi",
    ]) {
      expect(personTexts, `${name}を人名候補として検出する`).toContain(name);
    }

    for (const value of NON_PERSON_LOOKALIKES) {
      expect(personTexts, `${value}を人名候補にしない`).not.toContain(value);
    }

    for (const surname of EXPECTED_JAPANESE_SURNAMES) {
      expect(personTexts, `${surname}を姓候補として補完する`).toContain(surname);
    }

    for (const standaloneEnglishName of ["Taro Yamada", "Hanako Yamada"]) {
      expect(
        personTexts,
        `${standaloneEnglishName}は文脈のない単独表記なので候補にしない`,
      ).not.toContain(standaloneEnglishName);
    }
  });

  it("姓候補を初期有効にし、非人名複合語内を含む同一文字列をすべてマスクする", () => {
    const enriched = enrichPersonCandidates(
      PERSON_NAME_RICH_MARKDOWN,
      runRegexDetection(PERSON_NAME_RICH_MARKDOWN),
    );
    let nextId = 0;
    const entries = mergeCandidates({
      originalText: PERSON_NAME_RICH_MARKDOWN,
      entries: [],
      candidates: enriched,
      createId: () => `entry-${++nextId}`,
    });
    const maskedText = maskText(PERSON_NAME_RICH_MARKDOWN, entries);

    for (const surname of EXPECTED_JAPANESE_SURNAMES) {
      const entry = entries.find((item) => item.originalText === surname);

      expect(entry, `${surname}候補を作成する`).toMatchObject({
        category: "PERSON",
        enabled: true,
        reviewStatus: "approved",
      });

      for (const lookalike of NON_PERSON_LOOKALIKES.filter((value) =>
        value.startsWith(surname),
      )) {
        expect(
          maskedText,
          `${lookalike}内の${surname}も同じトークンでマスクする`,
        ).toContain(`${entry?.token}${lookalike.slice(surname.length)}`);
      }
    }
  });
});
