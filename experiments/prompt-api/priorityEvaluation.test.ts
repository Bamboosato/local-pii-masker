import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPriorityAvailability, evaluatePriorityDocument } from "./priorityEvaluation";
import { DIAGNOSTIC_VARIANTS, priorityDocuments, priorityPlan, QUALITY_VARIANTS, reproductionPlan, reproductionSchemaPlan } from "./priorityPlan";
import { createLongCorpus } from "./corpus";
import { createDevelopmentV2Corpus } from "./corpusV2";
import { browserPromptAdapter, type PromptAdapter } from "../../src/domain/detection/prompt/adapter";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("優先度0〜2の評価契約", () => {
  it("利用可能確認が返れば期限タイマーを解放する", async () => {
    vi.useFakeTimers(); vi.spyOn(browserPromptAdapter, "availability").mockResolvedValue("available");
    expect(await checkPriorityAvailability()).toBe("available");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("可用性照会が応答しなければ固定期限で止め、推論準備へ進めない", async () => {
    vi.useFakeTimers(); vi.spyOn(browserPromptAdapter, "availability").mockImplementation(() => new Promise(() => undefined));
    const result = checkPriorityAvailability(25);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toBe("availability-timeout");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("準備照会の例外本文は返さず利用不可へ分類する", async () => {
    vi.spyOn(browserPromptAdapter, "availability").mockRejectedValue(new Error("synthetic-private-error"));
    expect(await checkPriorityAvailability()).toBe("unavailable");
  });
  it("後続の再現確認は過去の入力を変更せず、主比較へ混ぜない", () => {
    const legacy = priorityDocuments().find((d) => d.family === "legacy-reproduction")!;
    const source = createLongCorpus("development")[0];
    expect(legacy.text).toBe(source.text);
    expect(legacy.entities).toEqual(source.entities);
    expect(reproductionPlan()).toHaveLength(6);
    expect(reproductionPlan().every((item) => item.variant.chunkLength === 512 && item.variant.overlap === 128 && item.variant.reuseIdenticalChunks)).toBe(true);
    expect(priorityPlan().some((item) => item.phase === "reproduction")).toBe(false);
    const schemaPlan = reproductionSchemaPlan();
    expect(schemaPlan).toHaveLength(9);
    expect(schemaPlan.every((item) => item.variant.sessionMode === "clone" && item.variant.chunkLength === 512 && item.variant.overlap === 128 && item.variant.omitSchemaInput)).toBe(true);
    expect(schemaPlan.filter((item) => item.variant.format === "source-id-v2")).toHaveLength(3);
  });
  it("6 API条件/2品質方式の固定入力を各3回、順序を回転して再現する", () => {
    const plan = priorityPlan();
    expect(plan).toHaveLength(102);
    expect(JSON.stringify(priorityPlan())).toBe(JSON.stringify(plan));
    const counts = new Map<string, number>();
    for (const item of plan) {
      const key = `${item.phase}/${item.documentId}/${item.variant.id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      expect(item.documentId).toMatch(/^development-v2-/u);
    }
    expect([...counts.values()].every((count) => count === 3)).toBe(true);
    expect(new Set(DIAGNOSTIC_VARIANTS.map((v) => `${v.constraint}/${v.sessionMode}`)).size).toBe(6);
    const first = (repeat: number) => plan.find((row) => row.phase === "quality" && row.repeat === repeat)!.variant.id;
    expect(first(1)).not.toBe(first(2));
  });
  it("API完了とJSON構造失敗を区別し、失敗も全正解の漏れとして計上する", async () => {
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ extract: async () => "not-json synthetic-private-response", destroy() { /* no browser resources */ } }) };
    const row = await evaluatePriorityDocument(DIAGNOSTIC_VARIANTS[1], "development-v2-positive-1", new AbortController().signal, adapter);
    expect(row.transportComplete).toBe(true);
    expect(row.structureComplete).toBe(false);
    expect(row.complete).toBe(false);
    expect(row.failureStage).toBe("validation");
    expect(row.score.missing).toBe(3);
    expect(row.documentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(row.settingsHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(row)).not.toContain("synthetic-private-response");
  });
  it("sourceIdの正常応答を同じ最終マスク指標で測り、原文/候補値をログへ含めない", async () => {
    const document = createDevelopmentV2Corpus()[0];
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ extract: async () => JSON.stringify({ entities: document.entities.map((e) => ({ text: e.text, category: e.category, sourceId: 0 })) }), destroy() { /* no browser resources */ } }) };
    const row = await evaluatePriorityDocument(QUALITY_VARIANTS[1], document.id, new AbortController().signal, adapter);
    expect(row.complete).toBe(true);
    expect(row.transportComplete).toBe(true);
    expect(row.structureComplete).toBe(true);
    expect(row.score.missing).toBe(0);
    expect(row.score.falseMaskRanges).toBe(0);
    for (const e of document.entities) expect(JSON.stringify(row)).not.toContain(e.text);
    expect(JSON.stringify(row)).not.toContain(document.text);
    expect(row.settings.languages).toEqual({ inputs: ["ja"], outputs: ["ja"] });
  });
});
