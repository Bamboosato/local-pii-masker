import type {
  MaskCategory,
  MaskEntry,
  MaskSession,
  ReviewStatus,
} from "../domain/types";
import { FIXED_OCCURRENCE_MASKING_MODE } from "../domain/types";
import type { DetectionCandidate } from "../domain/detection/mergeCandidates";
import { mergeCandidates } from "../domain/detection/mergeCandidates";
import { normalizeText } from "../domain/normalization/normalizeText";
import { countOccurrences } from "../domain/mask/findOccurrences";
import { createMaskToken } from "../domain/mask/tokenFactory";
import type { LoadedMaskMapping, MaskMapping } from "../domain/mapping/types";
import { reapplyMaskMapping } from "../domain/mapping/reapply";
import { createMaskMappingFingerprint } from "../domain/mapping/snapshot";

export type TextView = "original" | "masked";
export type EntryFilter = "enabled" | "disabled";
export type NormalizationLockReason =
  | "detection_completed"
  | "candidate_registered";

export type AppState = MaskSession & {
  activeTextView: TextView;
  selectedEntryId?: string;
  selectedEntryIds: string[];
  entryFilter: EntryFilter;
  entrySearch: string;
  restoreExpanded: boolean;
  originalRevision: number;
  normalizationLockReason?: NormalizationLockReason;
  notice?: string;
  mapping?: LoadedMaskMapping;
};

export const initialAppState: AppState = {
  originalText: "",
  entries: [],
  externalResponse: "",
  occurrenceMaskingMode: FIXED_OCCURRENCE_MASKING_MODE,
  activeTextView: "original",
  selectedEntryIds: [],
  entryFilter: "enabled",
  entrySearch: "",
  restoreExpanded: false,
  originalRevision: 0,
};

const MANUAL_PROMOTION_STEP = 1;

