import { createLongCorpus, createPromptCorpus } from "./corpus";
import { splitPromptText } from "../../src/domain/detection/prompt/chunks";
import type { DevelopmentV2Document } from "./corpusV2";

/** Exact contiguous deletions of the old failing development input, no held-out data. */
export function minimizationDocuments(): DevelopmentV2Document[] {
  const legacy = createLongCorpus("development")[0];
  const tail = splitPromptText(legacy.text, 512, 128).at(-1)!;
  const body = createPromptCorpus("development")[8];
  const bodyStart = legacy.text.length - body.text.length;
  const prefixLength = bodyStart - tail.start;
  const sentenceEnd = body.text.indexOf("。") + 1;
  const ranges = [
    ["tail", tail.start, legacy.text.length],
    ["body", bodyStart, legacy.text.length],
    ["prefix", tail.start, bodyStart],
    ["half-prefix-body", tail.start + Math.floor(prefixLength / 2), legacy.text.length],
    ["shorter-tail", tail.start + 45, legacy.text.length],
    ["sentence-1", bodyStart, bodyStart + sentenceEnd],
    ["sentence-2", bodyStart + sentenceEnd, legacy.text.length],
  ] as const;
  return ranges.map(([id, start, end]) => ({ id: `development-v2-min-${id}`, text: legacy.text.slice(start, end),
    entities: legacy.entities.filter((e) => e.start >= start && e.end <= end).map((e) => ({ ...e, start: e.start - start, end: e.end - start })),
    family: "legacy-reproduction", marker: false }));
}
