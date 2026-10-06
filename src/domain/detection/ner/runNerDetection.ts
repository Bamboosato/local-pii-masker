import type { DetectionCandidate } from "../mergeCandidates";
import type {
  NerDetectionProgress,
  NerDetectionRequest,
  NerDetectionResponse,
} from "./types";

export const DEFAULT_NER_TIMEOUT_MS = 5 * 60 * 1000;

export class NerDetectionCancelledError extends Error {
  readonly reason: unknown;

  constructor(reason?: unknown) {
    super("AI検出を中止しました。");
    this.name = "NerDetectionCancelledError";
    this.reason = reason;
  }
}

export class NerDetectionTimeoutError extends Error {
  constructor() {
    super("AI検出がタイムアウトしました。ネットワーク状態を確認して再試行してください。");
    this.name = "NerDetectionTimeoutError";
  }
}

let worker: Worker | undefined;
let nextRequestId = 0;

export function runNerDetection(
  text: string,
  options: {
    onProgress?: (progress: NerDetectionProgress) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<DetectionCandidate[]> {
  if (options.signal?.aborted) {
    return Promise.reject(new NerDetectionCancelledError(options.signal.reason));
  }

  const currentWorker = getWorker();
  const id = (nextRequestId += 1);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_NER_TIMEOUT_MS);

  return new Promise<DetectionCandidate[]>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      currentWorker.removeEventListener("message", handleMessage);
      currentWorker.removeEventListener("error", handleError);
      options.signal?.removeEventListener("abort", handleAbort);
      clearTimeout(timeoutId);
    };
    const succeed = (candidates: DetectionCandidate[]) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(candidates);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      discardWorker(currentWorker);
      reject(error);
    };
    const handleMessage = (event: MessageEvent<NerDetectionResponse>) => {
      if (event.data.id !== id) {
        return;
      }

      if (event.data.type === "progress") {
        options.onProgress?.(event.data.progress);
        return;
      }

      if (event.data.type === "success") {
        succeed(event.data.candidates);
        return;
      }

      fail(new Error(event.data.message));
    };
    const handleError = () => {
      fail(new Error("NER検出でエラーが発生しました。"));
    };
    const handleAbort = () => {
      fail(new NerDetectionCancelledError(options.signal?.reason));
    };

    currentWorker.addEventListener("message", handleMessage);
    currentWorker.addEventListener("error", handleError);
    options.signal?.addEventListener("abort", handleAbort, { once: true });
    const timeoutId = setTimeout(() => fail(new NerDetectionTimeoutError()), timeoutMs);

    try {
      currentWorker.postMessage({
        id,
        text,
        type: "detect",
      } satisfies NerDetectionRequest);
    } catch {
      fail(new Error("NER検出を開始できませんでした。"));
    }
  });
}

function getWorker(): Worker {
  worker ??= new Worker(new URL("./nerWorker.ts", import.meta.url), {
    type: "module",
  });

  return worker;
}

export function resetNerWorker(): void {
  if (worker) discardWorker(worker);
}

function discardWorker(currentWorker: Worker) {
  currentWorker.terminate();

  if (worker === currentWorker) {
    worker = undefined;
  }
}
