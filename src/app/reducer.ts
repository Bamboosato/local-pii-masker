import type {
  MaskCategory,
  MaskEntry,
  MaskSession,
  ReviewStatus,
} from "../domain/types";
import type { DetectionCandidate } from "../domain/detection/mergeCandidates";
import { mergeCandidates } from "../domain/detection/mergeCandidates";
import { normalizeText } from "../domain/normalization/normalizeText";
import { countOccurrences } from "../domain/mask/findOccurrences";
import { createMaskToken } from "../domain/mask/tokenFactory";

export type TextView = "original" | "masked";
export type EntryFilter = "all" | "disabled";

export type AppState = MaskSession & {
  activeTextView: TextView;
  selectedEntryId?: string;
  entryFilter: EntryFilter;
  entrySearch: string;
  restoreExpanded: boolean;
  notice?: string;
};

export const initialAppState: AppState = {
  originalText: "",
  entries: [],
  externalResponse: "",
  activeTextView: "original",
  entryFilter: "all",
  entrySearch: "",
  restoreExpanded: false,
};

const MANUAL_PROMOTION_STEP = 1;

export type AppAction =
  | { type: "setOriginalText"; value: string }
  | { type: "setActiveTextView"; value: TextView }
  | { type: "setEntryFilter"; value: EntryFilter }
  | { type: "setEntrySearch"; value: string }
  | { type: "selectEntry"; id?: string }
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
      type: "setEntryReviewStatus";
      id: string;
      reviewStatus: ReviewStatus;
      enabled: boolean;
    }
  | { type: "toggleEntryEnabled"; id: string }
  | { type: "deleteEntry"; id: string }
  | { type: "setExternalResponse"; value: string }
  | { type: "setRestoreExpanded"; value: boolean }
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
      };

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
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.id === action.id
            ? {
                ...entry,
                enabled: !entry.enabled,
                reviewStatus: !entry.enabled || entry.reviewStatus === "unreviewed"
                  ? "approved"
                  : entry.reviewStatus,
              }
            : entry,
        ),
        selectedEntryId: action.id,
      };

    case "deleteEntry":
      return {
        ...state,
        entries: state.entries.filter((entry) => entry.id !== action.id),
        selectedEntryId:
          state.selectedEntryId === action.id ? undefined : state.selectedEntryId,
      };

    case "setExternalResponse":
      return { ...state, externalResponse: normalizeText(action.value) };

    case "setRestoreExpanded":
      return { ...state, restoreExpanded: action.value };

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
      entryFilter: "all",
      notice: "同じ文字列は既存の項目を更新しました。",
    };
  }

  const entry: MaskEntry = {
    id: value.id,
    originalText: normalizedText,
    normalizedText,
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
    entryFilter: "all",
    notice: "マスク対象に追加しました。",
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
