import { performance } from "node:perf_hooks";
import { runRegexDetection } from "../../src/domain/detection/regex/runRegexDetection";
import { maskText } from "../../src/domain/mask/maskText";

type BenchmarkResult = {
  characters: number;
  detectionCandidates: number;
  detectionMedianMs: number;
  detectionBudgetMs: number;
  maskingMedianMs: number;
  maskingBudgetMs: number;
};

const CASES = [
  {
    characters: 1_000,
    detectionBudgetMs: 500,
    iterations: 12,
    maskingBudgetMs: 100,
  },
  {
    characters: 10_000,
    detectionBudgetMs: 3_000,
    iterations: 6,
    maskingBudgetMs: 500,
  },
] as const;

const SYNTHETIC_BLOCK = [
  "担当者は山田太郎です。",
  "連絡先はtaro.yamada@example.test、電話番号は090-1234-5678です。",
  "所在地は愛知県豊田市若宮町二丁目15番地、郵便番号は471-0026です。",
  "接続元は192.0.2.10、参照先はhttps://dev.orion.example.test/loginです。",
  "ユーザーID「test.yamada」、パスワード「TempPass-2026!」を使用します。",
].join("\n");

const results = CASES.map((benchmarkCase) => runCase(benchmarkCase));
console.table(results);

const failures = results.flatMap((result) => {
  const messages: string[] = [];

  if (result.detectionMedianMs > result.detectionBudgetMs) {
    messages.push(
      `${result.characters}文字の形式検出が${result.detectionMedianMs.toFixed(1)}msで予算${result.detectionBudgetMs}msを超過しました。`,
    );
  }

  if (result.maskingMedianMs > result.maskingBudgetMs) {
    messages.push(
      `${result.characters}文字のマスク生成が${result.maskingMedianMs.toFixed(1)}msで予算${result.maskingBudgetMs}msを超過しました。`,
    );
  }

  return messages;
});

if (failures.length > 0) {
  throw new Error(failures.join("\n"));
}

function runCase(benchmarkCase: (typeof CASES)[number]): BenchmarkResult {
  const sourceText = buildSyntheticText(benchmarkCase.characters);
  const initialCandidates = runRegexDetection(sourceText);
  const entries = initialCandidates.map((candidate, index) => ({
    enabled: true,
    id: `benchmark-${index}`,
    normalizedText: candidate.originalText.normalize("NFC"),
    originalText: candidate.originalText,
    reviewStatus: "approved" as const,
    token: `[BENCHMARK_${index + 1}]`,
  }));

  runRegexDetection(sourceText);
  maskText(sourceText, entries);

  const detectionMedianMs = measureMedian(
    () => runRegexDetection(sourceText),
    benchmarkCase.iterations,
  );
  const maskingMedianMs = measureMedian(
    () => maskText(sourceText, entries),
    benchmarkCase.iterations,
  );

  return {
    characters: sourceText.length,
    detectionCandidates: initialCandidates.length,
    detectionMedianMs: round(detectionMedianMs),
    detectionBudgetMs: benchmarkCase.detectionBudgetMs,
    maskingMedianMs: round(maskingMedianMs),
    maskingBudgetMs: benchmarkCase.maskingBudgetMs,
  };
}

function buildSyntheticText(length: number): string {
  const repeated = `${SYNTHETIC_BLOCK}\n`.repeat(
    Math.ceil(length / (SYNTHETIC_BLOCK.length + 1)),
  );

  return repeated.slice(0, length);
}

function measureMedian(operation: () => unknown, iterations: number): number {
  const durations = Array.from({ length: iterations }, () => {
    const start = performance.now();
    operation();
    return performance.now() - start;
  }).sort((left, right) => left - right);
  const middle = Math.floor(durations.length / 2);

  return durations.length % 2 === 0
    ? (durations[middle - 1] + durations[middle]) / 2
    : durations[middle];
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
