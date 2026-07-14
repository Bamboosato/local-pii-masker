import { env, pipeline } from "@huggingface/transformers";
import {
  NER_MODEL_ID,
  type NerDetectionRequest,
  type NerDetectionResponse,
} from "./types";
import {
  type TokenClassifier,
} from "./runChunkedNerDetection";
import { configureLocalOnnxRuntime } from "./configureOnnxRuntime";
import { createRetryableLoader } from "./retryableLoader";
import { runNormalizedNerDetection } from "./runNormalizedNerDetection";

env.allowRemoteModels = true;
env.allowLocalModels = false;
configureLocalOnnxRuntime(env);

const detectorLoader = createRetryableLoader(
  () =>
    pipeline("token-classification", NER_MODEL_ID, {
      device: "wasm",
      dtype: "q8",
      progress_callback: () => {
        // Public model asset progress is intentionally not echoed with filenames.
      },
    }) as Promise<TokenClassifier>,
);

self.addEventListener(
  "message",
  (event: MessageEvent<NerDetectionRequest>) => {
    if (event.data.type !== "detect") {
      return;
    }

    void detect(event.data);
  },
);

async function detect(request: NerDetectionRequest) {
  try {
    postProgress(request.id, "loading");
    const detector = await getDetector();
    postProgress(request.id, "running");
    const candidates = await runNormalizedNerDetection(request.text, detector);
    postMessage({
      id: request.id,
      candidates,
      type: "success",
    } satisfies NerDetectionResponse);
  } catch {
    postMessage({
      id: request.id,
      message:
        "AI検出を実行できませんでした。形式候補と手動追加は引き続き利用できます。",
      type: "error",
    } satisfies NerDetectionResponse);
  }
}

async function getDetector() {
  return detectorLoader.load();
}

function postProgress(
  id: number,
  phase: "loading" | "running",
) {
  postMessage({
    id,
    progress: { phase },
    type: "progress",
  } satisfies NerDetectionResponse);
}
