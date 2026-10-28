import { describe, expect, it } from "vitest";
import { referenceScreeningPlan, referenceScreeningGate, referenceInputChanged, REFERENCE_VARIANTS, type ScreeningRow } from "./referenceScreening";
import { serializeSources, sourceIdSchema, validateSourceIdResponse, sourceReferences } from "./sourceId";
import { priorityDocuments } from "./priorityPlan";
import { splitPromptText } from "../../src/domain/detection/prompt/chunks";
import { evaluatePriorityDocument } from "./priorityEvaluation";
import { runAdditionalDetection } from "../../src/domain/detection/prompt/run";
import type { PromptAdapter } from "../../src/domain/detection/prompt/adapter";

describe("参照の重複削減と分割の境界", () => {
  it("単一参照で改行・JSON特殊文字を失わず、ID0だけを許し全文位置へ戻す", () => {
    const text = '😀前置き。\n砂凪\nあかり。"引用"\\末尾';
    expect(sourceReferences(text, "whole-only")).toEqual([{ id: 0, text, start: 0 }]);
    expect(JSON.parse(serializeSources(text, "whole-only"))).toEqual({ sources: [{ id: 0, text }] });
    expect(sourceIdSchema(text, "whole-only")).toMatchObject({ properties: { entities: { items: { properties: { sourceId: { enum: [0] } } } } } });
    const raw = JSON.stringify({ entities: [{ text: "砂凪\nあかり", category: "PERSON", sourceId: 0 }] });
    const result = validateSourceIdResponse(raw, { text, start: 100 }, "whole-only");
    const r = result.candidates[0].ranges[0];
    expect(text.slice(r.start - 100, r.end - 100)).toBe("砂凪\nあかり");
    expect(() => validateSourceIdResponse(raw.replace('"sourceId":0', '"sourceId":1'), { text, start: 0 }, "whole-only")).toThrow();
    expect(serializeSources(text, "whole-only").length).toBeLessThan(serializeSources(text).length);
  });
  it("短文で入力・制約が同一になる文書は別集計し、3条件を78件に限定する", () => {
    const plan = referenceScreeningPlan();
    expect(plan).toHaveLength(78); expect(plan.filter((p) => p.phase === "reference-short")).toHaveLength(60);
    expect(plan.filter((p) => p.phase === "reference-long")).toHaveLength(18);
    expect(referenceInputChanged("development-v2-positive-1")).toBe(false);
    expect(referenceInputChanged("development-v2-negative-1")).toBe(false);
    expect(referenceInputChanged("development-v2-negative-2")).toBe(true);
    for (const p of plan) {
      expect(p.variant.instruction).toBeUndefined(); expect(p.variant.constraint).toBe("schema");
      expect(p.variant.reuseIdenticalChunks).toBeUndefined();
    }
    const first = (r: number) => plan.find((p) => p.phase === "reference-long" && p.repeat === r)!.variant.id;
    expect(first(1)).not.toBe(first(2));
    for (const d of priorityDocuments().filter((d) => plan.some((p) => p.phase === "reference-short" && p.documentId === d.id))) expect(d.text.length).toBeLessThan(512);
  });
  it("512文字分割の重複境界と後半を単一参照で戻し、再利用なしで集約する", async () => {
    const text = "一般文。".repeat(99) + "砂凪あかりさん。" + "一般文。".repeat(100) + "波峰カナメさん。";
    const chunks = splitPromptText(text, 512, 128);
    expect(chunks.filter((c) => c.text.includes("砂凪あかり")).length).toBeGreaterThan(1);
    let calls = 0, destroyed = 0;
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ extract: async (chunk) => {
      calls++; return JSON.stringify({ entities: ["砂凪あかり", "波峰カナメ"].filter((name) => chunk.includes(name)).map((name) => ({ text: name, category: "PERSON", sourceId: 0 })) });
    }, destroy() { destroyed++; } }) };
    const result = await runAdditionalDetection(text, { signal: new AbortController().signal, adapter, chunkLength: 512, overlap: 128, validateResponse: (raw, chunk) => validateSourceIdResponse(raw, chunk, "whole-only") });
    expect(calls).toBe(chunks.length); expect(destroyed).toBe(1);
    expect(result.candidates).toHaveLength(2);
    for (const c of result.candidates) { expect(c.ranges).toHaveLength(1); expect(text.slice(c.ranges[0].start, c.ranges[0].end)).toBe(c.text); }
  });
  it("評価行も単一参照の検証規則を使い、提供していないIDなら全体失敗にする", async () => {
    const doc = priorityDocuments().find((d) => d.id === "development-v2-positive-3")!;
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ extract: async () => JSON.stringify({ entities: [{ text: doc.entities[0].text, category: doc.entities[0].category, sourceId: 1 }] }), destroy() {} }) };
    const row = await evaluatePriorityDocument(REFERENCE_VARIANTS[1], doc.id, new AbortController().signal, adapter);
    expect(row.complete).toBe(false); expect(row.failureStage).toBe("validation"); expect(row.score.missing).toBe(3);
    expect(row.diagnostics.serializedInputCharacters).toBe(serializeSources(doc.text, "whole-only").length);
    expect(JSON.stringify(row)).not.toContain(doc.entities[0].text);
  });
});

describe("NERとの組合せに進む判定", () => {
  function fixture(identityOnly = false): ScreeningRow[] {
    return referenceScreeningPlan().map((p) => {
      const negative = p.documentId.includes("negative");
      const target = identityOnly ? "development-v2-negative-1" : "development-v2-negative-2";
      const fp = p.documentId === target ? p.variant.id === "reference-control" ? 2 : 1 : 0;
      return { documentId: p.documentId, repeat: p.repeat, settings: { variant: { id: p.variant.id } }, complete: true, score: { missing: 0, falseMaskRanges: fp, strings: { tp: negative ? 0 : 3, fp, fn: 0 }, positions: { tp: negative ? 0 : 3, fp, fn: 0 } } };
    });
  }
  it("変更された入力で実質改善し、長文に退行がない条件だけを許す", () => {
    expect(referenceScreeningGate(fixture()).eligible).toEqual(["reference-whole", "reference-whole-512"]);
  });
  it("欠損・重複・同一入力だけの揺れを改善として扱わない", () => {
    const rows = fixture();
    expect(referenceScreeningGate(rows.slice(1)).eligible).toEqual([]);
    expect(referenceScreeningGate([...rows.slice(1), rows[1]]).eligible).toEqual([]);
    expect(referenceScreeningGate(fixture(true)).reasons).toContain("no-material-changed-input-gain");
  });
  it("誤マスク減少だけで漏れ・カテゴリ位置精度の退行を隠せない", () => {
    const rows = fixture(); const row = rows.find((r) => r.settings.variant.id === "reference-whole" && r.documentId === "development-v2-positive-1")!;
    row.score.missing = 1; row.score.positions.fn = 1;
    expect(referenceScreeningGate(rows).eligible).toEqual([]);
    expect(referenceScreeningGate(rows).reasons).toContain("short-regression");
  });
  it("長文の1回失敗を除外せず、他条件の判定からは分ける", () => {
    const rows = fixture(); const row = rows.find((r) => r.settings.variant.id === "reference-whole-512")!;
    row.complete = false; row.score.missing = 3; row.score.strings.tp = 0; row.score.strings.fn = 3;
    expect(referenceScreeningGate(rows).eligible).toEqual(["reference-whole"]);
    expect(referenceScreeningGate(rows).reasons).toContain("reference-whole-512:long-incomplete");
  });
});
