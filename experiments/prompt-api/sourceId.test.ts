import { describe, expect, it } from "vitest";
import { serializeSources, sourceIdSchema, sourceReferences, validateSourceIdResponse } from "./sourceId";
import { createDevelopmentV2Corpus, createDevelopmentV2Long } from "./corpusV2";
import { createPromptCorpus } from "./corpus";
import { runAdditionalDetection } from "../../src/domain/detection/prompt/run";
import type { PromptAdapter } from "../../src/domain/detection/prompt/adapter";

const raw = (entities: unknown[]) => JSON.stringify({ entities });
describe("sourceId-v2の原文と構造境界", () => {
  it("別参照にはある対象と、原文のどこにもない対象を値を保存せず区別する", () => {
    const text = "砂凪さん。波峰さん。";
    const id = sourceReferences(text).find((s) => s.text === "波峰さん。")!.id;
    const result = validateSourceIdResponse(raw([{ text: "砂凪", category: "PERSON", sourceId: id }, { text: "浜郷", category: "PERSON", sourceId: id }]), { text, start: 0 });
    expect(result.candidates).toEqual([]);
    expect(result.referenceErrors).toEqual({ wrongReference: 1, textAbsent: 1 });
    expect(JSON.stringify(result.referenceErrors)).not.toContain("砂凪");
  });
  it("参照した同一引用の位置だけを戻し、別IDの同じ引用を証拠として追加しない", () => {
    const text = "😀森さん。森さん。森さん。";
    const sources = sourceReferences(text);
    const id = sources.find((s) => s.start === 6)!.id;
    const result = validateSourceIdResponse(raw([{ text: "森", category: "PERSON", sourceId: id }]), { text, start: 20 });
    expect(result.candidates[0].ranges.map((r) => r.start)).toEqual([26]);
    expect(result.candidates[0].evidence).toBe("森さん。");
    expect(validateSourceIdResponse(raw([{ text: "😀森", category: "PERSON", sourceId: id }]), { text, start: 0 }).rejected).toEqual(["text_missing"]);
  });
  it("全体IDで改行をまたぐ対象を表し、引用中の複数一致をUTF-16位置へ戻す", () => {
    const text = '😀引用"\\\n砂凪\nあかりと砂凪\nあかり';
    const result = validateSourceIdResponse(raw([{ text: "砂凪\nあかり", category: "PERSON", sourceId: 0 }]), { text, start: 7 });
    expect(result.candidates[0].ranges).toHaveLength(2);
    for (const r of result.candidates[0].ranges) expect(text.slice(r.start - 7, r.end - 7)).toBe("砂凪\nあかり");
    const sources = JSON.parse(serializeSources(text)) as { sources: { id: number; text: string }[] };
    expect(sources.sources[0].text).toBe(text);
    expect(sourceIdSchema(text)).toMatchObject({ additionalProperties: false });
    expect(sourceReferences("文。".repeat(100))).toHaveLength(64);
    expect(sourceReferences("文。".repeat(100))[0].text).toHaveLength(200);
  });
  it.each([-1, 99, 1.2, "0", null].map((sourceId) => ({ sourceId })))("不正IDは全体失敗とし、型補正しない: $sourceId", ({ sourceId }) => {
    expect(() => validateSourceIdResponse(raw([{ text: "森", category: "PERSON", sourceId }]), { text: "森さん。", start: 0 })).toThrow("完了していません");
  });
  it.each(["no-json", raw([{ text: "森", category: "PERSON" }]), raw([{ text: "森", category: "PERSON", sourceId: 0, evidence: "森" }]), raw([{ text: "森", category: "OTHER", sourceId: 0 }]), raw([{ text: " ", category: "PERSON", sourceId: 0 }]), raw(Array.from({ length: 129 }, () => ({ text: "森", category: "PERSON", sourceId: 0 })))])("構造・上限違反を成功0件にしない", (value) => {
    expect(() => validateSourceIdResponse(value, { text: "森さん。", start: 0 })).toThrow();
  });
  it("後半の不正参照で前半の正しい候補も全破棄し、セッションを解放する", async () => {
    let n = 0, destroyed = false;
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ extract: async () => raw([{ text: "森", category: "PERSON", sourceId: ++n === 1 ? 0 : 99 }]), destroy: () => { destroyed = true; } }) };
    await expect(runAdditionalDetection("森さん。森さん。", { adapter, signal: new AbortController().signal, chunkLength: 4, overlap: 0, validateResponse: validateSourceIdResponse })).rejects.toThrow();
    expect(destroyed).toBe(true);
  });
});

describe("development-v2の偏りと分離", () => {
  it("各ラベル内で記録番号を対にし、通常組織と人名入り組織を分離する", () => {
    const historical = JSON.stringify(createPromptCorpus("development")), heldOut = JSON.stringify(createPromptCorpus("final"));
    const docs = createDevelopmentV2Corpus();
    expect(docs).toHaveLength(100);
    for (const group of [docs.filter((d) => d.entities.length), docs.filter((d) => !d.entities.length)]) {
      expect(group.filter((d) => d.marker)).toHaveLength(group.length / 2);
      for (let i = 0; i < group.length; i += 2) {
        expect(group[i + 1].text).toBe(group[i].text + " 合成記録番号7。");
        expect(group[i + 1].entities).toEqual(group[i].entities);
      }
    }
    for (const doc of docs) {
      for (const e of doc.entities) expect(doc.text.slice(e.start, e.end)).toBe(e.text);
      if (!doc.entities.length) continue;
      const person = doc.entities.find((e) => e.category === "PERSON")!.text;
      const organization = doc.entities.find((e) => e.category === "ORGANIZATION")!.text;
      expect(organization.includes(person)).toBe(doc.family === "nested-organization");
    }
    expect(JSON.stringify(createPromptCorpus("development"))).toBe(historical);
    expect(JSON.stringify(createPromptCorpus("final"))).toBe(heldOut);
    const finalValues = new Set(createPromptCorpus("final").flatMap((d) => d.entities.map((e) => e.text)));
    expect(docs.flatMap((d) => d.entities).some((e) => finalValues.has(e.text))).toBe(false);
    for (const kind of ["repeated", "varied"] as const) for (const length of [1000, 10000, 30000]) {
      const doc = createDevelopmentV2Long(kind, length);
      expect(doc.text).toHaveLength(length);
      for (const e of doc.entities) expect(doc.text.slice(e.start, e.end)).toBe(e.text);
    }
  });
});
