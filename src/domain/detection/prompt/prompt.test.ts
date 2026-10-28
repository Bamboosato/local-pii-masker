import { describe, expect, it, vi } from "vitest";
import { splitPromptText, trimPromptChunks } from "./chunks";
import { PROMPT_CONFIG } from "./config";
import { classifyAdditionalCandidates, validateAdditionalResponse, type AdditionalCandidate } from "./validation";
import { runAdditionalDetection } from "./run";
import { browserPromptAdapter, type PromptAdapter } from "./adapter";
import { appReducer, initialAppState, type AppState } from "../../../app/reducer";
import { selectMaskedText, selectRestoredResponse } from "../../../app/selectors";
import { createMaskMappingFingerprint, createMaskMappingSnapshot } from "../../mapping/snapshot";
import { parseMaskMapping } from "../../mapping/validate";
import { encryptMaskMapping, decryptMaskMapping } from "../../mapping/crypto";

const entity = { text: "森", category: "PERSON", evidence: "森さん" };
const raw = (entities: unknown[]) => JSON.stringify({ entities });
const candidate: AdditionalCandidate = { ...entity, category: "PERSON", ranges: [{ start: 0, end: 1, evidenceStart: 0, evidenceEnd: 3 }] };
function ready(text = "森さんと森の中。森さん") {
  return appReducer({ ...initialAppState, originalText: text }, { type: "completeDetection", candidates: [], createId: () => "unused", outcome: "success" });
}
function apply(state: AppState, candidates: AdditionalCandidate[] = [candidate]) {
  let n = state.entries.length;
  return appReducer(state, { type: "applyAdditionalCandidates", candidates, expectedRevision: state.originalRevision, expectedContextVersion: state.additionalContextVersion, createId: () => `prompt-${++n}` });
}

