import { describe, expect, it, vi } from "vitest";
import { createRetryableLoader } from "./retryableLoader";

describe("createRetryableLoader", () => {
  it("初期化失敗後は失敗Promiseを破棄して次回に再試行する", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("download failed"))
      .mockResolvedValueOnce("detector");
    const loader = createRetryableLoader(load);

    await expect(loader.load()).rejects.toThrow("download failed");
    await expect(loader.load()).resolves.toBe("detector");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("同時に呼ばれた初期化処理は同じPromiseを共有する", async () => {
    let resolveLoad: (value: string) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const loader = createRetryableLoader(load);

    const first = loader.load();
    const second = loader.load();
    resolveLoad("detector");

    await expect(first).resolves.toBe("detector");
    await expect(second).resolves.toBe("detector");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
