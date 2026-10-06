import { NER_MODEL_ID, NER_MODEL_REVISION } from "./types";

export const MODEL_CACHE_NAME = "transformers-cache";
export const MODEL_ASSET_BASE = `https://huggingface.co/${NER_MODEL_ID}/resolve/${NER_MODEL_REVISION}/`;
export const REQUIRED_MODEL_FILES = [
  "config.json", "tokenizer_config.json", "tokenizer.json", "onnx/model_quantized.onnx",
] as const;

export type ModelCacheIssue = "quota" | "permission" | "unavailable" | "internal";
export type ModelCacheStatus = {
  state: "unknown" | "complete" | "partial" | "unavailable";
  issue?: ModelCacheIssue;
  usageBytes?: number;
  quotaBytes?: number;
};

function publicModelAsset(request: string): boolean {
  // Exact public URLs only. Never accept text, arbitrary paths, query parameters,
  // another model or CDN redirect URLs as persistent cache keys.
  return REQUIRED_MODEL_FILES.some((file) => request === `${MODEL_ASSET_BASE}${file}`);
}

function pinMetadataUrl(url: string): string {
  const defaultBase = `https://huggingface.co/${NER_MODEL_ID}/resolve/main/`;
  return url.startsWith(defaultBase) ? MODEL_ASSET_BASE + url.slice(defaultBase.length) : url;
}

export function createPinnedModelFetch(transport: (input: string | URL, init?: RequestInit) => Promise<Response>): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const pinned = pinMetadataUrl(url);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (!publicModelAsset(pinned) || method !== "GET" || init?.body != null || input instanceof Request) {
      throw new Error("許可されていないモデル資材の取得です。");
    }
    return transport(pinned, init);
  };
}

function cacheIssue(error: unknown): ModelCacheIssue {
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") return "quota";
    if (error.name === "SecurityError" || error.name === "NotAllowedError") return "permission";
  }
  return "internal";
}

export function createPublicModelCache() {
  let issue: ModelCacheIssue | undefined;
  const open = async () => {
    if (typeof caches === "undefined") {
      issue = "unavailable";
      return undefined;
    }
    try {
      return await caches.open(MODEL_CACHE_NAME);
    } catch (error) {
      issue = cacheIssue(error);
      return undefined;
    }
  };
  const cache = {
    async match(request: string): Promise<Response | undefined> {
      // Library metadata probes use main even when model loading is pinned.
      // Resolve these reads to the same fixed assets, including while offline.
      const key = pinMetadataUrl(request);
      if (!publicModelAsset(key)) return undefined;
      try {
        const response = await (await open())?.match(key);
        return response?.ok ? response : undefined;
      } catch (error) {
        issue = cacheIssue(error);
        return undefined;
      }
    },
    async put(request: string, response: Response): Promise<void> {
      if (!publicModelAsset(request) || !response.ok) return;
      try {
        await (await open())?.put(request, response);
      } catch (error) {
        // Caching failure must not turn successful online inference into failure.
        // Keep a bounded error code, never exception text or input content.
        issue = cacheIssue(error);
      }
    },
  };
  return {
    cache,
    async inspect(): Promise<ModelCacheStatus> {
      const storage = await open();
      if (!storage) return { state: "unavailable", issue };
      let present = 0;
      try {
        for (const file of REQUIRED_MODEL_FILES) {
          if ((await storage.match(`${MODEL_ASSET_BASE}${file}`))?.ok) present += 1;
        }
      } catch (error) {
        issue = cacheIssue(error);
        return { state: "unavailable", issue };
      }
      const status: ModelCacheStatus = {
        state: present === REQUIRED_MODEL_FILES.length ? "complete" : "partial",
        ...(issue ? { issue } : {}),
      };
      try {
        const estimate = await navigator.storage?.estimate?.();
        // Origin-wide estimates include OPFS. They cannot diagnose cache failure
        // or guarantee space; neither filenames nor user content are recorded.
        if (estimate?.usage !== undefined) status.usageBytes = estimate.usage;
        if (estimate?.quota !== undefined) status.quotaBytes = estimate.quota;
      } catch { /* Availability does not depend on an optional estimate. */ }
      return status;
    },
  };
}

export async function inspectPublicModelCache(): Promise<ModelCacheStatus> {
  return createPublicModelCache().inspect();
}

export async function clearPublicModelCache(): Promise<void> {
  if (typeof caches === "undefined") throw new Error("モデルキャッシュを操作できません。");
  const cache = await caches.open(MODEL_CACHE_NAME);
  // Delete only this revision's known public assets. OPFS, the app shell and
  // other models remain outside this interface.
  for (const file of REQUIRED_MODEL_FILES) {
    await cache.delete(`${MODEL_ASSET_BASE}${file}`);
  }
  for (const file of REQUIRED_MODEL_FILES) {
    if (await cache.match(`${MODEL_ASSET_BASE}${file}`)) {
      throw new Error("モデルキャッシュの削除を完了できませんでした。");
    }
  }
}
