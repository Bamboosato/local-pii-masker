import { mapNormalizedRange } from "../../normalization/detection/mapNormalizedRange";
import { normalizeForDetection } from "../../normalization/detection/normalizeForDetection";
import type { DetectionCandidate } from "../mergeCandidates";
import {
  runChunkedNerDetection,
  type TokenClassifier,
} from "./runChunkedNerDetection";

export async function runNormalizedNerDetection(
  sourceText: string,
  classifier: TokenClassifier,
): Promise<DetectionCandidate[]> {
  const normalized = normalizeForDetection(sourceText, [
    "japanese_inter_character_space",
    "person_name_line_break",
    "organization_line_break",
  ]);
  const candidates = await runChunkedNerDetection(normalized.text, classifier);

  const expandedCandidates = candidates.flatMap((candidate) => {
    const normalizedStart =
      candidate.start ?? normalized.text.indexOf(candidate.originalText);
    const normalizedEnd =
      candidate.end ?? normalizedStart + candidate.originalText.length;
    const occurrences = findExactOccurrences(
      normalized.text,
      candidate.originalText,
    );
    const ranges =
      occurrences.length > 0
        ? occurrences
        : [{ start: normalizedStart, end: normalizedEnd }];

    return ranges.flatMap((range) => {
      const originalRange = mapNormalizedRange(normalized, range);

      if (!originalRange) {
        return [];
      }

      const normalizationRules = [
        ...new Set(
          normalized.appliedRules
            .filter(
              (event) =>
                event.normalizedStart < range.end &&
                range.start < event.normalizedEnd,
            )
            .map((event) => event.rule),
        ),
      ];

      return [
        {
          ...candidate,
          restorationText: normalized.text.slice(range.start, range.end),
          originalText: sourceText.slice(originalRange.start, originalRange.end),
          start: originalRange.start,
          end: originalRange.end,
          ...(normalizationRules.length > 0 ? { normalizationRules } : {}),
        },
      ];
    });
  });

  return mergeExpandedCandidates(expandedCandidates);
}

function findExactOccurrences(
  text: string,
  target: string,
): Array<{ start: number; end: number }> {
  if (target.length === 0) {
    return [];
  }

  const occurrences: Array<{ start: number; end: number }> = [];
  let searchStart = 0;

  while (searchStart <= text.length) {
    const start = text.indexOf(target, searchStart);

    if (start === -1) {
      break;
    }

    occurrences.push({ start, end: start + target.length });
    searchStart = start + target.length;
  }

  return occurrences;
}

function mergeExpandedCandidates(
  candidates: DetectionCandidate[],
): DetectionCandidate[] {
  const merged = new Map<string, DetectionCandidate>();

  for (const candidate of candidates) {
    const key = [
      candidate.category,
      candidate.start ?? -1,
      candidate.end ?? -1,
      candidate.originalText,
    ].join("\u0000");
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, candidate);
      continue;
    }

    const normalizationRules = mergeNormalizationRules(
      existing.normalizationRules,
      candidate.normalizationRules,
    );
    const confidence =
      existing.confidence === undefined
        ? candidate.confidence
        : candidate.confidence === undefined
          ? existing.confidence
          : Math.max(existing.confidence, candidate.confidence);

    merged.set(key, {
      ...existing,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(normalizationRules.length > 0 ? { normalizationRules } : {}),
    });
  }

  return [...merged.values()];
}

function mergeNormalizationRules(
  first: DetectionCandidate["normalizationRules"],
  second: DetectionCandidate["normalizationRules"],
) {
  return [...new Set([...(first ?? []), ...(second ?? [])])];
}
