import { browserPromptAdapter, createBrowserPromptAdapter, type PromptDiagnostic, type PromptAdapter } from "../../src/domain/detection/prompt/adapter";
import { EXTRACTION_INSTRUCTION, PROMPT_CONFIG } from "../../src/domain/detection/prompt/config";
import { runAdditionalDetection } from "../../src/domain/detection/prompt/run";
import { splitPromptText } from "../../src/domain/detection/prompt/chunks";
import { validateAdditionalResponse, type AdditionalCandidate } from "../../src/domain/detection/prompt/validation";
import { mergeCandidates } from "../../src/domain/detection/mergeCandidates";
import { DEVELOPMENT_V2_VERSION } from "./corpusV2";
import { priorityDocuments, type PriorityVariant } from "./priorityPlan";
import { serializeSources, sourceIdSchema, SOURCE_ID_INSTRUCTION, NEGATIVE_SOURCE_ID_INSTRUCTION, BRIEF_NEGATIVE_SOURCE_ID_INSTRUCTION, SOURCE_ID_SCHEMA_VERSION, validateSourceIdResponse } from "./sourceId";
import { scoreFinalMask } from "./evaluate";
import { analyzeErrors } from "./errorAnalysis";

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
}
/** Readiness is not inference: do not start model creation after an unanswered check. */
export async function checkPriorityAvailability(timeoutMs = 5000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([browserPromptAdapter.availability(), new Promise<"availability-timeout">((resolve) => { timer = setTimeout(() => resolve("availability-timeout"), timeoutMs); })]);
  } catch { return "unavailable" as const; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
export async function capturePriorityRuntime() {
  const nav = navigator as Navigator & { userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> } };
  const hints = await nav.userAgentData?.getHighEntropyValues(["fullVersionList", "platformVersion", "architecture", "bitness"]);
  return { userAgent: navigator.userAgent, hints, hardwareConcurrency: navigator.hardwareConcurrency, language: navigator.language, secureContext: globalThis.isSecureContext };
}
export async function evaluatePriorityDocument(variant: PriorityVariant, documentId: string, signal: AbortSignal, adapterOverride?: PromptAdapter) {
  const document = priorityDocuments().find((d) => d.id === documentId);
  if (!document || !document.id.startsWith("development-v2-")) throw new Error("Unknown development case");
  const beforeRuntime = await capturePriorityRuntime();
  const instruction = variant.format === "source-id-v2" ? variant.instruction === "negative-brief-v1" ? BRIEF_NEGATIVE_SOURCE_ID_INSTRUCTION : variant.instruction === "negative-v1" ? NEGATIVE_SOURCE_ID_INSTRUCTION : SOURCE_ID_INSTRUCTION : EXTRACTION_INSTRUCTION;
  const referenceMode = variant.referenceMode ?? "whole-and-lines";
  const serialize = variant.format === "source-id-v2" ? (text: string) => serializeSources(text, referenceMode) : (text: string) => JSON.stringify({ document: text });
  const diagnostics = { responses: 0, deliveredChunks: 0, responseCharacters: 0, serializedInputCharacters: 0, structureValidatedChunks: 0, rejected: 0, referenceErrors: { wrongReference: 0, textAbsent: 0 }, failures: [] as PromptDiagnostic[], calls: [] as { call: number; chunkCharacters: number; complete: boolean; elapsedMs: number }[] };
  const real = adapterOverride ?? createBrowserPromptAdapter({ instruction, omitResponseConstraintInput: variant.omitSchemaInput, sessionMode: variant.sessionMode, disableResponseConstraint: variant.constraint === "none", constrainEvidence: variant.constraint === "quote-enum", ...(variant.format === "source-id-v2" ? { responseSchema: (text: string) => sourceIdSchema(text, referenceMode), serializeDocument: serialize } : {}), onFailure: (event) => diagnostics.failures.push(event) });
  const adapter: PromptAdapter = {
    availability: () => real.availability(),
    async create(createSignal) {
      const session = await real.create(createSignal);
      return { destroy: () => session.destroy(), async extract(text, chunkSignal) {
        diagnostics.serializedInputCharacters += serialize(text).length;
        const call = { call: diagnostics.calls.length + 1, chunkCharacters: text.length, complete: false, elapsedMs: 0 };
        diagnostics.calls.push(call); const started = performance.now();
        try {
          const raw = await session.extract(text, chunkSignal);
          diagnostics.responses++; diagnostics.responseCharacters += raw.length; call.complete = true;
          return raw;
        } finally { call.elapsedMs = performance.now() - started; }
      } };
    },
  };
  const chunks = splitPromptText(document.text, variant.chunkLength ?? PROMPT_CONFIG.chunkLength, variant.overlap ?? PROMPT_CONFIG.overlap).length;
  let detectingAt: number | undefined, completed = false, candidates: AdditionalCandidate[] = [];
  let reusedChunks = 0;
  let rejectionReasons: string[] = [];
  const startAt = new Date().toISOString(), start = performance.now();
  try {
    const result = await runAdditionalDetection(document.text, { signal, adapter, chunkLength: variant.chunkLength, overlap: variant.overlap, reuseIdenticalChunks: variant.reuseIdenticalChunks, validateResponse: (raw, chunk) => {
      diagnostics.deliveredChunks++;
      const sourceResult = variant.format === "source-id-v2" ? validateSourceIdResponse(raw, chunk, referenceMode) : undefined;
      const result = sourceResult ?? validateAdditionalResponse(raw, chunk);
      if (sourceResult) {
        diagnostics.referenceErrors.wrongReference += sourceResult.referenceErrors.wrongReference;
        diagnostics.referenceErrors.textAbsent += sourceResult.referenceErrors.textAbsent;
      }
      diagnostics.structureValidatedChunks++; diagnostics.rejected += result.rejected.length;
      return result;
    }, onPhase: (phase) => { if (phase === "detecting") detectingAt = performance.now(); } });
    candidates = result.candidates; rejectionReasons = result.rejected; completed = true; reusedChunks = result.reusedChunks;
  } catch { /* Fixed status and diagnostics only; never expose native exception text. */ }
  const finished = performance.now();
  let nextId = 0;
  const entries = mergeCandidates({ originalText: document.text, entries: [], candidates: candidates.map((c) => ({ originalText: c.text, category: c.category, source: "prompt-api" })), createId: () => `priority-${++nextId}` });
  const evidence = candidates.flatMap((c) => c.ranges.map((r) => ({ text: c.text, category: c.category, start: r.start, end: r.end })));
  const settings = { variant, config: PROMPT_CONFIG, languages: { inputs: ["ja"], outputs: ["ja"] }, schemaVersion: variant.format === "source-id-v2" ? SOURCE_ID_SCHEMA_VERSION : "entities-v1", instructionHash: await digest(instruction) };
  return {
    datasetVersion: document.family === "legacy-reproduction" ? "development-legacy-reproduction" : DEVELOPMENT_V2_VERSION, documentId, documentHash: await digest(document), family: document.family, marker: document.marker, length: document.text.length,
    settings, settingsHash: await digest(settings), startAt, endAt: new Date().toISOString(), runtimeBefore: beforeRuntime, runtimeAfter: await capturePriorityRuntime(),
    chunks, reusedChunks, complete: completed, transportComplete: diagnostics.deliveredChunks === chunks, structureComplete: diagnostics.structureValidatedChunks === chunks,
    failureStage: completed ? undefined : detectingAt === undefined ? "preparation" : diagnostics.responses > diagnostics.structureValidatedChunks ? "validation" : "inference",
    aborted: signal.aborted, wallMs: finished - start, preparationMs: detectingAt === undefined ? undefined : detectingAt - start, detectionMs: detectingAt === undefined ? undefined : finished - detectingAt,
    diagnostics, rejected: rejectionReasons, score: scoreFinalMask(document, entries, evidence), errors: analyzeErrors(document, entries, evidence),
  };
}
