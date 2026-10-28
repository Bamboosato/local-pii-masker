import { describe, expect, it } from "vitest";
import { analyzeErrors } from "./errorAnalysis";
import { mergeCandidates } from "../../src/domain/detection/mergeCandidates";
import { parseAnnotatedText, type EvaluatedEntity } from "../../scripts/ner-evaluation/evaluation";
import { minimizationDocuments } from "./followupData";
import { minimizationPlan, minimizationBoundaryPlan, negativeInstructionPlan, QUALITY_VARIANTS } from "./priorityPlan";
import { evaluatePriorityDocument } from "./priorityEvaluation";
import { createDevelopmentV2Corpus } from "./corpusV2";
import type { PromptAdapter } from "../../src/domain/detection/prompt/adapter";

describe("誤分類・境界・最終マスク増幅の分離", () => {
  const document = { id: "synthetic", ...parseAnnotatedText("[[PERSON|砂凪あかり]]と[[ORGANIZATION|光庭研究所]]。一般文。一般文。") };
  const entries = (values: { text: string; category: EvaluatedEntity["category"] }[]) => {
    let i = 0;
    return mergeCandidates({ originalText: document.text, entries: [], candidates: values.map((e) => ({ originalText: e.text, category: e.category, source: "prompt-api" })), createId: () => `test-${++i}` });
  };
  it("正常抽出では文字列・位置・最終マスクをそれぞれ正解として数える", () => {
    const result = analyzeErrors(document, entries(document.entities), document.entities);
    expect(result.strings.correct).toBe(2); expect(result.positions.correct).toBe(2); expect(result.masks.correct).toBe(2);
    expect(result.goldMisses).toEqual({ category: 0, boundary: 0, boundaryAndCategory: 0, absent: 0 });
    expect(result.falseMaskRanges).toBe(0);
  });
  it("カテゴリだけの誤りは漏れ/誤マスク文字とは区別する", () => {
    const actual = [{ ...document.entities[0], category: "ADDRESS" as const }];
    const result = analyzeErrors(document, entries(actual), actual);
    expect(result.strings.category).toBe(1); expect(result.positions.category).toBe(1);
    expect(result.goldMisses.category).toBe(1); expect(result.goldMisses.absent).toBe(1);
    expect(result.falseMaskRanges).toBe(0);
  });
  it("境界とカテゴリの複合誤り、対象外の反復による増幅を分ける", () => {
    const actual: EvaluatedEntity[] = [
      { text: "砂凪", category: "PERSON", start: 0, end: 2 },
      { text: "光庭", category: "ADDRESS", start: document.entities[1].start, end: document.entities[1].start + 2 },
      { text: "一般文", category: "PERSON", start: document.text.indexOf("一般文"), end: document.text.indexOf("一般文") + 3 },
    ];
    const result = analyzeErrors(document, entries(actual), [...actual, actual[0]]);
    expect(result.strings.boundary).toBe(1); expect(result.strings.boundaryAndCategory).toBe(1); expect(result.strings.nonEntity).toBe(1);
    expect(result.positions.boundary).toBe(1); expect(result.masks.nonEntity).toBe(2);
    expect(result.falseMaskEntries).toBe(1); expect(result.falseMaskRanges).toBe(2); expect(result.maxFalseRangesPerEntry).toBe(2);
    expect(result.goldMisses).toEqual({ category: 0, boundary: 1, boundaryAndCategory: 1, absent: 0 });
    for (const a of actual) expect(JSON.stringify(result)).not.toContain(a.text);
    expect(JSON.stringify(result)).not.toContain('"start"');
  });
  it("文字列は合うが別位置だけを参照した場合を、正しい位置抽出と混同しない", () => {
    const d = { id: "synthetic", ...parseAnnotatedText("[[PERSON|砂凪]]。[[PERSON|砂凪]]。") };
    const registered = mergeCandidates({ originalText: d.text, entries: [], candidates: [{ originalText: "砂凪", category: "PERSON", source: "prompt-api" }], createId: () => "one" });
    const result = analyzeErrors(d, registered, [d.entities[0]]);
    expect(result.exactStringMissingEvidence).toBe(1); expect(result.masks.correct).toBe(2); expect(result.goldMisses.absent).toBe(1);
  });
  it("失敗後の分類は空の最終結果とし、部分成功を採用しない", async () => {
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ extract: async () => "invalid synthetic-secret", destroy() {} }) };
    const row = await evaluatePriorityDocument(QUALITY_VARIANTS[1], "development-v2-positive-1", new AbortController().signal, adapter);
    expect(row.complete).toBe(false); expect(row.errors.goldMisses.absent).toBe(3);
    expect(row.diagnostics.calls[0].complete).toBe(true);
    expect(JSON.stringify(row)).not.toContain("synthetic-secret");
  });
});

describe("指示だけの比較と最小再現候補の契約", () => {
  it("同じ10文書各3回で入力・制約を固定し、指示だけ変えて順序を回転する", () => {
    const plan = negativeInstructionPlan();
    expect(plan).toHaveLength(60);
    const ids = new Set(plan.map((x) => x.documentId)); expect(ids.size).toBe(10);
    for (const id of ids) for (const repeat of [1, 2, 3]) {
      const pair = plan.filter((x) => x.documentId === id && x.repeat === repeat);
      expect(pair).toHaveLength(2);
      const settings = pair.map((x) => { const { id: variantId, instruction, ...rest } = x.variant; return { variantId, instruction, rest }; });
      expect(settings[0].rest).toEqual(settings[1].rest);
      expect(settings.some((x) => x.instruction === "negative-v1")).toBe(true);
    }
    expect(plan[0].variant.id).not.toBe(plan[20].variant.id);
    const brief = negativeInstructionPlan(true);
    expect(brief).toHaveLength(60);
    expect(brief.map((x) => [x.documentId, x.repeat])).toEqual(plan.map((x) => [x.documentId, x.repeat]));
    expect(brief.filter((x) => x.variant.instruction === "negative-brief-v1")).toHaveLength(30);
  });
  it("切り分け候補は元文の連続部分で、削除後の正解と境界を保持する", () => {
    const docs = minimizationDocuments(); expect(docs).toHaveLength(7);
    const lengths = Object.fromEntries(docs.map((d) => [d.id, d.text.length]));
    expect(lengths["development-v2-min-tail"]).toBe(232); expect(lengths["development-v2-min-body"]).toBe(51);
    expect(lengths["development-v2-min-prefix"]).toBe(181);
    expect(lengths["development-v2-min-shorter-tail"]).toBe(187);
    for (const d of docs) for (const e of d.entities) expect(d.text.slice(e.start, e.end)).toBe(e.text);
    expect(minimizationPlan()).toHaveLength(12); expect(minimizationPlan(true)).toHaveLength(9);
    expect(createDevelopmentV2Corpus()).toHaveLength(100);
  });
  it("追加切り分けでは232文字の制約だけを変え、187文字の短縮と混同しない", () => {
    const plan = minimizationBoundaryPlan(); expect(plan).toHaveLength(9);
    for (const repeat of [1, 2, 3]) {
      const pair = plan.filter((x) => x.repeat === repeat && x.documentId === "development-v2-min-tail");
      expect(pair).toHaveLength(2);
      expect(pair.map((x) => x.variant.constraint).sort()).toEqual(["quote-enum", "schema"]);
      const conditions = pair.map((x) => { const { id, constraint, ...rest } = x.variant; return { id, constraint, rest }; });
      expect(conditions[0].rest).toEqual(conditions[1].rest);
    }
  });
});
