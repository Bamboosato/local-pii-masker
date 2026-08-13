import { countOccurrences } from "../mask/findOccurrences";
import type { MaskEntry } from "../types";
import type { MaskMapping } from "./types";

export function reapplyMaskMapping(
  mapping: MaskMapping,
  originalText: string,
): MaskEntry[] {
  return mapping.entries.map((entry, index) => ({
    id: entry.id,
    originalText: entry.targetText,
    normalizedText: entry.normalizedTargetText,
    restorationText: entry.restorationText,
    token: entry.token,
    ...(entry.relationId ? { relatedGroupId: entry.relationId } : {}),
    category: entry.category,
    sources: [...entry.sources],
    enabled: true,
    occurrenceCount: countOccurrences(originalText, entry.normalizedTargetText),
    reviewStatus: "approved",
    displayOrder: index,
  }));
}

