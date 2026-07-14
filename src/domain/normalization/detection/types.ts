export type DetectionNormalizationRule = "email_at_spacing";

export type TextRange = {
  start: number;
  end: number;
};

export type NormalizedOffsetMapping = {
  originalStart: number;
  originalEnd: number;
};

export type NormalizationEvent = {
  rule: DetectionNormalizationRule;
  normalizedStart: number;
  normalizedEnd: number;
  originalStart: number;
  originalEnd: number;
};

export type NormalizedTextResult = {
  text: string;
  mappings: NormalizedOffsetMapping[];
  appliedRules: NormalizationEvent[];
};
