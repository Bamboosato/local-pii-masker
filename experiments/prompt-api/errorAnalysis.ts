import type { EvaluationDocument, EvaluatedEntity } from "../../scripts/ner-evaluation/evaluation";
import type { MaskEntry } from "../../src/domain/types";
import { FIXED_OCCURRENCE_MASKING_MODE } from "../../src/domain/types";
import { buildMaskSegments } from "../../src/domain/mask/maskText";

const kinds = ["correct", "category", "boundary", "boundaryAndCategory", "nonEntity"] as const;
type Kind = typeof kinds[number];
const counts = () => Object.fromEntries(kinds.map((key) => [key, 0])) as Record<Kind, number>;
const overlaps = (a: EvaluatedEntity, b: EvaluatedEntity) => a.start < b.end && b.start < a.end;
function positionKind(actual: EvaluatedEntity, gold: EvaluationDocument["entities"]): Kind {
  const exact = gold.filter((e) => e.start === actual.start && e.end === actual.end);
  if (exact.some((e) => e.category === actual.category)) return "correct";
  if (exact.length) return "category";
  const intersecting = gold.filter((e) => overlaps(actual, e));
  if (intersecting.some((e) => e.category === actual.category)) return "boundary";
  return intersecting.length ? "boundaryAndCategory" : "nonEntity";
}
/** Counts only. Never export target strings, original text, or positions. */
export function analyzeErrors(document: EvaluationDocument, entries: MaskEntry[], evidence: EvaluatedEntity[]) {
  const strings = counts(), positions = counts(), masks = counts();
  const goldMisses = { category: 0, boundary: 0, boundaryAndCategory: 0, absent: 0 };
  const active = entries.filter((e) => e.enabled);
  for (const entry of active) {
    const exact = document.entities.filter((g) => g.text === entry.originalText);
    if (exact.some((g) => g.category === entry.category)) strings.correct++;
    else if (exact.length) strings.category++;
    else {
      const ranges = evidence.filter((e) => e.text === entry.originalText && e.category === entry.category);
      const types = ranges.map((e) => positionKind(e, document.entities));
      const kind = kinds.find((k) => k !== "correct" && types.includes(k));
      strings[kind ?? "nonEntity"]++;
    }
  }
  const unique = [...new Map(evidence.map((e) => [JSON.stringify([e.category, e.start, e.end]), e])).values()];
  for (const actual of unique) positions[positionKind(actual, document.entities)]++;
  for (const gold of document.entities) {
    if (unique.some((e) => e.start === gold.start && e.end === gold.end && e.category === gold.category)) continue;
    const exact = unique.some((e) => e.start === gold.start && e.end === gold.end);
    const intersecting = unique.filter((e) => overlaps(e, gold));
    if (exact) goldMisses.category++;
    else if (intersecting.some((e) => e.category === gold.category)) goldMisses.boundary++;
    else if (intersecting.length) goldMisses.boundaryAndCategory++;
    else goldMisses.absent++;
  }
  let cursor = 0, falseMaskRanges = 0;
  const falseByEntry = new Map<string, number>();
  for (const segment of buildMaskSegments(document.text, entries, FIXED_OCCURRENCE_MASKING_MODE)) {
    if (segment.type === "text") { cursor += segment.value.length; continue; }
    const entry = entries.find((e) => e.id === segment.entryId)!;
    const end = cursor + entry.normalizedText.length;
    const actual = { text: entry.originalText, category: entry.category, start: cursor, end } as EvaluatedEntity;
    masks[positionKind(actual, document.entities)]++;
    let outside = false;
    for (let i = cursor; i < end; i++) if (!document.entities.some((g) => g.start <= i && i < g.end)) { outside = true; break; }
    if (outside) { falseMaskRanges++; falseByEntry.set(entry.id, (falseByEntry.get(entry.id) ?? 0) + 1); }
    cursor = end;
  }
  const covered = new Set(unique.map((e) => JSON.stringify([e.category, e.start, e.end])));
  const exactStringMissingEvidence = document.entities.filter((g) => active.some((e) => e.originalText === g.text && e.category === g.category) && !covered.has(JSON.stringify([g.category, g.start, g.end]))).length;
  return { version: "error-counts-v1", strings, positions, masks, goldMisses, exactStringMissingEvidence,
    falseMaskRanges, falseMaskEntries: falseByEntry.size, maxFalseRangesPerEntry: Math.max(0, ...falseByEntry.values()) };
}
