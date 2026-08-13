import type { MaskEntry, OccurrenceMaskingMode } from "../types";
import { normalizeText } from "../normalization/normalizeText";
import {
  MASK_MAPPING_SCHEMA_VERSION,
  type MaskMapping,
  type PersistedMaskMappingEntry,
} from "./types";
import { validateMappingUniqueness } from "./validate";

export function createMaskMappingSnapshot(params: {
  mappingId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  occurrenceMaskingMode: OccurrenceMaskingMode;
  entries: MaskEntry[];
}): MaskMapping {
  const snapshot: MaskMapping = {
    schemaVersion: MASK_MAPPING_SCHEMA_VERSION,
    mappingId: params.mappingId,
    name: params.name,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    revision: params.revision,
    occurrenceMaskingMode: params.occurrenceMaskingMode,
    entries: params.entries
      .filter((entry) => entry.enabled && entry.reviewStatus === "approved")
      .map(toPersistedEntry)
      .sort(comparePersistedEntries),
  };
  validateMappingUniqueness(snapshot.entries);
  return snapshot;
}

export function createMaskMappingFingerprint(
  entries: MaskEntry[],
  occurrenceMaskingMode: OccurrenceMaskingMode,
): string {
  const persistedEntries = entries
    .filter((entry) => entry.enabled && entry.reviewStatus === "approved")
    .map(toPersistedEntry)
    .sort(comparePersistedEntries);

  return JSON.stringify({ occurrenceMaskingMode, entries: persistedEntries });
}

function toPersistedEntry(entry: MaskEntry): PersistedMaskMappingEntry {
  return {
    id: entry.id,
    targetText: entry.originalText,
    normalizedTargetText: entry.normalizedText,
    token: entry.token,
    restorationText: entry.restorationText,
    category: entry.category,
    sources: [...entry.sources].sort(),
    ...(entry.relatedGroupId ? { relationId: entry.relatedGroupId } : {}),
    manual: entry.sources.includes("manual"),
  };
}

function comparePersistedEntries(
  a: PersistedMaskMappingEntry,
  b: PersistedMaskMappingEntry,
): number {
  return (
    a.normalizedTargetText.localeCompare(b.normalizedTargetText, "ja") ||
    a.token.localeCompare(b.token, "ja") ||
    a.id.localeCompare(b.id, "en")
  );
}

export function normalizeMappingEntryText(value: string): string {
  return normalizeText(value);
}
