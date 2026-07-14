import type { MaskCategory } from "../../src/domain/types";

export const EVALUATED_CATEGORIES = [
  "PERSON",
  "ORGANIZATION",
  "ADDRESS",
] as const satisfies readonly MaskCategory[];

export type EvaluatedCategory = (typeof EVALUATED_CATEGORIES)[number];

export type EvaluatedEntity = {
  category: EvaluatedCategory;
  end: number;
  start: number;
  text: string;
};

export type EvaluationDocument = {
  entities: EvaluatedEntity[];
  id: string;
  text: string;
};

export type CorpusFile = {
  description: string;
  documents: Array<{
    annotatedText: string;
    id: string;
  }>;
  version: number;
};

export type MetricCounts = {
  f1: number;
  falseNegative: number;
  falsePositive: number;
  precision: number;
  recall: number;
  truePositive: number;
};

export type ScoredEntity = EvaluatedEntity & { documentId: string };

export type ScoreResult = {
  falseNegatives: ScoredEntity[];
  falsePositives: ScoredEntity[];
  overall: MetricCounts;
  perCategory: Record<EvaluatedCategory, MetricCounts>;
};

const ANNOTATION_START = "[[";
const ANNOTATION_END = "]]";

export function parseCorpus(value: unknown): EvaluationDocument[] {
  if (!isCorpusFile(value)) {
    throw new TypeError("NER evaluation corpus has an invalid shape.");
  }

  const seenIds = new Set<string>();

  return value.documents.map((document) => {
    if (seenIds.has(document.id)) {
      throw new TypeError(`Duplicate evaluation document id: ${document.id}`);
    }

    seenIds.add(document.id);
    return {
      id: document.id,
      ...parseAnnotatedText(document.annotatedText),
    };
  });
}

export function parseAnnotatedText(annotatedText: string): {
  entities: EvaluatedEntity[];
  text: string;
} {
  const entities: EvaluatedEntity[] = [];
  let cursor = 0;
  let text = "";

  while (cursor < annotatedText.length) {
    const annotationStart = annotatedText.indexOf(ANNOTATION_START, cursor);

    if (annotationStart < 0) {
      text += annotatedText.slice(cursor);
      break;
    }

    text += annotatedText.slice(cursor, annotationStart);
    const annotationEnd = annotatedText.indexOf(
      ANNOTATION_END,
      annotationStart + ANNOTATION_START.length,
    );

    if (annotationEnd < 0) {
      throw new TypeError("NER evaluation annotation is not closed.");
    }

    const annotation = annotatedText.slice(
      annotationStart + ANNOTATION_START.length,
      annotationEnd,
    );
    const separator = annotation.indexOf("|");

    if (separator <= 0) {
      throw new TypeError("NER evaluation annotation must contain a category.");
    }

    const category = annotation.slice(0, separator);
    const entityText = annotation.slice(separator + 1);

    if (!isEvaluatedCategory(category) || entityText.length === 0) {
      throw new TypeError(`Invalid NER evaluation annotation: ${annotation}`);
    }

    const start = text.length;
    text += entityText;
    entities.push({
      category,
      end: text.length,
      start,
      text: entityText,
    });
    cursor = annotationEnd + ANNOTATION_END.length;
  }

  return { entities, text };
}

export function normalizeModelLabel(label: string | undefined):
  | "PER"
  | "ORG"
  | "ORG-P"
  | "ORG-O"
  | "LOC"
  | "INS"
  | "PRD"
  | "EVT"
  | "O"
  | undefined {
  const normalized = label?.replace(/^[BI]-/u, "").trim();

  switch (normalized) {
    case "PER":
    case "人名":
      return "PER";
    case "ORG":
    case "法人名":
      return "ORG";
    case "ORG-P":
    case "政治的組織名":
      return "ORG-P";
    case "ORG-O":
    case "その他の組織名":
    case "その他の組織":
      return "ORG-O";
    case "LOC":
    case "地名":
      return "LOC";
    case "INS":
    case "施設名":
      return "INS";
    case "PRD":
    case "製品名":
      return "PRD";
    case "EVT":
    case "イベント名":
      return "EVT";
    case "O":
      return "O";
    default:
      return undefined;
  }
}

