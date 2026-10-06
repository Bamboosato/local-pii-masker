import type { DetectionCandidate } from "../mergeCandidates";
import type { ModelCacheStatus } from "./modelCache";

export const NER_MODEL_ID = "jiting/xlm-roberta-ner-japanese_onnx";
export const NER_MODEL_REVISION = "8d70fc4";

export type NerModelLabel =
  | "PER"
  | "ORG"
  | "ORG-P"
  | "ORG-O"
  | "LOC"
  | "INS"
  | "PRD"
  | "EVT"
  | "O";

export type NerTokenClassificationOutput = {
  entity?: string;
  entity_group?: string;
  score?: number;
  word?: string;
  start?: number;
  end?: number;
};

export type NerDetectionProgress = {
  phase: "loading" | "running";
  cache?: ModelCacheStatus;
};

export type NerDetectionRequest = {
  id: number;
  text: string;
  type: "detect";
};

export type NerDetectionProgressMessage = {
  id: number;
  progress: NerDetectionProgress;
  type: "progress";
};

export type NerDetectionSuccessMessage = {
  candidates: DetectionCandidate[];
  id: number;
  type: "success";
};

export type NerDetectionErrorMessage = {
  id: number;
  message: string;
  type: "error";
};

export type NerDetectionResponse =
  | NerDetectionProgressMessage
  | NerDetectionSuccessMessage
  | NerDetectionErrorMessage;
