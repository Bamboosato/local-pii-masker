import { describe, expect, it } from "vitest";
import { createDevelopmentLongControls, createLongCorpus, createPromptCorpus } from "./corpus";
import { scoreFinalMask, scoreSets } from "./evaluate";
import { mergeCandidates } from "../../src/domain/detection/mergeCandidates";
describe("追加AI評価の正解と指標", () => {
  it("調整と最終の対象値を分離し、各100文書・各カテゴリ50出現を満たす", () => {
    const development = createPromptCorpus("development"), final = createPromptCorpus("final");
    const known = new Set(development.flatMap((doc) => doc.entities.map((e) => e.text)));
    for (const docs of [development, final]) {
      expect(docs).toHaveLength(100);
      expect(new Set(docs.map((d) => d.id)).size).toBe(100);
      for (const category of ["PERSON", "ADDRESS", "ORGANIZATION"]) expect(docs.flatMap((d) => d.entities).filter((e) => e.category === category).length).toBeGreaterThanOrEqual(50);
      expect(docs.filter((d) => !d.entities.length)).toHaveLength(30);
      for (const doc of docs) for (const e of doc.entities) expect(doc.text.slice(e.start,e.end)).toBe(e.text);
    }
    expect(final.flatMap((d) => d.entities).some((e) => known.has(e.text))).toBe(false);
    expect(createLongCorpus().map((d) => d.text.length)).toEqual([1000,10000,30000]);
    const tuningLong = createLongCorpus("development");
    expect(tuningLong.map((d) => d.text.length)).toEqual([1000,10000,30000]);
    expect(tuningLong.every((d) => d.id.startsWith("development-"))).toBe(true);
    expect(tuningLong.flatMap((d) => d.entities).every((e) => known.has(e.text))).toBe(true);
    const controls = createDevelopmentLongControls();
    expect(controls.map((d) => d.text.length)).toEqual([1000, 10000, 30000]);
    for (const doc of controls) {
      expect(doc.id).toMatch(/^development-varied-/u);
      for (const e of doc.entities) expect(doc.text.slice(e.start, e.end)).toBe(e.text);
    }
  });
  it("重複文字列を位置単位と文字列単位で区別する", () => {
    expect(scoreSets(["PERSON,森", "PERSON,森"], ["PERSON,森"])).toEqual({ tp: 1, fp: 0, fn: 0 });
    expect(scoreSets(["PERSON,0,1", "PERSON,2,3"], ["PERSON,0,1"])).toEqual({ tp: 1, fp: 0, fn: 1 });
  });
  it("最終置換範囲から部分漏れと一括置換による誤マスクを計測する", () => {
    const document = { id: "synthetic", text: "森太郎と森林", entities: [{ text: "森太郎", category: "PERSON" as const, start: 0, end: 3 }] };
    const entries = mergeCandidates({ originalText: document.text, entries: [], candidates: [{ originalText: "森", category: "PERSON", source: "manual" }], createId: () => "one" });
    const score = scoreFinalMask(document, entries, [{ text: "森", category: "PERSON", start: 0, end: 1 }]);
    expect(score.missing).toBe(1);
    expect(score.falseMaskRanges).toBe(1);
    expect(score.positions).toEqual({ tp: 0, fp: 1, fn: 1 });
  });
});
