import type { MaskEntry } from "../../types";
import { PROMPT_CONFIG } from "./config";

export type AdditionalCategory = "PERSON" | "ADDRESS" | "ORGANIZATION";
export type EvidenceRange = { start: number; end: number; evidenceStart: number; evidenceEnd: number };
export type AdditionalCandidate = { text: string; category: AdditionalCategory; evidence: string; ranges: EvidenceRange[] };
export type ClassifiedCandidate = AdditionalCandidate & { status: "new" | "existing" | "conflict" };
export type RejectionReason = "text_missing" | "evidence_missing" | "evidence_mismatch";
export class AdditionalDetectionError extends Error {
  constructor() { super("追加検出は完了していません。準備状態や入力の長さを確認して再試行してください。"); }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const validText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\uD800-\uDFFF]/u.test(v);
function positions(text: string, target: string): number[] {
  const found: number[] = [];
  for (let start = text.indexOf(target); start !== -1; start = text.indexOf(target, start + 1)) found.push(start);
  return found;
}
export function validateAdditionalResponse(raw: string, chunk: { text: string; start: number }): { candidates: AdditionalCandidate[]; rejected: RejectionReason[] } {
  if (raw.length > PROMPT_CONFIG.maxResponseLength) throw new AdditionalDetectionError();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new AdditionalDetectionError(); }
  if (!record(value) || Object.keys(value).length !== 1 || !Array.isArray(value.entities) || value.entities.length > PROMPT_CONFIG.maxEntities) throw new AdditionalDetectionError();
  const candidates: AdditionalCandidate[] = [], rejected: RejectionReason[] = [];
  let rangeCount = 0;
  for (const entity of value.entities) {
    if (!record(entity) || Object.keys(entity).sort().join() !== "category,evidence,text" || !validText(entity.text, PROMPT_CONFIG.chunkLength) || !validText(entity.evidence, PROMPT_CONFIG.maxEvidenceLength) || typeof entity.category !== "string" || !["PERSON", "ADDRESS", "ORGANIZATION"].includes(entity.category)) throw new AdditionalDetectionError();
    const { text, evidence } = entity;
    if (!chunk.text.includes(text)) { rejected.push("text_missing"); continue; }
    if (!chunk.text.includes(evidence)) { rejected.push("evidence_missing"); continue; }
    if (!evidence.includes(text)) { rejected.push("evidence_mismatch"); continue; }
    const evidenceStarts = positions(chunk.text, evidence), ranges: EvidenceRange[] = [];
    let evidenceIndex = 0;
    // Equal-length evidence intervals are sorted. Find one containing quote per target
    // position instead of forming a quadratic product of overlapping identical quotes.
    for (const start of positions(chunk.text, text)) {
      while (evidenceIndex < evidenceStarts.length && evidenceStarts[evidenceIndex] + evidence.length < start + text.length) evidenceIndex++;
      const evidenceStart = evidenceStarts[evidenceIndex];
      if (evidenceStart === undefined || evidenceStart > start) continue;
      if (++rangeCount > PROMPT_CONFIG.maxEvidenceRanges) throw new AdditionalDetectionError();
      ranges.push({ start: chunk.start + start, end: chunk.start + start + text.length, evidenceStart: chunk.start + evidenceStart, evidenceEnd: chunk.start + evidenceStart + evidence.length });
    }
    candidates.push({ text, evidence, category: entity.category as AdditionalCategory, ranges });
  }
  return { candidates, rejected };
}
export function combineAdditionalCandidates(candidates: AdditionalCandidate[]): AdditionalCandidate[] {
  const result = new Map<string, AdditionalCandidate>();
  const seen = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.text, candidate.category]);
    if (!result.has(key)) { result.set(key, { ...candidate, ranges: [] }); seen.set(key, new Set()); }
    const previous = result.get(key)!;
    for (const range of candidate.ranges) {
      const rangeKey = `${range.start}:${range.end}`;
      if (!seen.get(key)!.has(rangeKey)) { previous.ranges.push(range); seen.get(key)!.add(rangeKey); }
    }
  }
  return [...result.values()];
}
export function classifyAdditionalCandidates(candidates: AdditionalCandidate[], entries: MaskEntry[]): ClassifiedCandidate[] {
  return combineAdditionalCandidates(candidates).map((candidate) => {
    const existing = entries.find((entry) => entry.normalizedText === candidate.text);
    const conflict = candidates.some((other) => other.text === candidate.text && other.category !== candidate.category);
    return { ...candidate, status: conflict || (existing && existing.category !== candidate.category) ? "conflict" : existing ? "existing" : "new" };
  });
}
