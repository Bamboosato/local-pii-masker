import { ENTITY_SCHEMA, EXTRACTION_EXAMPLES, EXTRACTION_INSTRUCTION, PROMPT_CONFIG, type ExtractionExample } from "./config";
import { AdditionalDetectionError } from "./validation";
import { sourceQuoteChoices } from "./sourceQuotes";
import { JsonFormattingBudget } from "./formattingBudget";
export type PromptAvailability = "unavailable" | "downloadable" | "downloading" | "available";
type SessionOptions = { signal: AbortSignal; initialPrompts: { role: "system" | "user" | "assistant"; content: string }[]; expectedInputs: { type: "text"; languages: string[] }[]; expectedOutputs: { type: "text"; languages: string[] }[]; monitor?: (monitor: EventTarget) => void };
type ResponseOptions = { responseConstraint?: Record<string, unknown>; omitResponseConstraintInput?: boolean };
type BrowserSession = {
  contextWindow: number; contextUsage: number;
  measureContextUsage: (input: unknown, options: ResponseOptions) => Promise<number>;
  promptStreaming: (input: unknown, options: ResponseOptions & { signal: AbortSignal }) => ReadableStream<string>;
  clone: (options: { signal: AbortSignal }) => Promise<BrowserSession>;
  destroy: () => void;
  addEventListener: (type: string, listener: EventListener) => void;
};
type BrowserModel = { availability: (options: Pick<SessionOptions, "expectedInputs" | "expectedOutputs">) => Promise<PromptAvailability>; create: (options: SessionOptions) => Promise<BrowserSession> };
function model(): BrowserModel | undefined { return (globalThis as typeof globalThis & { LanguageModel?: BrowserModel }).LanguageModel; }
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new AdditionalDetectionError());
    if (signal.aborted) { void work.catch(() => undefined); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    void work.then(resolve, () => reject(new AdditionalDetectionError())).finally(() => signal.removeEventListener("abort", abort));
  });
}
export interface ExtractionSession {
  extract(text: string, signal: AbortSignal): Promise<string>;
  destroy(): void;
}
export interface PromptAdapter {
  availability(): Promise<PromptAvailability>;
  create(signal: AbortSignal, onProgress?: (progress: number) => void): Promise<ExtractionSession>;
}
const API_ERRORS = ["AbortError", "NotSupportedError", "NotReadableError", "InvalidStateError", "QuotaExceededError", "OperationError", "UnknownError"] as const;
const API_DETAILS = {
  "Failed to parse the response.": "response-parsing",
  "Other generic failures occurred.": "generic-failure",
  "Failed to run the safety checks.": "safety-check",
  "Failed to count tokens.": "token-count",
  "An unknown error occurred: kErrorUnknown": "unknown",
  "An unknown error occurred: kErrorRequestThrottled": "throttled",
  "An unknown error occurred: kErrorRetryableError": "retryable",
  "An unknown error occurred: kErrorNonRetryableError": "non-retryable",
} as const;
type ApiFailure = { apiError: typeof API_ERRORS[number] | "Other"; apiReason: "language" | "safety" | "constraint" | "model" | "other"; apiDetail: typeof API_DETAILS[keyof typeof API_DETAILS] | "unclassified" };
function classifyApiFailure(error: unknown): ApiFailure {
  const value = error as { name?: unknown; message?: unknown } | null;
  const name = typeof value?.name === "string" ? value.name : "";
  const message = typeof value?.message === "string" ? value.message : "";
  const apiDetail = Object.entries(API_DETAILS).find(([text]) => text === message)?.[1] ?? "unclassified";
  return { apiError: API_ERRORS.find((item) => item === name) ?? "Other", apiReason: /language/i.test(message) ? "language" : /unsafe|safety|filtered/i.test(message) ? "safety" : /schema|constraint|format|regex/i.test(message) ? "constraint" : /model|service/i.test(message) ? "model" : "other", apiDetail };
}
export type PromptDiagnostic = { phase: "create" | "clone" | "measure" | "stream"; characters: number; whitespaceCharacters: number; maxWhitespaceRun: number; formattingLimit: boolean; overflow: boolean; aborted: boolean; responseLimit: boolean; contextBudget: boolean; usage?: number; contextWindow?: number } & Partial<ApiFailure>;
export function createBrowserPromptAdapter(settings: Readonly<{ instruction: string; omitResponseConstraintInput: boolean; instructionLanguage?: "ja" | "en"; bilingualOutput?: boolean; quoteStyle?: "windows" | "sentences" | "sentences-only"; examples?: readonly ExtractionExample[]; category?: "PERSON" | "ADDRESS" | "ORGANIZATION"; constrainEvidence?: boolean; onFailure?: (diagnostic: PromptDiagnostic) => void; sessionMode?: "clone" | "fresh"; disableResponseConstraint?: boolean; responseSchema?: (text: string) => Record<string, unknown>; serializeDocument?: (text: string) => string }> = {
  instruction: EXTRACTION_INSTRUCTION,
  omitResponseConstraintInput: PROMPT_CONFIG.omitResponseConstraintInput,
  instructionLanguage: PROMPT_CONFIG.instructionLanguage,
  examples: EXTRACTION_EXAMPLES,
  constrainEvidence: PROMPT_CONFIG.constrainEvidence,
}): PromptAdapter {
  // Evaluation can compare trusted module-defined instructions without replacing the API.
  const instruction = settings.instruction;
  const onFailure = settings.onFailure;
  const constrainEvidence = settings.constrainEvidence === true;
  const quoteStyle = settings.quoteStyle;
  const sessionMode = settings.sessionMode ?? "clone";
  const responseSchema = settings.responseSchema, serializeDocument = settings.serializeDocument;
  if ((responseSchema && settings.disableResponseConstraint) || (constrainEvidence && (!settings.omitResponseConstraintInput || responseSchema || settings.disableResponseConstraint))) throw new AdditionalDetectionError();
  const schema = settings.category ? {
    ...ENTITY_SCHEMA,
    properties: { entities: { ...ENTITY_SCHEMA.properties.entities, items: { ...ENTITY_SCHEMA.properties.entities.items, properties: { ...ENTITY_SCHEMA.properties.entities.items.properties, category: { type: "string", enum: [settings.category] } } } } },
  } : ENTITY_SCHEMA;
  const constraint: ResponseOptions = settings.disableResponseConstraint ? {} : { responseConstraint: schema, omitResponseConstraintInput: settings.omitResponseConstraintInput };
  const languageOptions = {
    expectedInputs: [{ type: "text" as const, languages: settings.instructionLanguage === "en" ? ["en", "ja"] : ["ja"] }],
    expectedOutputs: [{ type: "text" as const, languages: settings.bilingualOutput ? ["ja", "en"] : ["ja"] }],
  };
  // Examples are fixed synthetic module data, never documents from a user's session.
  const initialPrompts: SessionOptions["initialPrompts"] = [{ role: "system", content: instruction }];
  for (const example of settings.examples ?? []) {
    initialPrompts.push({ role: "user", content: JSON.stringify({ document: example.document }) });
    initialPrompts.push({ role: "assistant", content: JSON.stringify({ entities: example.entities }) });
  }
  return {
  async availability() {
    try { const value = await model()?.availability(languageOptions); return value && ["unavailable", "downloadable", "downloading", "available"].includes(value) ? value : "unavailable"; } catch { return "unavailable"; }
  },
  async create(signal, onProgress) {
    const api = model();
    if (!api || signal.aborted) throw new AdditionalDetectionError();
    const released = new WeakSet<BrowserSession>();
    const release = (session: BrowserSession) => { if (!released.has(session)) { released.add(session); session.destroy(); } };
    const makeSession = (creationSignal: AbortSignal) => api.create({ ...languageOptions, signal: creationSignal, initialPrompts, monitor: (monitor) => monitor.addEventListener("downloadprogress", (event) => {
      const loaded = (event as Event & { loaded?: number }).loaded;
      if (!creationSignal.aborted && typeof loaded === "number" && Number.isFinite(loaded)) onProgress?.(Math.max(0, Math.min(1, loaded)));
    }) });
    let pending: Promise<BrowserSession>;
    const preparationFailure = (error: unknown) => {
      try { onFailure?.({ phase: "create", characters: 0, whitespaceCharacters: 0, maxWhitespaceRun: 0, formattingLimit: false, overflow: false, aborted: signal.aborted, responseLimit: false, contextBudget: false, ...classifyApiFailure(error) }); } catch { /* Never expose diagnostic errors. */ }
    };
    try { pending = makeSession(signal); } catch (error) { preparationFailure(error); throw new AdditionalDetectionError(); }
    void pending.catch(preparationFailure);
    // A late create/clone must release its resources even if the API ignores abort.
    void pending.then((session) => { if (signal.aborted) release(session); }, () => undefined);
    const base = await abortable(pending, signal);
    let usePrepared = true, closed = false;
    return {
      destroy: () => { closed = true; release(base); },
      async extract(text, chunkSignal) {
        if (closed) throw new AdditionalDetectionError();
        const extractionConstraint = responseSchema ? { ...constraint, responseConstraint: responseSchema(text) } : constrainEvidence ? {
          ...constraint,
          responseConstraint: { ...schema, properties: { entities: { ...schema.properties.entities, items: { ...schema.properties.entities.items, properties: { ...schema.properties.entities.items.properties, evidence: { ...schema.properties.entities.items.properties.evidence, enum: sourceQuoteChoices(text, quoteStyle) } } } } } },
        } : constraint;
        let apiFailure: ApiFailure | undefined;
        const observe = <T,>(work: Promise<T>) => { void work.catch((error: unknown) => { apiFailure = classifyApiFailure(error); }); return work; };
        let session: BrowserSession | undefined;
        let phase: PromptDiagnostic["phase"] = sessionMode === "clone" ? "clone" : "create", characters = 0, overflow = false, responseLimit = false, contextBudget = false;
        let whitespaceCharacters = 0, maxWhitespaceRun = 0, whitespaceRun = 0;
        let formattingLimit = false;
        const formattingBudget = new JsonFormattingBudget(PROMPT_CONFIG.maxFormattingWhitespaceRun);
        let usage: number | undefined;
        try {
          const cloning = observe(sessionMode === "clone" ? base.clone({ signal: chunkSignal }) : usePrepared ? Promise.resolve(base) : makeSession(chunkSignal));
          usePrepared = false;
          void cloning.then((value) => { if (chunkSignal.aborted) release(value); }, () => undefined);
          session = await abortable(cloning, chunkSignal);
          phase = "measure";
          const input = [{ role: "user", content: [{ type: "text", value: serializeDocument ? serializeDocument(text) : JSON.stringify({ document: text }) }] }];
          session.addEventListener("contextoverflow", () => { overflow = true; });
          usage = await abortable(observe(session.measureContextUsage(input, extractionConstraint)), chunkSignal);
          contextBudget = !Number.isFinite(usage) || !Number.isFinite(session.contextWindow) || !Number.isFinite(session.contextUsage) || usage + session.contextUsage + PROMPT_CONFIG.outputReserve > session.contextWindow;
          if (contextBudget) throw new AdditionalDetectionError();
          phase = "stream";
          const reader = session.promptStreaming(input, { ...extractionConstraint, signal: chunkSignal }).getReader();
          let response = "";
          try {
            for (;;) {
              const { value, done } = await abortable(observe(reader.read()), chunkSignal);
              if (done) break;
              response += value;
              if (onFailure) for (const character of value) {
                if (/\s/u.test(character)) { whitespaceCharacters++; maxWhitespaceRun = Math.max(maxWhitespaceRun, ++whitespaceRun); }
                else whitespaceRun = 0;
              }
              characters = response.length;
              responseLimit = characters > PROMPT_CONFIG.maxResponseLength;
              formattingLimit = formattingBudget.exceeds(value);
              if (responseLimit || formattingLimit || overflow) throw new AdditionalDetectionError();
            }
          } finally { reader.releaseLock(); }
          if (overflow || chunkSignal.aborted) throw new AdditionalDetectionError();
          return response;
        } catch (error) {
          // Optional evaluation diagnostics contain only fixed enums, flags and counts.
          try { onFailure?.({ phase, characters, whitespaceCharacters, maxWhitespaceRun, formattingLimit, overflow, aborted: chunkSignal.aborted, responseLimit, contextBudget, usage, contextWindow: session?.contextWindow, ...(apiFailure ?? classifyApiFailure(error)) }); } catch { /* Diagnostic consumers cannot change inference. */ }
          throw new AdditionalDetectionError();
        } finally { if (session) release(session); }
      },
    };
  },
  };
}
export const browserPromptAdapter = createBrowserPromptAdapter();
