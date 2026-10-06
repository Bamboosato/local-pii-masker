import {
  FIXED_OCCURRENCE_MASKING_MODE,
  MASK_CATEGORIES,
  type DetectionSource,
  type MaskCategory,
} from "../types";
import { normalizeText } from "../normalization/normalizeText";
import { isMaskToken } from "../mask/tokenFactory";
import {
  MASK_MAPPING_SCHEMA_VERSION,
  type MaskMapping,
  type PersistedMaskMappingEntry,
} from "./types";

const DETECTION_SOURCES: DetectionSource[] = ["regex", "ner", "manual"];
const MAX_MAPPING_ENTRIES = 10_000;

export class MaskMappingValidationError extends Error {
  constructor(message = "マスク対応表の形式が不正です。") {
    super(message);
    this.name = "MaskMappingValidationError";
  }
}

export function parseMaskMapping(value: unknown): MaskMapping {
  if (!isRecord(value)) {
    throw new MaskMappingValidationError();
  }

  if (value.schemaVersion !== MASK_MAPPING_SCHEMA_VERSION) {
    throw new MaskMappingValidationError("対応表のバージョンに対応していません。");
  }

  const mapping: MaskMapping = {
    schemaVersion: MASK_MAPPING_SCHEMA_VERSION,
    mappingId: readIdentifier(value.mappingId),
    name: readName(value.name),
    createdAt: readTimestamp(value.createdAt),
    updatedAt: readTimestamp(value.updatedAt),
    revision: readRevision(value.revision),
    occurrenceMaskingMode: readMaskingMode(value.occurrenceMaskingMode),
    entries: readEntries(value.entries),
  };

  validateMappingUniqueness(mapping.entries);
  return mapping;
}

export function validateMappingForCurrentMode(mapping: MaskMapping): void {
  if (mapping.occurrenceMaskingMode !== FIXED_OCCURRENCE_MASKING_MODE) {
    throw new MaskMappingValidationError(
      "この対応表のマスク方式は現在のアプリでは利用できません。",
    );
  }
}

export function validateMappingUniqueness(
  entries: PersistedMaskMappingEntry[],
): void {
  const targets = new Set<string>();
  const tokens = new Set<string>();
  const ids = new Set<string>();

  for (const entry of entries) {
    const target = entry.normalizedTargetText;
    if (targets.has(target) || tokens.has(entry.token) || ids.has(entry.id)) {
      throw new MaskMappingValidationError("対応表のマスク対応が一意ではありません。");
    }
    // v1 cannot preserve the pre-association tokens/restoration strings.
    if (entry.relationId) {
      throw new MaskMappingValidationError("関連付けを解除してから対応表を保存してください。この形式では関連付けを保存できません。");
    }
    targets.add(target);
    tokens.add(entry.token);
    ids.add(entry.id);
  }
}

function readEntries(value: unknown): PersistedMaskMappingEntry[] {
  if (!Array.isArray(value) || value.length > MAX_MAPPING_ENTRIES) {
    throw new MaskMappingValidationError();
  }

  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new MaskMappingValidationError();
    }

    const targetText = readText(candidate.targetText);
    const normalizedTargetText = readText(candidate.normalizedTargetText);
    const normalized = normalizeText(targetText);

    if (
      normalizedTargetText !== normalized ||
      normalizedTargetText.trim().length === 0
    ) {
      throw new MaskMappingValidationError();
    }

    const sources = readSources(candidate.sources);
    const relationId = candidate.relationId === undefined
      ? undefined
      : readIdentifier(candidate.relationId);

    return {
      id: readIdentifier(candidate.id),
      targetText,
      normalizedTargetText,
      token: readToken(candidate.token),
      restorationText: readText(candidate.restorationText),
      category: readCategory(candidate.category),
      sources,
      ...(relationId ? { relationId } : {}),
      manual: candidate.manual === true,
    };
  });
}

function readIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new MaskMappingValidationError();
  }
  return value;
}

function readName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
    throw new MaskMappingValidationError("対応表名を入力してください。");
  }
  return value;
}

function readText(value: unknown): string {
  if (typeof value !== "string" || value.length > 100_000) {
    throw new MaskMappingValidationError();
  }
  return value;
}

function readToken(value: unknown): string {
  if (typeof value !== "string" || !isMaskToken(value) || value.length > 200) {
    throw new MaskMappingValidationError();
  }
  return value;
}

function readCategory(value: unknown): MaskCategory {
  if (!MASK_CATEGORIES.includes(value as MaskCategory)) {
    throw new MaskMappingValidationError();
  }
  return value as MaskCategory;
}

function readSources(value: unknown): DetectionSource[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((source) => !DETECTION_SOURCES.includes(source as DetectionSource))
  ) {
    throw new MaskMappingValidationError();
  }
  return [...new Set(value as DetectionSource[])];
}

function readTimestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new MaskMappingValidationError();
  }
  return value;
}

function readRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MaskMappingValidationError();
  }
  return value;
}

function readMaskingMode(value: unknown): MaskMapping["occurrenceMaskingMode"] {
  if (value !== FIXED_OCCURRENCE_MASKING_MODE) {
    throw new MaskMappingValidationError(
      "対応表のマスク方式が不正です。",
    );
  }
  return FIXED_OCCURRENCE_MASKING_MODE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
