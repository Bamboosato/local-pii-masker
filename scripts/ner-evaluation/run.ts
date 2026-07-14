import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, platform, arch } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { enrichPersonCandidates } from "../../src/domain/detection/enrichPersonCandidates";
import type { DetectionCandidate } from "../../src/domain/detection/mergeCandidates";
import {
  runChunkedNerDetection,
  splitTextForNer,
  type TokenClassifier,
} from "../../src/domain/detection/ner/runChunkedNerDetection";
import {
  NER_MODEL_ID,
  type NerTokenClassificationOutput,
} from "../../src/domain/detection/ner/types";
import { runRegexDetection } from "../../src/domain/detection/regex/runRegexDetection";
import {
  EVALUATED_CATEGORIES,
  modelLabelToEvaluatedCategory,
  normalizeModelLabel,
  parseCorpus,
  scoreEntities,
  type EvaluatedCategory,
  type EvaluatedEntity,
  type ScoredEntity,
} from "./evaluation";

type RawDetector = (
  text: string,
  options: { aggregation_strategy: "simple" },
) => Promise<unknown>;

type CliOptions = {
  cacheDir: string;
  corpusPath: string;
  device: string;
  dtype: string;
  localModelRoot?: string;
  modelId: string;
  outputPath: string;
  revision?: string;
};

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const corpusBytes = await readFile(options.corpusPath);
  const documents = parseCorpus(JSON.parse(corpusBytes.toString("utf8")) as unknown);

  configureTransformersEnvironment(options);
  await mkdir(options.cacheDir, { recursive: true });

  const loadStartedAt = performance.now();
  const rawDetector = (await pipeline(
    "token-classification",
    options.modelId,
    {
      device: options.device,
      dtype: options.dtype,
      progress_callback: () => undefined,
      ...(options.revision ? { revision: options.revision } : {}),
    } as never,
  )) as unknown as RawDetector;
  const modelLoadMs = performance.now() - loadStartedAt;

  const expectedEntities: ScoredEntity[] = [];
  const rawEntities: ScoredEntity[] = [];
  const appEntities: ScoredEntity[] = [];
  let rawOutputWithoutOffsets = 0;
  let rawOutputWithoutSourceMatch = 0;
  const documentTimings: Array<{
    appTargetCount: number;
    id: string;
    inferenceMs: number;
    rawOccurrenceCount: number;
  }> = [];

  for (const [index, document] of documents.entries()) {
    const chunks = splitTextForNer(document.text);
    let chunkIndex = 0;
    const documentRawEntities: EvaluatedEntity[] = [];
    const classifier: TokenClassifier = async (chunkText, classifierOptions) => {
      const rawOutputs = await rawDetector(chunkText, classifierOptions);

      if (!Array.isArray(rawOutputs) || !rawOutputs.every(isNerOutput)) {
        throw new TypeError("NER model returned an unsupported output shape.");
      }

      const chunk = chunks[chunkIndex];

      if (!chunk || chunk.text !== chunkText) {
        throw new Error("NER evaluation chunk order changed unexpectedly.");
      }

      const rawResult = toRawEntities(
        rawOutputs,
        document.text,
        chunk.text,
        chunk.start,
      );
      documentRawEntities.push(...rawResult.entities);
      rawOutputWithoutOffsets += rawResult.withoutOffsets;
      rawOutputWithoutSourceMatch += rawResult.withoutSourceMatch;
      chunkIndex += 1;
      return rawOutputs.map(normalizeOutputForApplication);
    };

    const inferenceStartedAt = performance.now();
    const nerCandidates = await runChunkedNerDetection(document.text, classifier);
    const applicationCandidates = enrichPersonCandidates(document.text, [
      ...runRegexDetection(document.text),
      ...nerCandidates,
    ]);
    const inferenceMs = performance.now() - inferenceStartedAt;
    const scoredExpected = document.entities.map((entity) => ({
      ...entity,
      documentId: document.id,
    }));
    const scoredRaw = documentRawEntities.map((entity) => ({
      ...entity,
      documentId: document.id,
    }));
    const scoredApplication = toApplicationEntities(
      applicationCandidates,
      document.id,
      document.text,
    );

    expectedEntities.push(...scoredExpected);
    rawEntities.push(...scoredRaw);
    appEntities.push(...scoredApplication);
    documentTimings.push({
      appTargetCount: uniqueTargetCount(scoredApplication),
      id: document.id,
      inferenceMs,
      rawOccurrenceCount: uniqueOccurrenceCount(scoredRaw),
    });
    process.stdout.write(
      `\rEvaluated ${index + 1}/${documents.length} synthetic documents`,
    );
  }

  process.stdout.write("\n");
  const rawOccurrence =
    rawOutputWithoutOffsets === 0
      ? scoreEntities({
          expected: expectedEntities,
          predicted: rawEntities,
          mode: "occurrence",
        })
      : null;
  const rawTarget = scoreEntities({
    expected: expectedEntities,
    predicted: rawEntities,
    mode: "target",
  });
  const applicationTarget = scoreEntities({
    expected: expectedEntities,
    predicted: appEntities,
    mode: "target",
  });
  const inferenceTotalMs = documentTimings.reduce(
    (total, timing) => total + timing.inferenceMs,
    0,
  );
  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    model: {
      id: options.modelId,
      revision: options.revision,
      device: options.device,
      dtype: options.dtype,
      localModelRoot: options.localModelRoot,
    },
    runtime: {
      node: process.version,
      platform: platform(),
      architecture: arch(),
      transformersJs: "4.2.0",
    },
    corpus: {
      path: options.corpusPath,
      sha256: createHash("sha256").update(corpusBytes).digest("hex"),
      documentCount: documents.length,
      expectedOccurrenceCount: expectedEntities.length,
      expectedTargetCount: uniqueTargetCount(expectedEntities),
    },
    performance: {
      modelLoadMs,
      inferenceTotalMs,
      inferenceMeanMs: inferenceTotalMs / documents.length,
      cacheBytes: await getDirectorySize(options.cacheDir),
      documents: documentTimings,
    },
    scores: {
      rawOccurrence,
      rawTarget,
      applicationTarget,
    },
    rawOutputDiagnostics: {
      occurrenceComparable: rawOutputWithoutOffsets === 0,
      withoutOffsets: rawOutputWithoutOffsets,
      withoutSourceMatch: rawOutputWithoutSourceMatch,
    },
  };

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Result: ${options.outputPath}`);
  console.log(
    `App target precision=${formatMetric(applicationTarget.overall.precision)} recall=${formatMetric(applicationTarget.overall.recall)} f1=${formatMetric(applicationTarget.overall.f1)}`,
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];

    if (!key?.startsWith("--") || !value) {
      throw new TypeError("NER evaluation arguments must be --key value pairs.");
    }

    values.set(key, value);
  }

  const output = values.get("--output");

  if (!output) {
    throw new TypeError("--output is required.");
  }

  return {
    cacheDir: toAbsolutePath(
      values.get("--cache-dir") ??
        join(homedir(), ".cache", "local-pii-masker", "ner-evaluation"),
    ),
    corpusPath: toAbsolutePath(
      values.get("--corpus") ?? "evaluation/ner/corpus.json",
    ),
    device: values.get("--device") ?? "wasm",
    dtype: values.get("--dtype") ?? "q8",
    localModelRoot: values.get("--local-model-root")
      ? toAbsolutePath(values.get("--local-model-root") as string)
      : undefined,
    modelId: values.get("--model") ?? NER_MODEL_ID,
    outputPath: toAbsolutePath(output),
    revision: values.get("--revision"),
  };
}

function configureTransformersEnvironment(options: CliOptions) {
  env.cacheDir = options.cacheDir;

  if (options.localModelRoot) {
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = options.localModelRoot.endsWith(sep)
      ? options.localModelRoot
      : `${options.localModelRoot}${sep}`;
  } else {
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
  }
}

function normalizeOutputForApplication(
  output: NerTokenClassificationOutput,
): NerTokenClassificationOutput {
  const normalizedLabel = normalizeModelLabel(
    output.entity_group ?? output.entity,
  );

  return normalizedLabel
    ? { ...output, entity_group: normalizedLabel }
    : output;
}

function toRawEntities(
  outputs: NerTokenClassificationOutput[],
  documentText: string,
  chunkText: string,
  chunkStart: number,
): {
  entities: EvaluatedEntity[];
  withoutOffsets: number;
  withoutSourceMatch: number;
} {
  const entities: EvaluatedEntity[] = [];
  let withoutOffsets = 0;
  let withoutSourceMatch = 0;
  let positionlessSearchStart = 0;

  for (const output of outputs) {
    const category = modelLabelToEvaluatedCategory(
      output.entity_group ?? output.entity,
    );

    if (!category) {
      continue;
    }

    let localStart = output.start;
    let localEnd = output.end;

    if (
      localStart === undefined ||
      localEnd === undefined ||
      localEnd <= localStart
    ) {
      withoutOffsets += 1;
      const candidateText = normalizeOutputWord(output.word);

      if (!candidateText) {
        withoutSourceMatch += 1;
        continue;
      }

      localStart = chunkText.indexOf(candidateText, positionlessSearchStart);

      if (localStart < 0) {
        localStart = chunkText.indexOf(candidateText);
      }

      if (localStart < 0) {
        withoutSourceMatch += 1;
        continue;
      }

      localEnd = localStart + candidateText.length;
      positionlessSearchStart = localEnd;
    }

    const start = chunkStart + localStart;
    const end = chunkStart + localEnd;

    if (start < 0 || end > documentText.length) {
      continue;
    }

    entities.push({
      category,
      start,
      end,
      text: documentText.slice(start, end),
    });
  }

  return { entities, withoutOffsets, withoutSourceMatch };
}

function normalizeOutputWord(value: string | undefined): string | undefined {
  const normalized = value?.replace(/^▁+/u, "").replace(/##/gu, "").trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function toApplicationEntities(
  candidates: DetectionCandidate[],
  documentId: string,
  documentText: string,
): ScoredEntity[] {
  return candidates.flatMap((candidate) => {
    if (!isEvaluatedCategory(candidate.category)) {
      return [];
    }

    const start =
      candidate.start ?? documentText.indexOf(candidate.originalText);
    const end = candidate.end ?? start + candidate.originalText.length;

    if (start < 0 || end <= start) {
      return [];
    }

    return [
      {
        category: candidate.category,
        documentId,
        start,
        end,
        text: candidate.originalText,
      },
    ];
  });
}

function isNerOutput(value: unknown): value is NerTokenClassificationOutput {
  return Boolean(value && typeof value === "object");
}

function isEvaluatedCategory(value: string): value is EvaluatedCategory {
  return EVALUATED_CATEGORIES.some((category) => category === value);
}

function uniqueTargetCount(entities: ScoredEntity[]): number {
  return new Set(
    entities.map((entity) =>
      [entity.documentId, entity.category, entity.text].join("\u0000"),
    ),
  ).size;
}

function uniqueOccurrenceCount(entities: ScoredEntity[]): number {
  return new Set(
    entities.map((entity) =>
      [entity.documentId, entity.category, entity.start, entity.end].join(
        "\u0000",
      ),
    ),
  ).size;
}

async function getDirectorySize(path: string): Promise<number> {
  try {
    const entry = await stat(path);

    if (entry.isFile()) {
      return entry.size;
    }

    const { readdir } = await import("node:fs/promises");
    const children = await readdir(path);
    const sizes = await Promise.all(
      children.map((child) => getDirectorySize(join(path, child))),
    );
    return sizes.reduce((total, size) => total + size, 0);
  } catch {
    return 0;
  }
}

function toAbsolutePath(path: string): string {
  return isAbsolute(path) ? path : resolve(path);
}

function formatMetric(value: number): string {
  return value.toFixed(4);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`NER evaluation failed: ${message}`);
  process.exitCode = 1;
});
