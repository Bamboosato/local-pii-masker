import { env, AutoTokenizer, AutoModelForTokenClassification, TokenClassificationPipeline } from "@huggingface/transformers";
import {
  NER_MODEL_ID,
  NER_MODEL_REVISION,
  type NerDetectionRequest,
  type NerDetectionResponse,
} from "./types";
import {
  type TokenClassifier,
} from "./runChunkedNerDetection";
import { configureLocalOnnxRuntime } from "./configureOnnxRuntime";
import { createRetryableLoader } from "./retryableLoader";
import { runNormalizedNerDetection } from "./runNormalizedNerDetection";
import { createPublicModelCache, createPinnedModelFetch } from "./modelCache";

env.allowRemoteModels = true;
env.allowLocalModels = false;
configureLocalOnnxRuntime(env);
const modelCache = createPublicModelCache();
env.useCustomCache = true;
env.customCache = modelCache.cache;
env.fetch = createPinnedModelFetch(env.fetch);

const detectorLoader = createRetryableLoader(
  async () => {
    // Transformers.js 4.3 pipeline() preflights assets at the default revision
    // for progress metadata. Load both components explicitly to keep every
    // model request pinned and avoid redundant main-revision model downloads.
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(NER_MODEL_ID, { revision: NER_MODEL_REVISION }),
      AutoModelForTokenClassification.from_pretrained(NER_MODEL_ID, { device: "wasm", dtype: "q8", revision: NER_MODEL_REVISION }),
    ]);
    return new TokenClassificationPipeline({ task: "token-classification", tokenizer, model }) as unknown as TokenClassifier;
  },
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
    postMessage({ id: request.id, progress: { phase: "running", cache: await modelCache.inspect() }, type: "progress" } satisfies NerDetectionResponse);
    const candidates = await runNormalizedNerDetection(request.text, detector);
    postMessage({
      id: request.id,
      candidates,
      type: "success",
    } satisfies NerDetectionResponse);
  } catch {
    postMessage({ id: request.id, progress: { phase: "loading", cache: await modelCache.inspect() }, type: "progress" } satisfies NerDetectionResponse);
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