describe("追加AI: データと構造の境界", () => {
  it("根拠内の一致だけを原文UTF-16位置へ戻す", () => {
    const result = validateAdditionalResponse(raw([entity]), { text: "😀森さんと森の中。森さん", start: 20 });
    expect(result.candidates[0].ranges.map((r) => r.start)).toEqual([22, 30]);
    expect(result.rejected).toEqual([]);
  });
  it.each(["no-json", "[]", '{"entities":[],"extra":0}', raw([{ ...entity, category: "PHONE" }]), raw([{ ...entity, category: ["PERSON"] }]), raw([{ ...entity, extra: 1 }]), raw([{ text: "森", category: "PERSON" }]), raw([{ ...entity, text: " " }]), raw([{ ...entity, evidence: "" }]), raw(Array.from({ length: 129 }, () => entity)), " ".repeat(PROMPT_CONFIG.maxResponseLength + 1)].map((value, id) => ({ value, id })))("構造違反は一部成功にしない: $id", ({ value }) => {
    expect(() => validateAdditionalResponse(value, { text: "森さん", start: 0 })).toThrow("完了していません");
  });
  it("幻覚と根拠不一致は理由別に棄却し、正しい候補を保持する", () => {
    const result = validateAdditionalResponse(raw([entity, { ...entity, text: "架空" }, { ...entity, evidence: "存在しない根拠" }, { ...entity, evidence: "さん" }]), { text: "森さん", start: 0 });
    expect(result.candidates).toHaveLength(1);
    expect(result.rejected).toEqual(["text_missing", "evidence_missing", "evidence_mismatch"]);
  });
  it("重なる同一根拠が多数あっても対象位置を一度だけ数え、原文位置へ戻す", () => {
    const result = validateAdditionalResponse(raw([{ text: "a", category: "PERSON", evidence: "a".repeat(800) }]), { text: "a".repeat(1600), start: 42 });
    const ranges = result.candidates[0].ranges;
    expect(ranges).toHaveLength(1600);
    expect(ranges[0].start).toBe(42);
    expect(ranges.at(-1)?.start).toBe(1641);
    expect(ranges.every((r) => r.evidenceStart <= r.start && r.end <= r.evidenceEnd)).toBe(true);
  });
  it("サロゲートの片側と証拠位置の膨張を拒否する", () => {
    expect(() => validateAdditionalResponse(raw([{ text: "\uD83D", category: "PERSON", evidence: "😀" }]), { text: "😀", start: 0 })).toThrow();
    expect(() => validateAdditionalResponse(raw(Array.from({ length: 40 }, () => ({ text: "a", category: "PERSON", evidence: "a" }))), { text: "a".repeat(1600), start: 0 })).toThrow();
  });
  it("新規同一文字列の複数カテゴリは両方競合にする", () => {
    expect(classifyAdditionalCandidates([candidate, { ...candidate, category: "ORGANIZATION" }], []).map((c) => c.status)).toEqual(["conflict", "conflict"]);
  });
  it("包含する新規文字列は共存し最長一致を維持する", () => {
    const state = apply(ready("森さんと森太郎さん"), [candidate, { ...candidate, text: "森太郎" }]);
    expect(selectMaskedText(state)).toBe(`${state.entries[0].token}さんと${state.entries[1].token}さん`);
  });
  it("既存無効項目・カテゴリ・復元先・関連付けを変更しない", () => {
    const first = apply(ready());
    const entries = [{ ...first.entries[0], enabled: false, relatedGroupId: "group", restorationText: "代表名" }];
    expect(apply({ ...first, entries }).entries).toEqual(entries);
    expect(apply({ ...first, entries: [{ ...entries[0], category: "OTHER" }] }).entries[0].category).toBe("OTHER");
  });
  it("適用直前の手動追加と競合を再照合する", () => {
    const state = appReducer(ready(), { type: "addManualEntry", value: { id: "manual", selectedText: "森", category: "ORGANIZATION" } });
    expect(apply(state).entries).toEqual(state.entries);
  });
  it("正常0件の完了だけが開始条件を満たし、編集・読込・再検出・全消去は無効化する", () => {
    const state = ready();
    expect(state.successfulDetectionRevision).toBe(0);
    expect(apply(initialAppState).entries).toEqual([]);
    for (const next of [appReducer(state, { type: "beginDetection" }), appReducer(state, { type: "setOriginalText", value: "森さんです" }), appReducer(state, { type: "clearSession" }), appReducer(state, { type: "completeDetection", candidates: [], createId: () => "unused", outcome: "failed" })]) {
      expect(next.successfulDetectionRevision).toBeUndefined();
      expect(appReducer(next, { type: "applyAdditionalCandidates", candidates: [candidate], expectedRevision: state.originalRevision, expectedContextVersion: state.additionalContextVersion, createId: () => "late" }).entries).toEqual(next.entries);
    }
  });
  it("削除後は明示選択で再登録できる", () => {
    const state = apply(ready());
    expect(apply(appReducer(state, { type: "deleteEntry", id: state.entries[0].id })).entries).toHaveLength(1);
  });
});

describe("追加AI: 保存→読込→関連付け解除→復元", () => {
  it("v1互換の暗号保存後も一般語を保護し、関連付けを保存せず解除後に復元できる", async () => {
    let state = apply(ready("森さん、森の中、森太郎さん"), [candidate, { ...candidate, text: "森太郎" }]);
    const snapshot = () => createMaskMappingSnapshot({ mappingId: "synthetic", name: "合成試験", createdAt: 1, updatedAt: 2, revision: 1, occurrenceMaskingMode: state.occurrenceMaskingMode, entries: state.entries });
    const before = selectMaskedText(state);
    const mapping = snapshot();
    expect(mapping.schemaVersion).toBe(1);
    expect(mapping.entries.map((e) => e.sources)).toEqual([["regex"], ["regex"]]);
    expect(JSON.stringify(mapping)).not.toMatch(/prompt-api|evidence|ranges|occurrenceCount/);
    const encrypted = await encryptMaskMapping(mapping, "synthetic-passphrase-only");
    const decoded = await decryptMaskMapping(encrypted, "synthetic-passphrase-only");
    state = appReducer(state, { type: "loadMaskMapping", mapping: parseMaskMapping(decoded) });
    expect(state.successfulDetectionRevision).toBeUndefined();
    expect(selectMaskedText(state)).toBe(before);
    expect(before).toContain("森の中");
    expect(createMaskMappingFingerprint(state.entries, state.occurrenceMaskingMode)).toBe(createMaskMappingFingerprint(apply(ready("森さん、森の中、森太郎さん"), [candidate, { ...candidate, text: "森太郎" }]).entries, state.occurrenceMaskingMode));
    state = appReducer(state, { type: "relateEntries", ids: state.entries.map((e) => e.id), groupId: "group", mode: "new", restorationText: "森太郎" });
    expect(snapshot).toThrow("関連付け");
    state = appReducer(state, { type: "unlinkRelatedGroup", id: state.entries[0].id });
    expect(snapshot().entries).toHaveLength(2);
    expect(selectRestoredResponse({ ...state, externalResponse: selectMaskedText(state) })).toBe(state.originalText);
  });
});

