import type {
  DetectionSource,
  MaskCategory,
  MaskEntry,
} from "../types";
import { normalizeText } from "../normalization/normalizeText";
import { countOccurrences } from "../mask/findOccurrences";
import { createMaskToken } from "../mask/tokenFactory";

export type DetectionCandidate = {
  originalText: string;
  category: MaskCategory;
  source: DetectionSource;
  start?: number;
  end?: number;
  confidence?: number;
};

export function mergeCandidates(params: {
  originalText: string;
  entries: MaskEntry[];
  candidates: DetectionCandidate[];
  createId: () => string;
}): MaskEntry[] {
  const nextEntries = params.entries.map((entry) => ({
    ...entry,
    sources: [...entry.sources],
  }));

  for (const candidate of params.candidates) {
    const normalizedText = normalizeText(candidate.originalText);

    if (normalizedText.trim().length === 0) {
      continue;
    }

    const existing = nextEntries.find(
      (entry) => entry.normalizedText === normalizedText,
    );

    if (existing) {
      existing.sources = mergeSources(existing.sources, candidate.source);
      existing.confidence = maxConfidence(existing.confidence, candidate.confidence);
      existing.occurrenceCount = countOccurrences(
        params.originalText,
        existing.originalText,
      );
      continue;
    }

    nextEntries.push({
      id: params.createId(),
      originalText: normalizedText,
      normalizedText,
      token: createMaskToken(candidate.category, {
        originalText: params.originalText,
        entries: nextEntries,
      }),
      category: candidate.category,
      sources: [candidate.source],
      confidence: candidate.confidence,
      enabled: false,
      occurrenceCount: countOccurrences(params.originalText, normalizedText),
      reviewStatus: "unreviewed",
      displayOrder: nextEntries.length,
    });
  }

  return nextEntries;
}

function mergeSources(
  sources: DetectionSource[],
  source: DetectionSource,
): DetectionSource[] {
  return sources.includes(source) ? sources : [...sources, source];
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
