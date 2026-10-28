import { createDevelopmentV2Corpus } from "./corpusV2";
import { priorityDocuments, type PriorityPlanItem, type PriorityVariant } from "./priorityPlan";
import { serializeSources, sourceIdSchema } from "./sourceId";

export const REFERENCE_VARIANTS: readonly PriorityVariant[] = [
  { id: "reference-control", format: "source-id-v2", sessionMode: "clone", constraint: "schema", omitSchemaInput: false, chunkLength: 1600, overlap: 200 },
  { id: "reference-whole", format: "source-id-v2", sessionMode: "clone", constraint: "schema", omitSchemaInput: false, referenceMode: "whole-only", chunkLength: 1600, overlap: 200 },
  { id: "reference-whole-512", format: "source-id-v2", sessionMode: "clone", constraint: "schema", omitSchemaInput: false, referenceMode: "whole-only", chunkLength: 512, overlap: 128 },
];
export function referenceScreeningPlan(): PriorityPlanItem[] {
  const docs = createDevelopmentV2Corpus();
  const phases = [
    { phase: "reference-short" as const, ids: [0, 1, 2, 3, 4, 5, 60, 61, 62, 63].map((i) => docs[i].id), variants: REFERENCE_VARIANTS.slice(0, 2) },
    { phase: "reference-long" as const, ids: ["development-v2-varied-1000", "development-v2-legacy-reproduction"], variants: REFERENCE_VARIANTS },
  ];
  return phases.flatMap(({ phase, ids, variants }) => [0, 1, 2].flatMap((round) => ids.flatMap((documentId) => variants.map((_, i) => ({ phase, documentId, repeat: round + 1, variant: variants[(round + i) % variants.length] })))));
}
export function referenceInputChanged(documentId: string): boolean {
  const doc = priorityDocuments().find((d) => d.id === documentId);
  if (!doc) throw new Error("Unknown screening document");
  return serializeSources(doc.text) !== serializeSources(doc.text, "whole-only") || JSON.stringify(sourceIdSchema(doc.text)) !== JSON.stringify(sourceIdSchema(doc.text, "whole-only"));
}
type Measure = { tp: number; fp: number; fn: number };
export type ScreeningRow = { documentId: string; repeat: number; settings: { variant: { id: string } }; complete: boolean; score: { missing: number; falseMaskRanges: number; strings: Measure; positions: Measure } };
const key = (r: ScreeningRow) => `${r.documentId}/${r.repeat}/${r.settings.variant.id}`;
const sum = (rows: ScreeningRow[], value: (row: ScreeningRow) => number) => rows.reduce((n, row) => n + value(row), 0);
const missing = (r: ScreeningRow) => r.score.missing;
const falseMask = (r: ScreeningRow) => r.score.falseMaskRanges;
const metrics = [missing, falseMask, (r: ScreeningRow) => r.score.strings.fp, (r: ScreeningRow) => r.score.strings.fn, (r: ScreeningRow) => r.score.positions.fp, (r: ScreeningRow) => r.score.positions.fn];
function noRegression(candidate: ScreeningRow[], control: ScreeningRow[]) {
  return metrics.every((metric) => sum(candidate, metric) <= sum(control, metric)) && metrics.every((metric) => {
    const worst = (rows: ScreeningRow[]) => Math.max(...[1, 2, 3].map((r) => sum(rows.filter((x) => x.repeat === r), metric)));
    return worst(candidate) <= worst(control);
  }) && [...new Set(control.map((r) => r.documentId))].every((id) => metrics.every((metric) => sum(candidate.filter((r) => r.documentId === id), metric) <= sum(control.filter((r) => r.documentId === id), metric)));
}
/** Gate fixed before inference. Faster output alone never opens the NER comparison. */
export function referenceScreeningGate(rows: ScreeningRow[]) {
  const expected = referenceScreeningPlan().map((p) => `${p.documentId}/${p.repeat}/${p.variant.id}`);
  const keys = rows.map(key);
  if (keys.length !== expected.length || new Set(keys).size !== keys.length || expected.some((k) => !keys.includes(k))) return { version: "reference-gate-v1", eligible: [] as string[], reasons: ["incomplete-or-duplicate-plan"] };
  const shortIds = new Set(referenceScreeningPlan().filter((p) => p.phase === "reference-short").map((p) => p.documentId));
  const short = (id: string) => rows.filter((r) => shortIds.has(r.documentId) && r.settings.variant.id === id);
  const control = short("reference-control"), candidate = short("reference-whole");
  const reasons: string[] = [];
  if (candidate.some((r) => !r.complete)) reasons.push("short-incomplete");
  if (!noRegression(candidate, control)) reasons.push("short-regression");
  const changedCandidate = candidate.filter((r) => referenceInputChanged(r.documentId));
  const changedControl = control.filter((r) => referenceInputChanged(r.documentId));
  const falseGain = sum(control, falseMask) - sum(candidate, falseMask);
  const missingGain = sum(control, missing) - sum(candidate, missing);
  const meaningful = falseGain >= Math.max(2, Math.ceil(sum(control, falseMask) * 0.25)) || missingGain >= 2;
  const changedGain = sum(changedCandidate, falseMask) < sum(changedControl, falseMask) || sum(changedCandidate, missing) < sum(changedControl, missing);
  if (!meaningful || !changedGain) reasons.push("no-material-changed-input-gain");
  const shortPass = reasons.length === 0;
  const eligible: string[] = [];
  for (const id of ["reference-whole", "reference-whole-512"]) {
    const long = (variant: string) => rows.filter((r) => !shortIds.has(r.documentId) && r.settings.variant.id === variant);
    const selected = long(id), baseline = long("reference-control");
    if (selected.some((r) => !r.complete)) reasons.push(`${id}:long-incomplete`);
    else if (!noRegression(selected, baseline)) reasons.push(`${id}:long-regression`);
    else if (selected.some((r) => r.score.strings.tp === 0)) reasons.push(`${id}:no-long-signal`);
    else if (shortPass) eligible.push(id);
  }
  return { version: "reference-gate-v1", eligible, reasons };
}