export type AppAction =
  | { type: "setOriginalText"; value: string }
  | {
      type: "applyNormalizedOriginal";
      value: string;
      expectedRevision: number;
    }
  | { type: "setActiveTextView"; value: TextView }
  | { type: "setEntryFilter"; value: EntryFilter }
  | { type: "setEntrySearch"; value: string }
  | { type: "selectEntry"; id?: string }
  | { type: "toggleEntrySelection"; id: string }
  | { type: "clearEntrySelection" }
  | {
      type: "addManualEntry";
      value: {
        id: string;
        selectedText: string;
        category: MaskCategory;
      };
    }
  | {
      type: "mergeDetectedCandidates";
      candidates: DetectionCandidate[];
      createId: () => string;
    }
  | {
      type: "completeDetection";
      candidates: DetectionCandidate[];
      createId: () => string;
      outcome: "success" | "failed" | "cancelled";
    }
  | {
      type: "setEntryReviewStatus";
      id: string;
      reviewStatus: ReviewStatus;
      enabled: boolean;
    }
  | { type: "toggleEntryEnabled"; id: string }
  | {
      type: "relateEntries";
      ids: string[];
      groupId: string;
      mode: "new" | "existing";
      restorationText?: string;
    }
  | { type: "unlinkRelatedEntry"; id: string }
  | { type: "unlinkRelatedGroup"; id: string }
  | { type: "deleteEntry"; id: string }
  | { type: "setExternalResponse"; value: string }
  | { type: "setRestoreExpanded"; value: boolean }
  | { type: "loadMaskMapping"; mapping: MaskMapping }
  | { type: "markMaskMappingSaved"; mapping: LoadedMaskMapping }
  | { type: "setNotice"; value?: string }
  | { type: "clearSession" };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "setOriginalText": {
      const originalText = normalizeText(action.value);

      return {
        ...state,
        originalText,
        entries: recalculateOccurrences(originalText, state.entries),
        originalRevision:
          originalText === state.originalText
            ? state.originalRevision
            : state.originalRevision + 1,
      };
    }

    case "applyNormalizedOriginal": {
      const originalText = normalizeText(action.value);
      if (
        action.expectedRevision !== state.originalRevision ||
        state.normalizationLockReason !== undefined ||
        state.entries.length > 0 ||
        originalText === state.originalText
      ) {
        return state;
      }

      return {
        ...state,
        originalText,
        originalRevision: state.originalRevision + 1,
        entries: [],
        activeTextView: "original",
        selectedEntryId: undefined,
        selectedEntryIds: [],
        entryFilter: "enabled",
        entrySearch: "",
        notice: "原文を正規化しました。マスク対象を検出してください。",
      };
    }

    case "setActiveTextView":
      return { ...state, activeTextView: action.value };

    case "setEntryFilter":
      return { ...state, entryFilter: action.value };

    case "setEntrySearch":
      return { ...state, entrySearch: action.value };

    case "selectEntry":
      return { ...state, selectedEntryId: action.id };

    case "toggleEntrySelection":
      return {
        ...state,
        selectedEntryIds: state.selectedEntryIds.includes(action.id)
          ? state.selectedEntryIds.filter((id) => id !== action.id)
          : [...state.selectedEntryIds, action.id],
      };

    case "clearEntrySelection":
      return { ...state, selectedEntryIds: [] };

    case "addManualEntry":
      return addManualEntry(state, action.value);

    case "mergeDetectedCandidates":
      return {
        ...state,
        entries: mergeCandidates({
          originalText: state.originalText,
          entries: state.entries,
          candidates: action.candidates,
          createId: action.createId,
        }),
        normalizationLockReason:
          state.normalizationLockReason ??
          (action.candidates.length > 0 ? "candidate_registered" : undefined),
      };

    case "completeDetection": {
      const entries = mergeCandidates({
        originalText: state.originalText,
        entries: state.entries,
        candidates: action.candidates,
        createId: action.createId,
      });
      const shouldLock = action.outcome === "success" || action.candidates.length > 0;

      return {
        ...state,
        entries,
        normalizationLockReason:
          state.normalizationLockReason ??
          (shouldLock
            ? action.outcome === "success"
              ? "detection_completed"
              : "candidate_registered"
            : undefined),
      };
    }

    case "setEntryReviewStatus":
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.id === action.id
            ? {
                ...entry,
                reviewStatus: action.reviewStatus,
                enabled: action.enabled,
              }
            : entry,
        ),
        selectedEntryId: action.id,
      };

    case "toggleEntryEnabled":
      return toggleEntryEnabled(state, action.id);

    case "relateEntries":
      return relateEntries(state, action);

    case "unlinkRelatedEntry":
      return unlinkRelatedEntry(state, action.id);

    case "unlinkRelatedGroup":
      return unlinkRelatedGroup(state, action.id);

    case "deleteEntry":
      return {
        ...state,
        entries: state.entries.filter((entry) => entry.id !== action.id),
        selectedEntryIds: state.selectedEntryIds.filter(
          (id) => id !== action.id,
        ),
        selectedEntryId:
          state.selectedEntryId === action.id ? undefined : state.selectedEntryId,
      };

    case "setExternalResponse":
      return { ...state, externalResponse: normalizeText(action.value) };

    case "setRestoreExpanded":
      return { ...state, restoreExpanded: action.value };

    case "loadMaskMapping": {
      const entries = reapplyMaskMapping(action.mapping, state.originalText);
      return {
        ...state,
        entries,
        mapping: {
          mappingId: action.mapping.mappingId,
          name: action.mapping.name,
          createdAt: action.mapping.createdAt,
          updatedAt: action.mapping.updatedAt,
          revision: action.mapping.revision,
          fingerprint: createMaskMappingFingerprint(
            entries,
            action.mapping.occurrenceMaskingMode,
          ),
        },
        activeTextView: "original",
        selectedEntryId: undefined,
        selectedEntryIds: [],
        entryFilter: "enabled",
        entrySearch: "",
        normalizationLockReason: "candidate_registered",
        notice: "保存済みの対応表を読み込みました。原文や処理結果は復元されません。",
      };
    }

    case "markMaskMappingSaved":
      return { ...state, mapping: action.mapping };

    case "setNotice":
      return { ...state, notice: action.value };

    case "clearSession":
      return { ...initialAppState };

    default:
      return state;
  }
}

