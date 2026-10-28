import type { evaluateDocument } from "./evaluate";
type Row = Awaited<ReturnType<typeof evaluateDocument>> & { repeat: number };
const metrics = (counts: { tp: number; fp: number; fn: number }) => {
  const precision = counts.tp + counts.fp ? counts.tp / (counts.tp + counts.fp) : null;
  const recall = counts.tp + counts.fn ? counts.tp / (counts.tp + counts.fn) : null;
  return { ...counts, precision, recall, f1: precision !== null && recall !== null ? precision + recall ? 2 * precision * recall / (precision + recall) : 0 : null };
};
export function summarizeEvaluation(rows: Row[]) {
  const repeats = [1, 2, 3].map((repeat) => {
    const subset = rows.filter((r) => r.repeat === repeat);
    const sumCounts = (method: "A" | "B" | "C", kind: "strings" | "positions", category?: string) => metrics(subset.reduce((total, row) => {
      const value = category ? row[method].categories[category] : row[method][kind];
      return { tp: total.tp + value.tp, fp: total.fp + value.fp, fn: total.fn + value.fn };
    }, { tp: 0, fp: 0, fn: 0 }));
    const methods = Object.fromEntries((["A", "B", "C"] as const).map((method) => {
      const complete = subset.filter((r) => method === "A" ? r.baselineComplete : method === "B" ? r.bComplete : r.cComplete).length;
      const positive = subset.filter((r) => r[method].positiveDocument).length;
      return [method, { completed: complete, attempted: subset.length, completionRate: subset.length ? complete / subset.length : null,
        strings: sumCounts(method, "strings"), positions: sumCounts(method, "positions"), categories: Object.fromEntries(["PERSON", "ADDRESS", "ORGANIZATION"].map((category) => [category, sumCounts(method, "positions", category)])),
        missing: subset.reduce((n,r) => n+r[method].missing,0), falseMaskRanges: subset.reduce((n,r) => n+r[method].falseMaskRanges,0), falseMaskCharacters: subset.reduce((n,r) => n+r[method].falseMaskCharacters,0), leakingDocumentRate: positive ? subset.filter((r) => r[method].leakingDocument).length / positive : null,
      }];
    }));
    const aMissing = subset.reduce((n,r) => n+r.A.missing,0), bMissing = subset.reduce((n,r) => n+r.B.missing,0);
    return { repeat, documents: subset.length, methods, relativeLeakReduction: aMissing ? (aMissing - bMissing) / aMissing : null, warnings: subset.filter((r) => r.rejected.length > 0).length, newCandidates: subset.reduce((n,r) => n+r.newCandidates,0), maxBDetectionMs: Math.max(0,...subset.map((r) => r.additionalMs ?? 0)), maxCDetectionMs: Math.max(0,...subset.map((r) => r.cAdditionalMs ?? 0)) };
  });
  return { repeats, worstBMissing: Math.max(0,...repeats.map((r) => rows.filter((row) => row.repeat === r.repeat).reduce((n,row) => n+row.B.missing,0))), note: "失敗文書もフォールバック結果で集計。未完了の試行は完了率と併記し採用判断を保留。境界誤りは位置単位FP/FNと未マスク・誤マスクで検出し、合成文書IDから別途分類する。" };
}
