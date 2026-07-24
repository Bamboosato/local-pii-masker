import type { AppState, EntryFilter } from "./reducer";
import { inspectTokens } from "../domain/mask/inspectTokens";
import { maskText } from "../domain/mask/maskText";
import { countMaskableOccurrences } from "../domain/mask/contextualMasking";
import { restoreText } from "../domain/mask/restoreText";
import type { MaskEntry } from "../domain/types";

export function selectActiveEntries(entries: MaskEntry[]): MaskEntry[] {
  return entries.filter(
    (entry) => entry.enabled && entry.reviewStatus === "approved",
  );
}

export function selectMaskedText(state: AppState): string {
  return maskText(state.originalText, state.entries, state.occurrenceMaskingMode);
}

export function selectMaskableOccurrenceCount(
  state: AppState,
  entry: MaskEntry,
): number {
  if (!entry.enabled || entry.reviewStatus !== "approved") {
    return 0;
  }

  return countMaskableOccurrences(
    state.originalText,
    entry,
    state.occurrenceMaskingMode,
  );
}

export function selectRestoredResponse(state: AppState): string {
  return restoreText(state.externalResponse, selectActiveEntries(state.entries));
}

export function selectTokenInspection(state: AppState) {
  return inspectTokens(state.externalResponse, selectActiveEntries(state.entries));
}

export function selectVisibleEntries(state: AppState): MaskEntry[] {
  const query = state.entrySearch.trim().toLocaleLowerCase("ja");

  return state.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      if (!matchesFilter(entry, state.entryFilter)) {
        return false;
      }

      if (query.length === 0) {
        return true;
      }

      return (
        entry.originalText.toLocaleLowerCase("ja").includes(query) ||
        entry.token.toLocaleLowerCase("ja").includes(query)
      );
    })
    .sort((a, b) => compareEntriesForReview(a, b, state.originalText))
    .map(({ entry }) => entry);
}

export function selectReplacementCount(state: AppState): number {
  return selectActiveEntries(state.entries).reduce(
    (sum, entry) =>
      sum +
      countMaskableOccurrences(
        state.originalText,
        entry,
        state.occurrenceMaskingMode,
      ),
    0,
  );
}

export function selectSessionCounts(state: AppState) {
  const activeEntries = selectActiveEntries(state.entries);
  const disabledEntries = state.entries.filter((entry) => !entry.enabled);
  const zeroOccurrence = state.entries.filter(
    (entry) => entry.occurrenceCount === 0,
  );

  return {
    activeEntries: activeEntries.length,
    replacements: activeEntries.reduce(
      (sum, entry) =>
        sum +
        countMaskableOccurrences(
          state.originalText,
          entry,
          state.occurrenceMaskingMode,
        ),
      0,
    ),
    totalEntries: state.entries.length,
    disabledEntries: disabledEntries.length,
    zeroOccurrence: zeroOccurrence.length,
  };
}

function matchesFilter(entry: MaskEntry, filter: EntryFilter): boolean {
  switch (filter) {
    case "enabled":
      return entry.enabled;
    case "disabled":
      return !entry.enabled;
    default:
      return true;
  }
}

function compareEntriesForReview(
  a: { entry: MaskEntry; index: number },
  b: { entry: MaskEntry; index: number },
  originalText: string,
): number {
  const isManualA = a.entry.sources.includes("manual");
  const isManualB = b.entry.sources.includes("manual");

  if (isManualA !== isManualB) {
    return isManualA ? -1 : 1;
  }

  const manualOrderA = a.entry.manuallyPromotedAt ?? 0;
  const manualOrderB = b.entry.manuallyPromotedAt ?? 0;

  if (manualOrderA !== manualOrderB) {
    return manualOrderB - manualOrderA;
  }

  if (isManualA && isManualB) {
    return getStableDisplayOrder(a) - getStableDisplayOrder(b);
  }

  const positionA = getFirstOccurrencePosition(originalText, a.entry.originalText);
  const positionB = getFirstOccurrencePosition(originalText, b.entry.originalText);

  if (positionA !== positionB) {
    return positionA - positionB;
  }

  if (a.entry.originalText.length !== b.entry.originalText.length) {
    return b.entry.originalText.length - a.entry.originalText.length;
  }

  return getStableDisplayOrder(a) - getStableDisplayOrder(b);
}

function getFirstOccurrencePosition(
  originalText: string,
  entryText: string,
): number {
  const index = originalText.indexOf(entryText);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function getStableDisplayOrder(value: {
  entry: MaskEntry;
  index: number;
}): number {
  return Number.isFinite(value.entry.displayOrder)
    ? value.entry.displayOrder
    : value.index;
}
