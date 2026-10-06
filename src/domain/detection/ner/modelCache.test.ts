import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPublicModelCache, createPinnedModelFetch, createPublicModelCache, MODEL_ASSET_BASE, MODEL_CACHE_NAME, REQUIRED_MODEL_FILES } from "./modelCache";

function mockCache() {
  const files = new Map<string, Response>();
  const storage = {
    match: vi.fn(async (key: string) => files.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => { files.set(key, response.clone()); }),
    delete: vi.fn(async (key: string) => files.delete(key)),
  };
  const open = vi.fn(async () => storage);
  vi.stubGlobal("caches", { open });
  return { files, storage, open };
}

afterEach(() => vi.unstubAllGlobals());

describe("public model cache boundaries and failure recovery", () => {
  it("ライブラリのmain事前確認も固定リビジョンへ限定し、本文や任意URLを送らない", async () => {
    const transport = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("public"));
    const modelFetch = createPinnedModelFetch(transport);
    await modelFetch(MODEL_ASSET_BASE.replace("8d70fc4", "main") + "tokenizer_config.json");
    expect(transport).toHaveBeenCalledWith(MODEL_ASSET_BASE + "tokenizer_config.json", undefined);
    for (const url of ["合成原文", MODEL_ASSET_BASE + "config.json?private=marker", "https://example.com/config.json"]) {
      await expect(modelFetch(url)).rejects.toThrow("許可されていない");
    }
    await expect(modelFetch(MODEL_ASSET_BASE + "config.json", { method: "POST", body: "private" })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("必要資材の一部だけでは完了にせず、全件をキャッシュで読めた場合だけ取得済みにする", async () => {
    mockCache();
    const model = createPublicModelCache();
    expect((await model.inspect()).state).toBe("partial");
    await model.cache.put(`${MODEL_ASSET_BASE}${REQUIRED_MODEL_FILES[0]}`, new Response("public"));
    expect((await model.inspect()).state).toBe("partial");
    for (const file of REQUIRED_MODEL_FILES) await model.cache.put(`${MODEL_ASSET_BASE}${file}`, new Response("public"));
    expect((await createPublicModelCache().inspect()).state).toBe("complete");
    expect(await model.cache.match(MODEL_ASSET_BASE.replace("8d70fc4", "main") + "tokenizer_config.json")).toBeDefined();
  });
  it.each([["QuotaExceededError", "quota"], ["UnknownError", "internal"], ["NotAllowedError", "permission"]])("putの%sでオンライン推論を妨げず、原因を断定しすぎない", async (name, issue) => {
    const { storage } = mockCache();
    storage.put.mockRejectedValue(new DOMException("must not expose exception detail", name));
    const model = createPublicModelCache();
    await expect(model.cache.put(`${MODEL_ASSET_BASE}tokenizer.json`, new Response("public"))).resolves.toBeUndefined();
    expect(await model.inspect()).toMatchObject({ state: "partial", issue });
    expect(JSON.stringify(await model.inspect())).not.toContain("exception detail");
  });
  it("open・match失敗とAPI未対応でもモデル取得へ進める", async () => {
    const { open, storage } = mockCache();
    open.mockRejectedValue(new DOMException("denied", "SecurityError"));
    const model = createPublicModelCache();
    await expect(model.cache.match(`${MODEL_ASSET_BASE}config.json`)).resolves.toBeUndefined();
    expect(await model.inspect()).toMatchObject({ state: "unavailable", issue: "permission" });
    open.mockResolvedValue(storage);
    storage.match.mockRejectedValue(new DOMException("internal", "UnknownError"));
    await expect(model.cache.match(`${MODEL_ASSET_BASE}config.json`)).resolves.toBeUndefined();
    expect((await model.inspect()).state).toBe("unavailable");
    vi.stubGlobal("caches", undefined);
    expect(await createPublicModelCache().inspect()).toMatchObject({ state: "unavailable", issue: "unavailable" });
  });
  it("入力本文・別モデル・リビジョン違い・クエリ・非成功レスポンスを保存しない", async () => {
    const { storage } = mockCache();
    const model = createPublicModelCache();
    for (const key of ["合成入力", "https://example.com/config.json", `${MODEL_ASSET_BASE}config.json?private=marker`, MODEL_ASSET_BASE.replace("8d70fc4", "0000000") + "config.json"]) {
      await model.cache.put(key, new Response("rejected"));
      expect(await model.cache.match(key)).toBeUndefined();
    }
    await model.cache.put(`${MODEL_ASSET_BASE}config.json`, new Response("not found", { status: 404 }));
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.match).not.toHaveBeenCalled();
  });
  it("削除は現在モデルの公開4資材だけに限定し、他モデルやアプリ資材を保持する", async () => {
    const { files, open, storage } = mockCache();
    for (const file of REQUIRED_MODEL_FILES) files.set(`${MODEL_ASSET_BASE}${file}`, new Response("public"));
    files.set("https://example.com/app.js", new Response("app shell"));
    files.set("https://huggingface.co/other/model/resolve/main/config.json", new Response("another model"));
    await clearPublicModelCache();
    expect(open).toHaveBeenCalledWith(MODEL_CACHE_NAME);
    expect(storage.delete).toHaveBeenCalledTimes(4);
    expect(files.size).toBe(2);
  });
  it("削除に失敗した資材が残っていれば成功扱いしない", async () => {
    const { files, storage } = mockCache();
    files.set(`${MODEL_ASSET_BASE}config.json`, new Response("public"));
    storage.delete.mockResolvedValue(false);
    await expect(clearPublicModelCache()).rejects.toThrow("削除を完了");
  });
});
