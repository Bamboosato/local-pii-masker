import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVALUATED_CATEGORIES,
  parseCorpus,
  type EvaluatedCategory,
} from "./evaluation";

const selectionCorpusPath = resolve("evaluation/ner/corpus.json");
const holdoutCorpusPath = resolve("evaluation/ner/corpus-holdout.json");

describe("NER選定・最終確認コーパス", () => {
  it.each([
    ["選定用", selectionCorpusPath],
    ["最終確認用", holdoutCorpusPath],
  ])("%sコーパスは100文書かつ各カテゴリ50対象以上を含む", (_, path) => {
    const corpus = loadCorpus(path);
    const occurrences = Object.fromEntries(
      EVALUATED_CATEGORIES.map((category) => [category, 0]),
    ) as Record<EvaluatedCategory, number>;
    const uniqueTargets = Object.fromEntries(
      EVALUATED_CATEGORIES.map((category) => [category, new Set<string>()]),
    ) as Record<EvaluatedCategory, Set<string>>;

    for (const document of corpus) {
      for (const entity of document.entities) {
        occurrences[entity.category] += 1;
        uniqueTargets[entity.category].add(entity.text);
      }
    }

    expect(corpus).toHaveLength(100);
    expect(occurrences).toEqual({
      PERSON: expect.any(Number),
      ORGANIZATION: expect.any(Number),
      ADDRESS: expect.any(Number),
    });
    for (const category of EVALUATED_CATEGORIES) {
      expect(occurrences[category], category).toBeGreaterThanOrEqual(50);
      expect(uniqueTargets[category].size, category).toBeGreaterThanOrEqual(50);
    }
  });

  it("合計200文書でIDと正解対象が選定用・最終確認用に分離されている", () => {
    const selectionCorpus = loadCorpus(selectionCorpusPath);
    const holdoutCorpus = loadCorpus(holdoutCorpusPath);
    const selectionIds = new Set(selectionCorpus.map((document) => document.id));
    const selectionTargets = new Set(
      selectionCorpus.flatMap((document) =>
        document.entities.map((entity) => `${entity.category}:${entity.text}`),
      ),
    );
    const overlappingIds = holdoutCorpus.filter((document) =>
      selectionIds.has(document.id),
    );
    const overlappingTargets = holdoutCorpus.flatMap((document) =>
      document.entities.filter((entity) =>
        selectionTargets.has(`${entity.category}:${entity.text}`),
      ),
    );

    expect(selectionCorpus.length + holdoutCorpus.length).toBe(200);
    expect(overlappingIds).toEqual([]);
    expect(overlappingTargets).toEqual([]);
  });

  it.each([
    ["選定用", selectionCorpusPath],
    ["最終確認用", holdoutCorpusPath],
  ])("%sコーパスは空文書を含まず、注釈なしの否定例を持つ", (_, path) => {
    const corpus = loadCorpus(path);

    expect(corpus.every((document) => document.text.trim().length > 0)).toBe(true);
    expect(
      corpus.filter((document) => document.entities.length === 0).length,
    ).toBeGreaterThan(0);
  });
});

function loadCorpus(path: string) {
  return parseCorpus(JSON.parse(readFileSync(path, "utf8")) as unknown);
}
