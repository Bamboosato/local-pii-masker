export type DetectionNormalizationRule =
  | "email_at_spacing"
  | "email_line_break"
  | "fullwidth_ascii"
  | "hyphen_variants"
  | "japanese_inter_character_space"
  | "person_name_line_break"
  | "url_line_break";

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
