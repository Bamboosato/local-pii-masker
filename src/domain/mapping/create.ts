import type { MaskEntry, OccurrenceMaskingMode } from "../types";
import { createMaskMappingSnapshot } from "./snapshot";
import type { MaskMapping } from "./types";

export function createMaskMappingForSave(params: {
  existing?: Pick<MaskMapping, "mappingId" | "name" | "createdAt" | "revision">;
  name: string;
  entries: MaskEntry[];
  occurrenceMaskingMode: OccurrenceMaskingMode;
  now?: number;
}): MaskMapping {
  const now = params.now ?? Date.now();
  return createMaskMappingSnapshot({
    mappingId: params.existing?.mappingId ?? `mapping-${crypto.randomUUID()}`,
    name: params.name,
    createdAt: params.existing?.createdAt ?? now,
    updatedAt: now,
    revision: params.existing?.revision ?? 0,
    occurrenceMaskingMode: params.occurrenceMaskingMode,
    entries: params.entries,
  });
}

