import { createDevelopmentV2Corpus, createDevelopmentV2Long, type DevelopmentV2Document } from "./corpusV2";
import { createLongCorpus } from "./corpus";
import { minimizationDocuments } from "./followupData";

export type PriorityVariant = { id: string; format: "evidence-v1" | "source-id-v2"; sessionMode: "clone" | "fresh"; constraint: "schema" | "quote-enum" | "none"; omitSchemaInput: boolean; chunkLength?: number; overlap?: number; reuseIdenticalChunks?: boolean; instruction?: "negative-v1" | "negative-brief-v1"; referenceMode?: "whole-only" };
export const DIAGNOSTIC_VARIANTS: readonly PriorityVariant[] = (["clone", "fresh"] as const).flatMap((sessionMode) => (["schema", "none", "quote-enum"] as const).map((constraint) => ({ id: `diagnostic-${constraint}-${sessionMode}`, format: "evidence-v1", sessionMode, constraint, omitSchemaInput: true })));
export const QUALITY_VARIANTS: readonly PriorityVariant[] = [
  { id: "quality-evidence-v1", format: "evidence-v1", sessionMode: "clone", constraint: "schema", omitSchemaInput: false },
  { id: "quality-source-id-v2", format: "source-id-v2", sessionMode: "clone", constraint: "schema", omitSchemaInput: false },
];
export function priorityDocuments(): DevelopmentV2Document[] {
  return [
    ...createDevelopmentV2Corpus(), createDevelopmentV2Long("repeated"), createDevelopmentV2Long("varied"),
    { id: "development-v2-repeated-minimal", text: "検証用の一般文。".repeat(56), entities: [], family: "repeated", marker: false },
    { ...createLongCorpus("development")[0], id: "development-v2-legacy-reproduction", family: "legacy-reproduction", marker: false },
    ...minimizationDocuments(),
  ];
}
export type PriorityPlanItem = { phase: "diagnostic" | "quality" | "long" | "reproduction" | "reproduction-schema" | "negative-instruction" | "negative-brief" | "minimize" | "minimize-sentences" | "minimize-boundary" | "reference-short" | "reference-long"; repeat: number; variant: PriorityVariant; documentId: string };
export function minimizationBoundaryPlan(): PriorityPlanItem[] {
  const variant: PriorityVariant = { id: "min-boundary-quote", format: "evidence-v1", sessionMode: "clone", constraint: "quote-enum", omitSchemaInput: true, chunkLength: 512, overlap: 128, reuseIdenticalChunks: true };
  const cases = [
    { documentId: "development-v2-min-tail", variant },
    { documentId: "development-v2-min-tail", variant: { ...variant, id: "min-boundary-schema", constraint: "schema" as const } },
    { documentId: "development-v2-min-shorter-tail", variant },
  ];
  return [0, 1, 2].flatMap((round) => cases.map((_, i) => ({ phase: "minimize-boundary" as const, repeat: round + 1, ...cases[(round + i) % cases.length] })));
}
export function negativeInstructionPlan(brief = false): PriorityPlanItem[] {
  const documents = createDevelopmentV2Corpus();
  const variants: PriorityVariant[] = [
    { ...QUALITY_VARIANTS[1], id: "source-id-control" },
    { ...QUALITY_VARIANTS[1], id: brief ? "source-id-negative-brief-v1" : "source-id-negative-v1", instruction: brief ? "negative-brief-v1" : "negative-v1" },
  ];
  return [0, 1, 2].flatMap((round) => [0, 1, 2, 3, 4, 5, 60, 61, 62, 63].flatMap((i) => variants.map((_, j) => ({ phase: brief ? "negative-brief" as const : "negative-instruction" as const, repeat: round + 1, variant: variants[(round + j) % variants.length], documentId: documents[i].id }))));
}
export function minimizationPlan(sentences = false): PriorityPlanItem[] {
  const ids = sentences ? ["development-v2-min-half-prefix-body", "development-v2-min-sentence-1", "development-v2-min-sentence-2"] : ["development-v2-legacy-reproduction", "development-v2-min-tail", "development-v2-min-body", "development-v2-min-prefix"];
  return [0, 1, 2].flatMap((round) => ids.map((_, i) => ({ phase: sentences ? "minimize-sentences" as const : "minimize" as const, repeat: round + 1,
    documentId: ids[(round + i) % ids.length], variant: { id: "min-quote-clone", format: "evidence-v1" as const, sessionMode: "clone" as const, constraint: "quote-enum" as const, omitSchemaInput: true, chunkLength: 512, overlap: 128, reuseIdenticalChunks: true } })));
}
export function reproductionSchemaPlan(): PriorityPlanItem[] {
  const variants: PriorityVariant[] = [
    { id: "legacy-basic-clone", format: "evidence-v1", sessionMode: "clone", constraint: "schema", omitSchemaInput: true, chunkLength: 512, overlap: 128, reuseIdenticalChunks: true },
    { id: "legacy-none-clone", format: "evidence-v1", sessionMode: "clone", constraint: "none", omitSchemaInput: true, chunkLength: 512, overlap: 128, reuseIdenticalChunks: true },
    { id: "legacy-source-id-clone", format: "source-id-v2", sessionMode: "clone", constraint: "schema", omitSchemaInput: true, chunkLength: 512, overlap: 128, reuseIdenticalChunks: true },
  ];
  return [0, 1, 2].flatMap((round) => variants.map((_, i) => ({ phase: "reproduction-schema" as const, repeat: round + 1, documentId: "development-v2-legacy-reproduction", variant: variants[(round + i) % variants.length] })));
}
export function reproductionPlan(): PriorityPlanItem[] {
  return [0, 1, 2].flatMap((round) => (["clone", "fresh"] as const).map((_, i, modes) => {
    const sessionMode = modes[(round + i) % modes.length];
    return { phase: "reproduction" as const, repeat: round + 1, documentId: "development-v2-legacy-reproduction", variant: { id: `legacy-512-${sessionMode}`, format: "evidence-v1" as const, sessionMode, constraint: "quote-enum" as const, omitSchemaInput: true, chunkLength: 512, overlap: 128, reuseIdenticalChunks: true } };
  }));
}
export function priorityPlan(): PriorityPlanItem[] {
  const quality = createDevelopmentV2Corpus();
  const phases = [
    { phase: "diagnostic" as const, variants: DIAGNOSTIC_VARIANTS, ids: ["development-v2-repeated-minimal", "development-v2-negative-1"] },
    { phase: "quality" as const, variants: QUALITY_VARIANTS, ids: [0, 1, 2, 3, 4, 5, 60, 61, 62, 63].map((i) => quality[i].id) },
    { phase: "long" as const, variants: QUALITY_VARIANTS, ids: ["development-v2-varied-1000"] },
  ];
  return phases.flatMap(({ phase, variants, ids }) => [0, 1, 2].flatMap((repeat) => ids.flatMap((documentId) => variants.map((_, i) => ({ phase, repeat: repeat + 1, variant: variants[(i + repeat) % variants.length], documentId })))));
}
