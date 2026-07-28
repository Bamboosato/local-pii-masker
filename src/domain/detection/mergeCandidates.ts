import type {
  DetectionSource,
  MaskCategory,
  MaskEntry,
} from "../types";
import { normalizeText } from "../normalization/normalizeText";
import type { DetectionNormalizationRule } from "../normalization/detection/types";
import { countOccurrences } from "../mask/findOccurrences";
import { createMaskToken } from "../mask/tokenFactory";

export type DetectionCandidate = {
  originalText: string;
  restorationText?: string;
  category: MaskCategory;
  source: DetectionSource;
  start?: number;
  end?: number;
  confidence?: number;
  normalizationRules?: DetectionNormalizationRule[];
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

    const occurrenceCount = countOccurrences(params.originalText, normalizedText);

    if (occurrenceCount === 0) {
      continue;
    }

    const existing = nextEntries.find(
      (entry) => entry.normalizedText === normalizedText,
    );

    if (existing) {
      const existingSources = [...existing.sources];
      existing.sources = mergeSources(existing.sources, candidate.source);
      existing.confidence = maxConfidence(existing.confidence, candidate.confidence);
      existing.occurrenceCount = occurrenceCount;

      if (candidate.normalizationRules?.length) {
        existing.normalizationRules = mergeNormalizationRules(
          existing.normalizationRules,
          candidate.normalizationRules,
        );
      }

      if (
        candidate.restorationText !== undefined &&
        shouldReplaceRestorationText(existing, existingSources, candidate)
      ) {
        existing.restorationText = normalizeText(candidate.restorationText);
      }

      if (existing.reviewStatus === "unreviewed") {
        existing.reviewStatus = "approved";
        existing.enabled = true;
      }

      continue;
    }

    nextEntries.push({
      id: params.createId(),
      originalText: normalizedText,
      normalizedText,
      restorationText: normalizeText(
        candidate.restorationText ?? candidate.originalText,
      ),
      token: createMaskToken(candidate.category, {
        originalText: params.originalText,
        entries: nextEntries,
      }),
      category: candidate.category,
      sources: [candidate.source],
      confidence: candidate.confidence,
      enabled: true,
      occurrenceCount,
      reviewStatus: "approved",
      displayOrder: nextEntries.length,
      ...(candidate.normalizationRules?.length
        ? { normalizationRules: [...candidate.normalizationRules] }
        : {}),
    });
  }

  return nextEntries;
}

function shouldReplaceRestorationText(
  existing: MaskEntry,
  existingSources: DetectionSource[],
  candidate: DetectionCandidate,
): boolean {
  if (existing.restorationText === existing.originalText) {
    return true;
  }

  return (
    sourcePriority(candidate.source) >
    Math.max(...existingSources.map(sourcePriority))
  );
}

function sourcePriority(source: DetectionSource): number {
  switch (source) {
    case "regex":
      return 3;
    case "ner":
      return 2;
    case "manual":
      return 1;
  }
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

function mergeNormalizationRules(
  current: DetectionNormalizationRule[] | undefined,
  next: DetectionNormalizationRule[],
): DetectionNormalizationRule[] {
  return [...new Set([...(current ?? []), ...next])];
}
