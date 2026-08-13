import type {
  DetectionSource,
  MaskCategory,
  OccurrenceMaskingMode,
} from "../types";

export const MASK_MAPPING_FORMAT = "local-pii-masker-mask-mapping" as const;
export const MASK_MAPPING_FORMAT_VERSION = 1 as const;
export const MASK_MAPPING_SCHEMA_VERSION = 1 as const;

export type PersistedMaskMappingEntry = {
  id: string;
  targetText: string;
  normalizedTargetText: string;
  token: string;
  restorationText: string;
  category: MaskCategory;
  sources: DetectionSource[];
  relationId?: string;
  manual: boolean;
};

export type MaskMapping = {
  schemaVersion: typeof MASK_MAPPING_SCHEMA_VERSION;
  mappingId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  occurrenceMaskingMode: OccurrenceMaskingMode;
  entries: PersistedMaskMappingEntry[];
};

export type MaskMappingIndexEntry = {
  mappingId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  fileName: string;
  formatVersion: typeof MASK_MAPPING_FORMAT_VERSION;
  revision: number;
};

export type MaskMappingIndex = MaskMappingIndexEntry[];

export type LoadedMaskMapping = Pick<
  MaskMapping,
  "mappingId" | "name" | "createdAt" | "updatedAt" | "revision"
> & {
  fingerprint: string;
};

export type MaskMappingStorageState = {
  mapping?: LoadedMaskMapping;
};

