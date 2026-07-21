import type {
  DocumentNormalizationMode,
  NormalizationWorkerRequest,
  NormalizationWorkerResponse,
} from "./types";

export type NormalizationClient = {
  request: (
    text: string,
    mode: DocumentNormalizationMode,
    sourceRevision: number,
  ) => Promise<Extract<NormalizationWorkerResponse, { type: "success" }>>;
  terminate: () => void;
};

export function createNormalizationClient(): NormalizationClient {
  const worker = new Worker(
    new URL("./normalizationWorker.ts", import.meta.url),
    { type: "module" },
  );
  let requestId = 0;
  const pending = new Map<
    number,
    {
      resolve: (response: Extract<NormalizationWorkerResponse, { type: "success" }>) => void;
      reject: (error: Error) => void;
    }
  >();

  worker.addEventListener("message", (event: MessageEvent<NormalizationWorkerResponse>) => {
    const pendingRequest = pending.get(event.data.requestId);
    if (!pendingRequest) {
      return;
    }
    pending.delete(event.data.requestId);
    if (event.data.type === "success") {
      pendingRequest.resolve(event.data);
    } else {
      pendingRequest.reject(new Error(event.data.code));
    }
  });

  worker.addEventListener("error", () => {
    for (const request of pending.values()) {
      request.reject(new Error("NORMALIZATION_WORKER_FAILED"));
    }
    pending.clear();
  });

  return {
    request(text, mode, sourceRevision) {
      const id = ++requestId;
      const request: NormalizationWorkerRequest = {
        type: "normalize",
        requestId: id,
        sourceRevision,
        mode,
        text,
      };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage(request);
      });
    },
    terminate() {
      worker.terminate();
      for (const request of pending.values()) {
        request.reject(new Error("NORMALIZATION_CANCELLED"));
      }
      pending.clear();
    },
  };
}
