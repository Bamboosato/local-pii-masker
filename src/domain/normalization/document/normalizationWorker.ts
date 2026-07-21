import { normalizeDocumentText } from "./normalizeDocumentText";
import type {
  NormalizationWorkerRequest,
  NormalizationWorkerResponse,
} from "./types";

self.addEventListener(
  "message",
  (event: MessageEvent<NormalizationWorkerRequest>) => {
    if (event.data.type !== "normalize") {
      return;
    }

    try {
      const result = normalizeDocumentText(event.data.text, event.data.mode);
      self.postMessage({
        type: "success",
        requestId: event.data.requestId,
        sourceRevision: event.data.sourceRevision,
        mode: event.data.mode,
        result,
      } satisfies NormalizationWorkerResponse);
    } catch {
      self.postMessage({
        type: "error",
        requestId: event.data.requestId,
        sourceRevision: event.data.sourceRevision,
        code: "NORMALIZATION_FAILED",
      } satisfies NormalizationWorkerResponse);
    }
  },
);