function addManualEntry(
  state: AppState,
  value: { id: string; selectedText: string; category: MaskCategory },
): AppState {
  const normalizedText = normalizeText(value.selectedText);

  if (normalizedText.trim().length === 0) {
    return { ...state, notice: "空白だけの文字列は追加できません。" };
  }

  const existing = state.entries.find(
    (entry) => entry.normalizedText === normalizedText,
  );

  if (existing) {
    const nextManualOrder = getNextManualPromotionOrder(state.entries);

    return {
      ...state,
      entries: state.entries.map((entry) =>
        entry.id === existing.id
          ? {
              ...entry,
              category: value.category,
              enabled: true,
              reviewStatus: "approved",
              sources: entry.sources.includes("manual")
                ? entry.sources
                : [...entry.sources, "manual"],
              occurrenceCount: countOccurrences(state.originalText, entry.originalText),
              manuallyPromotedAt: nextManualOrder,
            }
          : entry,
      ),
      selectedEntryId: existing.id,
      entryFilter: "enabled",
      normalizationLockReason: "candidate_registered",
      notice: "同じ文字列は既存の項目を更新しました。",
    };
  }

  const entry: MaskEntry = {
    id: value.id,
    originalText: normalizedText,
    normalizedText,
    restorationText: normalizedText,
    token: createMaskToken(value.category, {
      originalText: state.originalText,
      entries: state.entries,
    }),
    category: value.category,
    sources: ["manual"],
    enabled: true,
    occurrenceCount: countOccurrences(state.originalText, normalizedText),
    reviewStatus: "approved",
    displayOrder: state.entries.length,
    manuallyPromotedAt: getNextManualPromotionOrder(state.entries),
  };

  return {
    ...state,
    entries: [entry, ...state.entries],
    selectedEntryId: entry.id,
    entryFilter: "enabled",
    normalizationLockReason: "candidate_registered",
    notice: "マスク対象に追加しました。",
  };
}

function relateEntries(
  state: AppState,
  action: Extract<AppAction, { type: "relateEntries" }>,
): AppState {
  const selectedIds = [...new Set(action.ids)];
  const selectedEntries = state.entries.filter((entry) =>
    selectedIds.includes(entry.id),
  );

  if (selectedEntries.length === 0) {
    return {
      ...state,
      notice: "同一人物として関連付ける対象を選択してください。",
    };
  }

  if (action.mode === "new" && selectedEntries.length < 2) {
    return {
      ...state,
      notice: "新しい関連付けには2件以上選択してください。",
    };
  }

  if (
    selectedEntries.some(
      (entry) =>
        entry.category !== "PERSON" ||
        !entry.enabled ||
        entry.reviewStatus !== "approved" ||
        entry.relatedGroupId !== undefined,
    )
  ) {
    return {
      ...state,
      notice: "有効な人名のマスク対象だけを関連付けできます。",
    };
  }

  if (state.externalResponse.trim().length > 0) {
    return {
      ...state,
      notice: "復元する文章を空にしてから関連付けてください。",
    };
  }

  const restorationText = normalizeText(action.restorationText ?? "").trim();
  const selectedIdSet = new Set(selectedIds);
  const primaryEntry = state.entries.find((entry) => entry.id === selectedIds[0]);

  if (!primaryEntry) {
    return state;
  }

  const existingGroupEntries = state.entries.filter(
    (entry) => entry.relatedGroupId === action.groupId,
  );
  if (action.mode === "existing" && existingGroupEntries.length === 0) {
    return {
      ...state,
      notice: "追加先の関連付けを選択してください。",
    };
  }

  const groupReference = existingGroupEntries[0];
  const nextRestorationText =
    action.mode === "existing"
      ? groupReference?.restorationText ?? ""
      : restorationText;
  if (
    action.mode === "new" &&
    (nextRestorationText.length === 0 || nextRestorationText.includes("\n"))
  ) {
    return {
      ...state,
      notice: "復元時の代表表記を入力してください。",
    };
  }
  const nextToken = groupReference?.token ?? primaryEntry.token;

  return {
    ...state,
    entries: state.entries.map((entry) =>
      selectedIdSet.has(entry.id)
        ? {
            ...entry,
            relatedGroupId: action.groupId,
            relatedOriginalRestorationText: entry.restorationText,
            relatedOriginalToken: entry.token,
            restorationText: nextRestorationText,
            token: nextToken,
          }
        : entry,
    ),
    selectedEntryId: primaryEntry.id,
    selectedEntryIds: [],
    notice:
      action.mode === "existing"
        ? `${selectedEntries.length}件を既存の関連付けへ追加しました。`
        : `${selectedEntries.length}件を同一人物として関連付けました。`,
  };
}

