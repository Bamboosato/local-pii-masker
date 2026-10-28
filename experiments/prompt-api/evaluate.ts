import { runRegexDetection } from "../../src/domain/detection/regex/runRegexDetection";
import { runNerDetection } from "../../src/domain/detection/ner/runNerDetection";
import { enrichPersonCandidates } from "../../src/domain/detection/enrichPersonCandidates";
import { refineDetectionCandidates } from "../../src/domain/detection/refineDetectionCandidates";
import { extendHonorificCandidates } from "../../src/domain/detection/extendHonorificCandidates";
import { mergeCandidates, type DetectionCandidate } from "../../src/domain/detection/mergeCandidates";
import { runAdditionalDetection } from "../../src/domain/detection/prompt/run";
import { classifyAdditionalCandidates } from "../../src/domain/detection/prompt/validation";
import { buildMaskSegments } from "../../src/domain/mask/maskText";
import { type MaskEntry, FIXED_OCCURRENCE_MASKING_MODE } from "../../src/domain/types";
import type { EvaluatedEntity, EvaluationDocument } from "../../scripts/ner-evaluation/evaluation";

export function scoreSets(expected: string[], actual: string[]) {
  const gold = new Set(expected), found = new Set(actual);
  const tp = [...found].filter((key) => gold.has(key)).length;
  return { tp, fp: found.size - tp, fn: gold.size - tp };
}
export function scoreFinalMask(document: EvaluationDocument, entries: MaskEntry[], evidence: EvaluatedEntity[]) {
  const covered = new Set<number>(), gold = new Set<number>();
  for (const entity of document.entities) for (let i = entity.start; i < entity.end; i++) gold.add(i);
  let cursor = 0, falseMaskRanges = 0, falseMaskCharacters = 0;
  for (const segment of buildMaskSegments(document.text, entries, FIXED_OCCURRENCE_MASKING_MODE)) {
    const width = segment.type === "text" ? segment.value.length : entries.find((entry) => entry.id === segment.entryId)!.normalizedText.length;
    if (segment.type === "token") {
      let outside = 0;
      for (let i = cursor; i < cursor + width; i++) { covered.add(i); if (!gold.has(i)) outside++; }
      if (outside) falseMaskRanges++;
      falseMaskCharacters += outside;
    }
    cursor += width;
  }
  const missing = document.entities.filter((entity) => Array.from({ length: entity.end - entity.start }, (_, i) => entity.start + i).some((i) => !covered.has(i))).length;
  const key = (entity: EvaluatedEntity, position: boolean) => JSON.stringify(position ? [entity.category, entity.start, entity.end] : [entity.category, entity.text]);
  const score = (position: boolean, category?: string) => {
    const actual = position ? evidence : entries.filter((entry) => entry.enabled && entry.reviewStatus === "approved" && ["PERSON", "ADDRESS", "ORGANIZATION"].includes(entry.category)).map((entry) => ({ text: entry.originalText, category: entry.category as EvaluatedEntity["category"], start: 0, end: 0 }));
    return scoreSets(document.entities.filter((e) => !category || e.category === category).map((e) => key(e, position)), actual.filter((e) => !category || e.category === category).map((e) => key(e, position)));
  };
  return { strings: score(false), positions: score(true), categories: Object.fromEntries(["PERSON", "ADDRESS", "ORGANIZATION"].map((c) => [c, score(true, c)])), missing, leakingDocument: missing > 0, positiveDocument: document.entities.length > 0, falseMaskRanges, falseMaskCharacters };
}
export async function evaluateDocument(document: EvaluationDocument, signal: AbortSignal, progress: (message: string) => void) {
  const started = performance.now();
  const regex = runRegexDetection(document.text);
  const nerStarted = performance.now();
  let ner: DetectionCandidate[] = [], baselineComplete = true;
  try { ner = await runNerDetection(document.text, { signal }); } catch { if (signal.aborted) throw new Error("中止"); baselineComplete = false; }
  const nerMs = performance.now() - nerStarted;
  const pipeline = (values: DetectionCandidate[]) => extendHonorificCandidates(document.text, refineDetectionCandidates(document.text, enrichPersonCandidates(document.text, values)));
  const makeEntries = (candidates: DetectionCandidate[], entries: MaskEntry[] = []) => { let n = entries.length; return mergeCandidates({ originalText: document.text, candidates, entries, createId: () => `evaluation-${++n}` }); };
  const aCandidates = pipeline([...regex, ...ner]);
  const a = makeEntries(aCandidates), cBase = makeEntries(pipeline(regex));
  progress("Gemini Nano追加抽出中");
  let additional: Awaited<ReturnType<typeof runAdditionalDetection>> | undefined;
  let additionalComplete = baselineComplete;
  if (baselineComplete) try { additional = await runAdditionalDetection(document.text, { signal }); } catch { if (signal.aborted) throw new Error("中止"); additionalComplete = false; }
  let cAdditional: typeof additional;
  let cComplete = true;
  progress("Gemini Nano置換参考抽出中");
  try { cAdditional = await runAdditionalDetection(document.text, { signal }); } catch { if (signal.aborted) throw new Error("中止"); cComplete = false; }
  const plus = (base: MaskEntry[], result: typeof additional) => classifyAdditionalCandidates(result?.candidates ?? [], base).filter((c) => c.status === "new");
  const bNew = plus(a, additional), cNew = plus(cBase, cAdditional);
  const toCandidates = (values: typeof bNew): DetectionCandidate[] => values.map((c) => ({ originalText: c.text, category: c.category, source: "prompt-api" }));
  // Normal B cannot run after a baseline failure: report the actual A fallback.
  const b = baselineComplete && additionalComplete ? makeEntries(toCandidates(bNew), a) : a;
  const c = cComplete ? makeEntries(toCandidates(cNew), cBase) : cBase;
  const positionalEvidence = (values: DetectionCandidate[]): EvaluatedEntity[] => values.flatMap((value) => value.start !== undefined && value.end !== undefined && ["PERSON", "ADDRESS", "ORGANIZATION"].includes(value.category) ? [{ text: value.originalText, category: value.category as EvaluatedEntity["category"], start: value.start, end: value.end }] : []);
  const additionalEvidence = (values: typeof bNew): EvaluatedEntity[] => values.flatMap((value) => value.ranges.map((range) => ({ text: value.text, category: value.category, start: range.start, end: range.end })));
  const ae = positionalEvidence(aCandidates), ce = positionalEvidence(pipeline(regex));
  return { documentId: document.id, baselineComplete, additionalComplete, bComplete: baselineComplete && additionalComplete, cComplete, nerMs, additionalMs: additional?.elapsedMs, preparationMs: additional?.preparationMs, cAdditionalMs: cAdditional?.elapsedMs, cPreparationMs: cAdditional?.preparationMs, elapsedMs: performance.now() - started, rejected: additional?.rejected ?? [], cRejected: cAdditional?.rejected ?? [], newCandidates: bNew.length,
    A: scoreFinalMask(document, a, ae), B: scoreFinalMask(document, b, baselineComplete && additionalComplete ? [...ae, ...additionalEvidence(bNew)] : ae), C: scoreFinalMask(document, c, [...ce, ...additionalEvidence(cNew)]),
    cRules: "NER依存補完はNER入力なしで実行。Regex起点のenrich/refine/honorificのみ。C失敗時はRegexのみ参考値。",
  };
}
