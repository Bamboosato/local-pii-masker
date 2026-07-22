export type DocumentNormalizationMode =
  | "standard"
  | "detection_priority";

export type DocumentNormalizationRuleId =
  | "unicode_nfc"
  | "line_ending"
  | "invisible_character"
  | "special_whitespace"
  | "fullwidth_ascii"
  | "structured_hyphen"
  | "email_spacing"
  | "email_line_break"
  | "phone_spacing"
  | "phone_line_break"
  | "postal_code_spacing"
  | "postal_code_line_break"
  | "date_time_spacing"
  | "date_time_line_break"
  | "label_value_line_break"
  | "list_item_wrap"
  | "japanese_inter_character_space"
  | "person_line_break"
  | "kana_inter_character_space"
  | "address_line_break"
  | "organization_line_break"
  | "identifier_spacing"
  | "identifier_line_break"
  | "japanese_line_wrap"
  | "prose_line_wrap"
  | "excess_whitespace";

export type NormalizationChangeKind =
  | "character"
  | "space"
  | "line_break"
  | "join";

export type TextRange = {
  start: number;
  end: number;
};

export type SourceMapping = {
  originalStart: number;
  originalEnd: number;
  changed: boolean;
  ruleIds: DocumentNormalizationRuleId[];
};

export type DocumentNormalizationEvent = {
  ruleId: DocumentNormalizationRuleId;
  kind: NormalizationChangeKind;
  originalRange: TextRange;
};

export type NormalizationRuleSummary = {
  ruleId: DocumentNormalizationRuleId;
  kind: NormalizationChangeKind;
  count: number;
};

export type DocumentNormalizationResult = {
  normalizedText: string;
  mappings: SourceMapping[];
  events: DocumentNormalizationEvent[];
  summary: NormalizationRuleSummary[];
  changedLocationCount: number;
};

export type PreviewSegment = {
  text: string;
  changed: boolean;
  ruleIds: DocumentNormalizationRuleId[];
};

export type NormalizationPreview = {
  before: PreviewSegment[];
  after: PreviewSegment[];
};

export type NormalizationWorkerRequest = {
  type: "normalize";
  requestId: number;
  sourceRevision: number;
  mode: DocumentNormalizationMode;
  text: string;
};

export type NormalizationWorkerResponse =
  | {
      type: "success";
      requestId: number;
      sourceRevision: number;
      mode: DocumentNormalizationMode;
      result: DocumentNormalizationResult;
    }
  | {
      type: "error";
      requestId: number;
      sourceRevision: number;
      code: "NORMALIZATION_FAILED";
    };
