import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPromptAdapter, createBrowserPromptAdapter } from "./adapter";
import { ENTITY_SCHEMA, PROMPT_CONFIG } from "./config";
import { sourceQuoteChoices } from "./sourceQuotes";

afterEach(() => vi.unstubAllGlobals());
function mockApi(options: { usage?: number; window?: number; response?: string; overflow?: boolean } = {}) {
  const destroy = vi.fn();
  let overflow: EventListener | undefined;
  const measure = vi.fn(async () => options.usage ?? 100);
  const prompt = vi.fn(() => new ReadableStream<string>({ start(controller) { if (options.overflow) overflow?.(new Event("contextoverflow")); controller.enqueue(options.response ?? '{"entities":[]}'); controller.close(); } }));
  const clone = vi.fn(async () => ({ contextWindow: options.window ?? 10000, contextUsage: 10, measureContextUsage: measure,
    addEventListener: (_name: string, listener: EventListener) => { overflow = listener; }, destroy,
    promptStreaming: prompt,
  }));
  const create = vi.fn(async (options: unknown) => { void options; return { clone, destroy }; });
  const availability = vi.fn(async (options: unknown) => { void options; return "available"; });
  vi.stubGlobal("LanguageModel", { create, availability });
  return { destroy, create, availability, clone, measure, prompt };
}
describe("Chrome APIアダプター境界", () => {
  it("新規方式の遅延createも中止後に一度だけ解放し、生の例外を出さない", async () => {
    const api = mockApi(), root = new AbortController(), segment = new AbortController();
    const make = () => ({ contextWindow: 10000, contextUsage: 0, measureContextUsage: api.measure, promptStreaming: api.prompt, destroy: vi.fn(), addEventListener: vi.fn(), clone: api.clone });
    const first = make(), late = make();
    let finish!: (value: ReturnType<typeof make>) => void;
    api.create.mockResolvedValueOnce(first).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const session = await createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: false, sessionMode: "fresh" }).create(root.signal);
    await session.extract("最初", root.signal);
    const pending = session.extract("次の合成文", segment.signal);
    segment.abort();
    await expect(pending).rejects.toThrow("完了していません");
    session.destroy(); finish(late); await Promise.resolve();
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(late.destroy).toHaveBeenCalledOnce();
  });
  it("準備段階のAPI拒否も固定分類だけを記録する", async () => {
    const api = mockApi(), onFailure = vi.fn();
    api.create.mockRejectedValue(new DOMException("model synthetic-private-message", "OperationError"));
    await expect(createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: false, onFailure }).create(new AbortController().signal)).rejects.toThrow("完了していません");
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ phase: "create", apiError: "OperationError", apiReason: "model" }));
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain("synthetic-private-message");
  });
  it("新規方式は準備済みセッションを初回に使い、以降も本文履歴を共有しない", async () => {
    const api = mockApi(), signal = new AbortController().signal;
    const make = () => ({ contextWindow: 10000, contextUsage: 0, measureContextUsage: api.measure, promptStreaming: api.prompt, destroy: vi.fn(), addEventListener: vi.fn(), clone: api.clone });
    const first = make(), second = make();
    api.create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const session = await createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: true, sessionMode: "fresh" }).create(signal);
    await session.extract("最初の合成本文", signal);
    await session.extract("次の合成本文", signal);
    session.destroy(); session.destroy();
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(api.clone).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).toHaveBeenCalledOnce();
    expect(JSON.stringify(api.create.mock.calls)).not.toContain("合成本文");
    await expect(session.extract("終了後", signal)).rejects.toThrow();
  });
  it("制約なしの診断では計測・推論の両方から制約を外す", async () => {
    const api = mockApi(), signal = new AbortController().signal;
    const session = await createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: true, disableResponseConstraint: true }).create(signal);
    await session.extract("合成本文", signal);
    expect(api.measure).toHaveBeenCalledWith(expect.any(Array), {});
    expect(api.prompt).toHaveBeenCalledWith(expect.any(Array), { signal });
    session.destroy();
  });
  it("評価用の独自参照形式でも計測・生成で同一スキーマ・入力を使う", async () => {
    const api = mockApi(), signal = new AbortController().signal;
    const schema = { type: "object", properties: {} };
    const session = await createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: false, responseSchema: () => schema, serializeDocument: (text) => JSON.stringify({ sources: [{ id: 0, text }] }) }).create(signal);
    await session.extract("合成本文", signal);
    expect(api.measure).toHaveBeenCalledWith([{ role: "user", content: [{ type: "text", value: '{"sources":[{"id":0,"text":"合成本文"}]}' }] }], { responseConstraint: schema, omitResponseConstraintInput: false });
    expect(api.prompt).toHaveBeenCalledWith(expect.any(Array), { responseConstraint: schema, omitResponseConstraintInput: false, signal });
    session.destroy();
  });
  it("構文空白の過剰生成は時間上限前に失敗とし、途中応答を返さず解放する", async () => {
    const api = mockApi({ response: '{"entities":[' + " ".repeat(PROMPT_CONFIG.maxFormattingWhitespaceRun + 1) }), signal = new AbortController().signal, onFailure = vi.fn();
    const session = await createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: true, onFailure }).create(signal);
    await expect(session.extract("合成本文", signal)).rejects.toThrow("完了していません");
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ formattingLimit: true, aborted: false, responseLimit: false }));
    expect(api.destroy).toHaveBeenCalledOnce();
    session.destroy();
  });
  it("日英JSONの評価設定でもavailabilityとcreateに同じ言語を宣言する", async () => {
    const api = mockApi(), signal = new AbortController().signal;
    const adapter = createBrowserPromptAdapter({ instruction: "固定指示", bilingualOutput: true, omitResponseConstraintInput: true });
    await adapter.availability();
    const session = await adapter.create(signal);
    const options = { expectedInputs: [{ type: "text", languages: ["ja"] }], expectedOutputs: [{ type: "text", languages: ["ja", "en"] }] };
    expect(api.availability).toHaveBeenCalledWith(options);
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining(options));
    session.destroy();
  });
  it("利用可否とcreateで同じ日本語テキスト条件を使い、区間ごとにcloneする", async () => {
    const api = mockApi(); const signal = new AbortController().signal;
    expect(await browserPromptAdapter.availability()).toBe("available");
    const session = await browserPromptAdapter.create(signal);
    expect(await session.extract("合成本文", signal)).toBe('{"entities":[]}');
    await session.extract("別文書", signal); session.destroy();
    const createOptions = api.create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(createOptions[0]).toMatchObject(api.availability.mock.calls[0]?.[0] ?? {});
    expect(createOptions[0]).not.toHaveProperty("temperature");
    expect(createOptions[0]).not.toHaveProperty("samplingMode");
    expect(api.clone).toHaveBeenCalledTimes(2);
    expect(api.destroy).toHaveBeenCalledTimes(3);
    expect(api.measure).toHaveBeenCalledWith(expect.any(Array), { responseConstraint: ENTITY_SCHEMA, omitResponseConstraintInput: PROMPT_CONFIG.omitResponseConstraintInput });
  });
  it.each([false, true])("スキーマ自動入力の比較でも計測と推論の条件・構造制約を一致させる: %s", async (omitResponseConstraintInput) => {
    const api = mockApi(), signal = new AbortController().signal;
    const settings = { instruction: "評価専用の固定指示", omitResponseConstraintInput };
    const adapter = createBrowserPromptAdapter(settings);
    settings.instruction = "作成後の別設定";
    const session = await adapter.create(signal);
    await expect(session.extract("合成本文", signal)).resolves.toBe('{"entities":[]}');
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ initialPrompts: [{ role: "system", content: "評価専用の固定指示" }] }));
    expect(api.measure).toHaveBeenCalledWith(expect.any(Array), { responseConstraint: ENTITY_SCHEMA, omitResponseConstraintInput });
    expect(api.prompt).toHaveBeenCalledWith(expect.any(Array), { responseConstraint: ENTITY_SCHEMA, omitResponseConstraintInput, signal });
    session.destroy();
  });
  it("英語指示と固定例でも可用性と作成の言語条件を一致させ、本文は推論時だけ渡す", async () => {
    const api = mockApi(), signal = new AbortController().signal;
    const adapter = createBrowserPromptAdapter({ instruction: "Extract entities", instructionLanguage: "en", omitResponseConstraintInput: true, examples: [{ document: "固定した合成例", entities: [] }] });
    await adapter.availability();
    const session = await adapter.create(signal);
    const expected = { expectedInputs: [{ type: "text", languages: ["en", "ja"] }], expectedOutputs: [{ type: "text", languages: ["ja"] }] };
    expect(api.availability).toHaveBeenCalledWith(expected);
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ ...expected, initialPrompts: [
      { role: "system", content: "Extract entities" },
      { role: "user", content: JSON.stringify({ document: "固定した合成例" }) },
      { role: "assistant", content: '{"entities":[]}' },
    ] }));
    expect(JSON.stringify(api.create.mock.calls)).not.toContain("今回の合成本文");
    await session.extract("今回の合成本文", signal);
    expect(api.prompt).toHaveBeenCalledWith([{ role: "user", content: [{ type: "text", value: JSON.stringify({ document: "今回の合成本文" }) }] }], expect.any(Object));
    session.destroy();
  });
  it("原文引用の構造制約を計測・生成へ同じ条件で渡し、共通スキーマを汚染しない", async () => {
    const api = mockApi(), signal = new AbortController().signal;
    const adapter = createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: true, constrainEvidence: true, category: "PERSON" });
    const session = await adapter.create(signal);
    await session.extract("😀合成の本文", signal);
    const expectedSchema = expect.objectContaining({ properties: { entities: expect.objectContaining({ items: expect.objectContaining({ properties: expect.objectContaining({
      category: { type: "string", enum: ["PERSON"] },
      evidence: expect.objectContaining({ enum: sourceQuoteChoices("😀合成の本文") }),
    }) }) }) } });
    expect(api.measure).toHaveBeenCalledWith(expect.any(Array), { responseConstraint: expectedSchema, omitResponseConstraintInput: true });
    expect(api.prompt).toHaveBeenCalledWith(expect.any(Array), { responseConstraint: expectedSchema, omitResponseConstraintInput: true, signal });
    expect(ENTITY_SCHEMA.properties.entities.items.properties.evidence).not.toHaveProperty("enum");
    expect(ENTITY_SCHEMA.properties.entities.items.properties.category.enum).toEqual(["PERSON", "ADDRESS", "ORGANIZATION"]);
    expect(() => createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: false, constrainEvidence: true })).toThrow();
    session.destroy();
  });
  it.each([{ usage: 5000, window: 6000 }, { response: "a".repeat(PROMPT_CONFIG.maxResponseLength + 1) }, { overflow: true }].map((options, id) => ({ options, id })))("容量超過・出力上限・overflowで成功させず資源解放: $id", async ({ options }) => {
    const api = mockApi(options), signal = new AbortController().signal;
    const session = await browserPromptAdapter.create(signal);
    await expect(session.extract("合成本文", signal)).rejects.toThrow();
    expect(api.destroy).toHaveBeenCalledOnce(); session.destroy();
  });
  it("中止後に返るcreateもdestroyし、機密を含むAPI例外を外へ出さない", async () => {
    let finish!: (session: unknown) => void;
    const destroy = vi.fn();
    vi.stubGlobal("LanguageModel", { create: () => new Promise((resolve) => { finish = resolve; }) });
    const controller = new AbortController();
    const pending = browserPromptAdapter.create(controller.signal); controller.abort();
    await expect(pending).rejects.toThrow("完了していません");
    finish({ destroy }); await Promise.resolve(); expect(destroy).toHaveBeenCalledOnce();
    vi.stubGlobal("LanguageModel", { create: async () => { throw new Error("synthetic-private-content"); } });
    await expect(browserPromptAdapter.create(new AbortController().signal)).rejects.not.toThrow("synthetic-private-content");
  });
  it.each([
    ["NotSupportedError", "language synthetic-private-content", "language"],
    ["NotReadableError", "safety filtered synthetic-private-content", "safety"],
    ["OperationError", "response constraint synthetic-private-content", "constraint"],
    ["UnknownError", "model service synthetic-private-content", "model"],
    ["private-error-name", "synthetic-private-content", "other"],
  ])("API拒否は固定分類と件数だけを通知し、例外名・本文を漏らさない: %s", async (name, message, reason) => {
    const api = mockApi(), onFailure = vi.fn(), signal = new AbortController().signal;
    api.prompt.mockImplementation(() => new ReadableStream<string>({ start(controller) {
      controller.enqueue("{} ");
      queueMicrotask(() => controller.error(Object.assign(new Error(message), { name })));
    } }));
    const session = await createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: true, onFailure }).create(signal);
    await expect(session.extract("synthetic-private-document", signal)).rejects.not.toThrow("synthetic-private");
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ phase: "stream", aborted: false, apiError: name === "private-error-name" ? "Other" : name, apiReason: reason }));
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain("synthetic-private");
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain("private-error-name");
    expect(api.destroy).toHaveBeenCalledOnce();
    session.destroy();
  });
  it("診断通知の例外でも推論エラーの機密保護と解放を維持する", async () => {
    const api = mockApi({ overflow: true }), signal = new AbortController().signal;
    const session = await createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: true, onFailure: () => { throw new Error("private-diagnostic"); } }).create(signal);
    await expect(session.extract("合成本文", signal)).rejects.not.toThrow("private-diagnostic");
    expect(api.destroy).toHaveBeenCalledOnce();
    session.destroy();
  });
  it.each(["clone-sync", "clone-async", "measure", "stream-sync"])("APIの各失敗段階を区別し例外本文を伏せる: %s", async (stage) => {
    const api = mockApi(), signal = new AbortController().signal, onFailure = vi.fn();
    const error = new DOMException("model synthetic-private-content", "OperationError");
    if (stage === "clone-sync") api.clone.mockImplementation(() => { throw error; });
    if (stage === "clone-async") api.clone.mockRejectedValue(error);
    if (stage === "measure") api.measure.mockRejectedValue(error);
    if (stage === "stream-sync") api.prompt.mockImplementation(() => { throw error; });
    const session = await createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: true, onFailure }).create(signal);
    await expect(session.extract("synthetic-private-document", signal)).rejects.not.toThrow("synthetic-private");
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ phase: stage.startsWith("clone") ? "clone" : stage === "measure" ? "measure" : "stream", apiError: "OperationError", apiReason: "model" }));
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain("synthetic-private");
    expect(api.destroy).toHaveBeenCalledTimes(stage.startsWith("clone") ? 0 : 1);
    session.destroy();
  });
  it.each([
    ["Failed to parse the response.", "response-parsing"],
    ["An unknown error occurred: kErrorUnknown", "unknown"],
    ["Other generic failures occurred.", "generic-failure"],
    ["Failed to run the safety checks.", "safety-check"],
    ["Failed to count tokens.", "token-count"],
    ["An unknown error occurred: kErrorRequestThrottled", "throttled"],
    ["An unknown error occurred: kErrorRetryableError", "retryable"],
    ["An unknown error occurred: kErrorNonRetryableError", "non-retryable"],
    ["Failed to parse the response. synthetic-private-content", "unclassified"],
  ])("公開API例外定数との完全一致だけを診断へ出す: %s", async (message, apiDetail) => {
    const api = mockApi(), signal = new AbortController().signal, onFailure = vi.fn();
    api.prompt.mockImplementation(() => new ReadableStream<string>({
      start(controller) { controller.enqueue("{}  \n"); },
      pull(controller) { controller.error(new DOMException(message, "UnknownError")); },
    }));
    const session = await createBrowserPromptAdapter({ instruction: "固定指示", omitResponseConstraintInput: true, onFailure }).create(signal);
    await expect(session.extract("非公開の合成本文", signal)).rejects.toThrow("完了していません");
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ apiDetail, characters: 5, whitespaceCharacters: 3, maxWhitespaceRun: 3 }));
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain("synthetic-private-content");
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(message);
    session.destroy();
  });
});