export function modelLabelToEvaluatedCategory(
  label: string | undefined,
): EvaluatedCategory | undefined {
  switch (normalizeModelLabel(label)) {
    case "PER":
      return "PERSON";
    case "ORG":
    case "ORG-P":
    case "ORG-O":
      return "ORGANIZATION";
    case "LOC":
    case "INS":
      return "ADDRESS";
    default:
      return undefined;
  }
}

export function scoreEntities(params: {
  expected: ScoredEntity[];
  mode: "occurrence" | "target";
  predicted: ScoredEntity[];
}): ScoreResult {
  const keyOf = params.mode === "occurrence" ? occurrenceKey : targetKey;
  const expected = uniqueByKey(params.expected, keyOf);
  const predicted = uniqueByKey(params.predicted, keyOf);
  const expectedKeys = new Set(expected.map(keyOf));
  const predictedKeys = new Set(predicted.map(keyOf));
  const falseNegatives = expected.filter((entity) => !predictedKeys.has(keyOf(entity)));
  const falsePositives = predicted.filter((entity) => !expectedKeys.has(keyOf(entity)));
  const truePositive = expected.length - falseNegatives.length;

  return {
    falseNegatives,
    falsePositives,
    overall: calculateMetricCounts(
      truePositive,
      falsePositives.length,
      falseNegatives.length,
    ),
    perCategory: Object.fromEntries(
      EVALUATED_CATEGORIES.map((category) => {
        const categoryExpected = expected.filter(
          (entity) => entity.category === category,
        );
        const categoryPredicted = predicted.filter(
          (entity) => entity.category === category,
        );
        const categoryExpectedKeys = new Set(categoryExpected.map(keyOf));
        const categoryPredictedKeys = new Set(categoryPredicted.map(keyOf));
        const categoryTruePositive = categoryExpected.filter((entity) =>
          categoryPredictedKeys.has(keyOf(entity)),
        ).length;
        const categoryFalsePositive = categoryPredicted.filter(
          (entity) => !categoryExpectedKeys.has(keyOf(entity)),
        ).length;
        const categoryFalseNegative = categoryExpected.filter(
          (entity) => !categoryPredictedKeys.has(keyOf(entity)),
        ).length;

        return [
          category,
          calculateMetricCounts(
            categoryTruePositive,
            categoryFalsePositive,
            categoryFalseNegative,
          ),
        ];
      }),
    ) as Record<EvaluatedCategory, MetricCounts>,
  };
}

function calculateMetricCounts(
  truePositive: number,
  falsePositive: number,
  falseNegative: number,
): MetricCounts {
  const precision = divide(truePositive, truePositive + falsePositive);
  const recall = divide(truePositive, truePositive + falseNegative);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return {
    f1,
    falseNegative,
    falsePositive,
    precision,
    recall,
    truePositive,
  };
}

function occurrenceKey(entity: ScoredEntity): string {
  return [
    entity.documentId,
    entity.category,
    entity.start,
    entity.end,
  ].join("\u0000");
}

function targetKey(entity: ScoredEntity): string {
  return [entity.documentId, entity.category, entity.text].join("\u0000");
}

function uniqueByKey<T>(values: T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = keyOf(value);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function isCorpusFile(value: unknown): value is CorpusFile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const corpus = value as Partial<CorpusFile>;
  return (
    typeof corpus.version === "number" &&
    typeof corpus.description === "string" &&
    Array.isArray(corpus.documents) &&
    corpus.documents.every(
      (document) =>
        document &&
        typeof document === "object" &&
        typeof document.id === "string" &&
        document.id.length > 0 &&
        typeof document.annotatedText === "string",
    )
  );
}

function isEvaluatedCategory(value: string): value is EvaluatedCategory {
  return EVALUATED_CATEGORIES.some((category) => category === value);
}