describe("追加AI: 分割・非同期・環境", () => {
  it("評価用空白除外は外側だけを除き、UTF-16位置と内部の空白を保持する", async () => {
    expect(trimPromptChunks([{ text: " \n\t", start: 0 }, { text: "　\t😀森 さん\n ", start: 4 }])).toEqual([{ text: "😀森 さん", start: 6 }]);
    const seen: string[] = [], destroy = vi.fn();
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ destroy, extract: async (text) => { seen.push(text); return raw([{ text: "森", category: "PERSON", evidence: "森さん" }]); } }) };
    const text = " ".repeat(20) + "😀森さん" + " ".repeat(20);
    const result = await runAdditionalDetection(text, { signal: new AbortController().signal, adapter, chunkLength: 12, overlap: 4, trimWhitespace: true });
    expect(seen.every((s) => s.length > 0 && s === s.trim())).toBe(true);
    expect(result.candidates[0].ranges.map((r) => r.start)).toEqual([22]);
    expect(text.slice(result.candidates[0].ranges[0].start, result.candidates[0].ranges[0].end)).toBe("森");
    expect(destroy).toHaveBeenCalledOnce();
    await expect(runAdditionalDetection("　 \n", { signal: new AbortController().signal, adapter, trimWhitespace: true })).rejects.toThrow();
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("引用検証で棄却を含む応答は、同一区間でも再利用しない", async () => {
    const extract = vi.fn(async () => raw([{ text: "架空", category: "PERSON", evidence: "架空" }]));
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ extract, destroy: vi.fn() }) };
    const result = await runAdditionalDetection("abcdabcd", { signal: new AbortController().signal, adapter, chunkLength: 4, overlap: 0, reuseIdenticalChunks: true });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(result.reusedChunks).toBe(0);
    expect(result.rejected).toHaveLength(2);
  });
  it.each([1000, 10000, 30000])("%i文字を欠落・サロゲート分断なく分割する", (length) => {
    const text = ("😀合成本文\n".repeat(length)).slice(0, length - 2) + "終端";
    const chunks = splitPromptText(text);
    const coverage = new Set<number>();
    for (const chunk of chunks) {
      expect(chunk.text).toBe(text.slice(chunk.start, chunk.start + chunk.text.length));
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
      for (let i = chunk.start; i < chunk.start + chunk.text.length; i++) coverage.add(i);
    }
    expect(coverage.size).toBe(text.length);
  });
  it("上限超過と不正分割設定を拒否する", () => {
    expect(() => splitPromptText("a".repeat(30001))).toThrow();
    expect(() => splitPromptText("abcd", 4, 3)).toThrow();
    for (const value of [NaN, Infinity, 1.5]) {
      expect(() => splitPromptText("abcd", value, 0)).toThrow();
      expect(() => splitPromptText("abcd", 8, value)).toThrow();
    }
  });
  it("区間境界の前後にある対象を重複窓に完全に残す", () => {
    const target = "😀砂凪あかり千葉県架空市";
    for (const offset of [PROMPT_CONFIG.chunkLength - 1, PROMPT_CONFIG.chunkLength, PROMPT_CONFIG.chunkLength + 1]) {
      const text = "x".repeat(offset) + target + "y".repeat(PROMPT_CONFIG.chunkLength);
      expect(splitPromptText(text).some((chunk) => chunk.text.includes(target))).toBe(true);
    }
  });
  it("評価用の小さい窓でも全文を順に処理し、設定上限を拡大させない", async () => {
    const extract = vi.fn(async (_text: string) => { void _text; return raw([]); }), destroy = vi.fn();
    const create = vi.fn(async () => ({ extract, destroy }));
    const adapter: PromptAdapter = { availability: async () => "available", create };
    const text = "合成本文".repeat(20);
    await runAdditionalDetection(text, { signal: new AbortController().signal, adapter, chunkLength: 12, overlap: 3 });
    expect(extract.mock.calls.map(([value]) => value)).toEqual(splitPromptText(text, 12, 3).map((chunk) => chunk.text));
    create.mockClear();
    await expect(runAdditionalDetection(text, { signal: new AbortController().signal, adapter, chunkLength: PROMPT_CONFIG.chunkLength + 1 })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("区間を逐次処理し、重複区間の証拠位置を統合する", async () => {
    let active = 0;
    const destroy = vi.fn();
    const extract = vi.fn(async () => { expect(active++).toBe(0); await Promise.resolve(); active--; return raw([]); });
    const result = await runAdditionalDetection("合成文".repeat(1000), { signal: new AbortController().signal, adapter: { availability: async () => "available", create: async () => ({ extract, destroy }) } });
    expect(extract.mock.calls.length).toBeGreaterThan(1);
    expect(destroy).toHaveBeenCalledOnce();
    expect(result.candidates).toEqual([]);
    const duplicates = classifyAdditionalCandidates([candidate, candidate], []);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].ranges).toHaveLength(1);
  });
  it("完全に同じ区間だけを実行中に再利用し、全原文位置を検証し直す", async () => {
    const extract = vi.fn(async () => raw([entity])), destroy = vi.fn();
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ extract, destroy }) };
    const text = "森さん".repeat(12);
    const run = () => runAdditionalDetection(text, { signal: new AbortController().signal, adapter, chunkLength: 12, overlap: 0, reuseIdenticalChunks: true });
    const result = await run();
    expect(extract).toHaveBeenCalledOnce();
    expect(result.inferredChunks).toBe(1);
    expect(result.reusedChunks).toBe(2);
    expect(result.candidates[0].ranges.map((r) => r.start)).toEqual(Array.from({ length: 12 }, (_, i) => i * 3));
    await run();
    expect(extract).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(2);
  });
  it("似ているだけの区間を再利用せず、再利用中の中止も部分成功にしない", async () => {
    const extract = vi.fn(async () => raw([])), destroy = vi.fn();
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ extract, destroy }) };
    await runAdditionalDetection("abcdABCD", { signal: new AbortController().signal, adapter, chunkLength: 4, overlap: 0, reuseIdenticalChunks: true });
    expect(extract).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    await expect(runAdditionalDetection("abcdabcd", { signal: controller.signal, adapter, chunkLength: 4, overlap: 0, reuseIdenticalChunks: true, onProgress: (done) => { if (done === 1) controller.abort(); } })).rejects.toThrow();
    expect(destroy).toHaveBeenCalledTimes(2);
  });
  it("後半区間失敗では全候補を返さず、セッションを解放する", async () => {
    const destroy = vi.fn(); let i = 0;
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ destroy, extract: async () => ++i === 1 ? raw([entity]) : "invalid" }) };
    await expect(runAdditionalDetection("森さん".repeat(1000), { signal: new AbortController().signal, adapter })).rejects.toThrow();
    expect(destroy).toHaveBeenCalledOnce();
  });
  it.each(["cancel", "chunk", "total"])("%s: 応答しない推論も中断し、遅延結果を採用しない", async (mode) => {
    const controller = new AbortController(), destroy = vi.fn();
    let resolve!: (v: string) => void;
    const adapter: PromptAdapter = { availability: async () => "available", create: async () => ({ destroy, extract: () => new Promise((r) => { resolve = r; if (mode === "cancel") controller.abort(); }) }) };
    const run = runAdditionalDetection("森さん", { signal: controller.signal, adapter, chunkTimeoutMs: mode === "chunk" ? 5 : 1000, totalTimeoutMs: mode === "total" ? 5 : 1000 });
    await expect(run).rejects.toThrow(); resolve(raw([entity]));
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("APIなしは非対応で、クラウド代替を呼ばない", async () => {
    expect(await browserPromptAdapter.availability()).toBe("unavailable");
    await expect(browserPromptAdapter.create(new AbortController().signal)).rejects.toThrow();
  });
});
