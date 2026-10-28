import { abortable, browserPromptAdapter, type PromptAdapter } from "./adapter";
import { splitPromptText, trimPromptChunks } from "./chunks";
import { PROMPT_CONFIG } from "./config";
import { AdditionalDetectionError, combineAdditionalCandidates, validateAdditionalResponse, type AdditionalCandidate, type RejectionReason } from "./validation";
export type AdditionalResult = { candidates: AdditionalCandidate[]; rejected: RejectionReason[]; elapsedMs: number; preparationMs: number; inferredChunks: number; reusedChunks: number };
export async function runAdditionalDetection(text: string, options: { signal: AbortSignal; onProgress?: (done: number, total: number) => void; onPhase?: (phase: "preparing" | "detecting") => void; adapter?: PromptAdapter; chunkTimeoutMs?: number; totalTimeoutMs?: number; chunkLength?: number; overlap?: number; reuseIdenticalChunks?: boolean; trimWhitespace?: boolean; validateResponse?: typeof validateAdditionalResponse }): Promise<AdditionalResult> {
  // Evaluation overrides may tighten the input windows, never enlarge the configured limit.
  const chunkLength = options.chunkLength ?? PROMPT_CONFIG.chunkLength;
  if (chunkLength > PROMPT_CONFIG.chunkLength) throw new AdditionalDetectionError();
  const split = splitPromptText(text, chunkLength, options.overlap ?? PROMPT_CONFIG.overlap);
  const chunks = options.trimWhitespace ? trimPromptChunks(split) : split;
  if (!chunks.length || options.signal.aborted) throw new AdditionalDetectionError();
  const preparing = performance.now();
  options.onPhase?.("preparing");
  const session = await (options.adapter ?? browserPromptAdapter).create(options.signal);
  const preparationMs = performance.now() - preparing;
  const started = performance.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const timer = setTimeout(abort, options.totalTimeoutMs ?? PROMPT_CONFIG.totalTimeoutMs);
  const candidates: AdditionalCandidate[] = [], rejected: RejectionReason[] = [];
  // Per-run memory only. Revalidate cached responses at each chunk's original position.
  const responses = new Map<string, string>();
  const reuse = options.reuseIdenticalChunks ?? PROMPT_CONFIG.reuseIdenticalChunks;
  let inferredChunks = 0, reusedChunks = 0;
  try {
    options.onPhase?.("detecting");
    options.onProgress?.(0, chunks.length);
    for (const [i, chunk] of chunks.entries()) {
      if (controller.signal.aborted) throw new AdditionalDetectionError();
      const segment = new AbortController();
      const abortSegment = () => segment.abort();
      controller.signal.addEventListener("abort", abortSegment, { once: true });
      const deadline = setTimeout(abortSegment, options.chunkTimeoutMs ?? PROMPT_CONFIG.chunkTimeoutMs);
      try {
        let raw = reuse ? responses.get(chunk.text) : undefined;
        if (raw === undefined) {
          raw = await abortable(session.extract(chunk.text, segment.signal), segment.signal);
          inferredChunks++;
        } else reusedChunks++;
        const result = (options.validateResponse ?? validateAdditionalResponse)(raw, chunk);
        if (reuse && result.rejected.length === 0) responses.set(chunk.text, raw);
        candidates.push(...result.candidates); rejected.push(...result.rejected);
        if (candidates.reduce((n, c) => n + c.ranges.length, 0) > PROMPT_CONFIG.maxEvidenceRanges || combineAdditionalCandidates(candidates).length > PROMPT_CONFIG.maxTotalCandidates) throw new AdditionalDetectionError();
        options.onProgress?.(i + 1, chunks.length);
      } finally { clearTimeout(deadline); controller.signal.removeEventListener("abort", abortSegment); segment.abort(); }
    }
    if (controller.signal.aborted) throw new AdditionalDetectionError();
    return { candidates: combineAdditionalCandidates(candidates), rejected, elapsedMs: performance.now() - started, preparationMs, inferredChunks, reusedChunks };
  } finally { responses.clear(); clearTimeout(timer); options.signal.removeEventListener("abort", abort); session.destroy(); }
}
