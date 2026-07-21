import type {
  DocumentNormalizationRuleId,
  DocumentNormalizationResult,
  NormalizationPreview,
  PreviewSegment,
} from "./types";

export function buildNormalizationPreview(
  sourceText: string,
  result: DocumentNormalizationResult,
): NormalizationPreview {
  const beforeChanged = new Set<number>();
  for (const event of result.events) {
    for (let index = event.originalRange.start; index < event.originalRange.end; index += 1) {
      beforeChanged.add(index);
    }
  }

  const before: PreviewSegment[] = [];
  let currentBefore = "";
  let currentChanged = false;
  const flushBefore = () => {
    if (currentBefore.length > 0) {
      before.push({ text: currentBefore, changed: currentChanged, ruleIds: [] });
      currentBefore = "";
    }
  };
  for (let index = 0; index < sourceText.length; index += 1) {
    const changed = beforeChanged.has(index);
    if (currentBefore.length > 0 && currentChanged !== changed) {
      flushBefore();
    }
    currentChanged = changed;
    currentBefore += sourceText[index];
  }
  flushBefore();

  const after: PreviewSegment[] = [];
  let currentAfter = "";
  let currentAfterChanged = false;
  let currentRuleIds: DocumentNormalizationRuleId[] = [];
  const flushAfter = () => {
    if (currentAfter.length > 0) {
      after.push({
        text: currentAfter,
        changed: currentAfterChanged,
        ruleIds: [...currentRuleIds],
      });
      currentAfter = "";
    }
  };
  for (const [index, mapping] of result.mappings.entries()) {
    const changed = mapping.changed;
    const rules = mapping.ruleIds.join(",");
    if (
      currentAfter.length > 0 &&
      (currentAfterChanged !== changed || currentRuleIds.join(",") !== rules)
    ) {
      flushAfter();
    }
    currentAfterChanged = changed;
    currentRuleIds = [...mapping.ruleIds];
    currentAfter += result.normalizedText[index] ?? "";
  }
  flushAfter();

  return { before, after };
}
