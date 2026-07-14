import type { DetectionCandidate } from "../mergeCandidates";
import { mapNerOutputsToCandidates } from "./mapNerOutputs";
import type { NerTokenClassificationOutput } from "./types";

export const NER_CHUNK_MAX_LENGTH = 320;
export const NER_CHUNK_OVERLAP = 64;

const PREFERRED_BOUNDARIES = new Set(["\n", "。", "！", "？", "!", "?"]);

export type NerTextChunk = {
  end: number;
  start: number;
  text: string;
};

export type TokenClassifier = (
  text: string,
  options: { aggregation_strategy: "simple" },
) => Promise<NerTokenClassificationOutput[]>;

export async function runChunkedNerDetection(
  sourceText: string,
  classifier: TokenClassifier,
): Promise<DetectionCandidate[]> {
  const merged = new Map<string, DetectionCandidate>();

  for (const chunk of splitTextForNer(sourceText)) {
    const outputs = await classifier(chunk.text, {
      aggregation_strategy: "simple",
    });
    const candidates = mapNerOutputsToCandidates(outputs, chunk.text);

    for (const candidate of candidates) {
      mergeCandidate(merged, addChunkOffset(candidate, chunk));
    }
  }

  return [...merged.values()];
}

export function splitTextForNer(
  sourceText: string,
  options: { maxLength?: number; overlap?: number } = {},
): NerTextChunk[] {
  const maxLength = options.maxLength ?? NER_CHUNK_MAX_LENGTH;
  const overlap = options.overlap ?? NER_CHUNK_OVERLAP;

  if (!Number.isInteger(maxLength) || maxLength < 2) {
    throw new RangeError("maxLength must be an integer of 2 or greater.");
  }

  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= maxLength) {
    throw new RangeError("overlap must be an integer from 0 to maxLength - 1.");
  }

  if (sourceText.length === 0) {
    return [];
  }

  const chunks: NerTextChunk[] = [];
  let start = 0;

  while (start < sourceText.length) {
    const hardEnd = Math.min(start + maxLength, sourceText.length);
    const minimumBoundary = start + Math.ceil(maxLength * 0.6);
    let end =
      hardEnd === sourceText.length
        ? hardEnd
        : findPreferredEnd(sourceText, minimumBoundary, hardEnd);
    end = avoidSplitSurrogatePair(sourceText, end);

    if (end <= start) {
      end = hardEnd;
    }

    chunks.push({
      end,
      start,
      text: sourceText.slice(start, end),
    });

    if (end >= sourceText.length) {
      break;
    }

    const nextStart = avoidSplitSurrogatePair(
      sourceText,
      Math.max(start + 1, end - overlap),
    );
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

function findPreferredEnd(
  sourceText: string,
  minimumBoundary: number,
  hardEnd: number,
): number {
  for (let index = hardEnd; index >= minimumBoundary; index -= 1) {
    if (PREFERRED_BOUNDARIES.has(sourceText[index - 1] ?? "")) {
      return index;
    }
  }

  return hardEnd;
}

function avoidSplitSurrogatePair(sourceText: string, position: number): number {
  if (
    position > 0 &&
    position < sourceText.length &&
    isHighSurrogate(sourceText.charCodeAt(position - 1)) &&
    isLowSurrogate(sourceText.charCodeAt(position))
  ) {
    return position - 1;
  }

  return position;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function addChunkOffset(
  candidate: DetectionCandidate,
  chunk: NerTextChunk,
): DetectionCandidate {
  const localStart =
    candidate.start !== undefined
      ? candidate.start
      : chunk.text.indexOf(candidate.originalText);
  const localEnd =
    candidate.end !== undefined
      ? candidate.end
      : localStart + candidate.originalText.length;

  if (
    localStart < 0 ||
    localEnd <= localStart ||
    localEnd > chunk.text.length
  ) {
    return candidate;
  }

  return {
    ...candidate,
    start: chunk.start + localStart,
    end: chunk.start + localEnd,
  };
}

function mergeCandidate(
  merged: Map<string, DetectionCandidate>,
  candidate: DetectionCandidate,
) {
  const key = [candidate.category, candidate.originalText].join("\u0000");
  const existing = merged.get(key);

  if (!existing) {
    merged.set(key, candidate);
    return;
  }

  const confidence = maxConfidence(existing.confidence, candidate.confidence);

  if (
    candidate.start !== undefined &&
    (existing.start === undefined || candidate.start < existing.start)
  ) {
    merged.set(key, { ...candidate, confidence });
    return;
  }

  merged.set(key, { ...existing, confidence });
}

function maxConfidence(
  current: number | undefined,
  next: number | undefined,
): number | undefined {
  if (current === undefined) {
    return next;
  }

  if (next === undefined) {
    return current;
  }

  return Math.max(current, next);
}
