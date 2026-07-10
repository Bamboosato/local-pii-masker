import type { AppState, EntryFilter } from "./reducer";
import { inspectTokens } from "../domain/mask/inspectTokens";
import { maskText } from "../domain/mask/maskText";
import { restoreText } from "../domain/mask/restoreText";
import type { MaskEntry } from "../domain/types";

export function selectActiveEntries(entries: MaskEntry[]): MaskEntry[] {
  return entries.filter(
    (entry) => entry.enabled && entry.reviewStatus === "approved",
  );
}

export function selectMaskedText(state: AppState): string {
  return maskText(state.originalText, state.entries);
}

export function selectRestoredResponse(state: AppState): string {
  return restoreText(state.externalResponse, selectActiveEntries(state.entries));
}

export function selectTokenInspection(state: AppState) {
  return inspectTokens(state.externalResponse, selectActiveEntries(state.entries));
}

export function selectVisibleEntries(state: AppState): MaskEntry[] {
  const query = state.entrySearch.trim().toLocaleLowerCase("ja");

  return state.entries.filter((entry) => {
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
  });
}

export function selectReplacementCount(state: AppState): number {
  return selectActiveEntries(state.entries).reduce(
    (sum, entry) => sum + entry.occurrenceCount,
    0,
  );
}

export function selectSessionCounts(state: AppState) {
  const activeEntries = selectActiveEntries(state.entries);
  const unreviewed = state.entries.filter(
    (entry) => entry.reviewStatus === "unreviewed",
  );
  const zeroOccurrence = state.entries.filter(
    (entry) => entry.occurrenceCount === 0,
  );

  return {
    activeEntries: activeEntries.length,
    replacements: activeEntries.reduce(
      (sum, entry) => sum + entry.occurrenceCount,
      0,
    ),
    unreviewed: unreviewed.length,
    zeroOccurrence: zeroOccurrence.length,
  };
}

function matchesFilter(entry: MaskEntry, filter: EntryFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unreviewed":
      return entry.reviewStatus === "unreviewed";
    case "approved":
      return entry.reviewStatus === "approved" && entry.enabled;
    case "zero":
      return entry.occurrenceCount === 0;
    default:
      return true;
  }
}