function toggleEntryEnabled(state: AppState, entryId: string): AppState {
  const target = state.entries.find((entry) => entry.id === entryId);

  if (!target) {
    return state;
  }

  const nextEnabled = !target.enabled;

  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.id === entryId ||
      (target.relatedGroupId !== undefined &&
        entry.relatedGroupId === target.relatedGroupId)
        ? {
            ...entry,
            enabled: nextEnabled,
            reviewStatus:
              nextEnabled || entry.reviewStatus === "unreviewed"
                ? "approved"
                : entry.reviewStatus,
          }
        : entry,
    ),
    selectedEntryId: entryId,
  };
}

function unlinkRelatedEntry(state: AppState, entryId: string): AppState {
  return unlinkRelatedEntries(state, entryId, "entry");
}

function unlinkRelatedGroup(state: AppState, entryId: string): AppState {
  return unlinkRelatedEntries(state, entryId, "group");
}

function unlinkRelatedEntries(
  state: AppState,
  entryId: string,
  scope: "entry" | "group",
): AppState {
  const target = state.entries.find((entry) => entry.id === entryId);

  if (!target?.relatedGroupId) {
    return state;
  }

  if (state.externalResponse.trim().length > 0) {
    return {
      ...state,
      notice: "復元する文章を空にしてから関連付けを解除してください。",
    };
  }

  const groupEntries = state.entries.filter(
    (entry) => entry.relatedGroupId === target.relatedGroupId,
  );
  const shouldBreakGroup = scope === "group" || groupEntries.length <= 2;
  const entriesToUnlink = new Set(
    shouldBreakGroup
      ? groupEntries.map((entry) => entry.id)
      : [entryId],
  );

  return {
    ...state,
    entries: state.entries.map((entry) => {
      if (entriesToUnlink.has(entry.id)) {
        return {
          ...entry,
          relatedGroupId: undefined,
          relatedOriginalRestorationText: undefined,
          relatedOriginalToken: undefined,
          restorationText:
            entry.relatedOriginalRestorationText ?? entry.restorationText,
          token:
            entry.relatedOriginalToken ??
            createMaskToken(entry.category, {
              originalText: state.originalText,
              entries: state.entries,
            }),
        };
      }

      return entry;
    }),
    selectedEntryId: entryId,
    notice:
      scope === "group"
        ? "同一人物の関連付けをすべて解除しました。"
        : "同一人物の関連付けを解除しました。",
  };
}

function recalculateOccurrences(
  originalText: string,
  entries: MaskEntry[],
): MaskEntry[] {
  return entries.map((entry) => ({
    ...entry,
    occurrenceCount: countOccurrences(originalText, entry.originalText),
  }));
}

function getNextManualPromotionOrder(entries: MaskEntry[]): number {
  return (
    entries.reduce(
      (maxOrder, entry) =>
        Math.max(maxOrder, entry.manuallyPromotedAt ?? 0),
      0,
    ) + MANUAL_PROMOTION_STEP
  );
}
