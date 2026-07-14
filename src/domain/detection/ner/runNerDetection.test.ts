import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NerDetectionResponse } from "./types";

type MessageListener = (event: MessageEvent<NerDetectionResponse>) => void;
type ErrorListener = (event: ErrorEvent) => void;

class MockWorker {
  static instances: MockWorker[] = [];

  readonly messages: unknown[] = [];
  readonly messageListeners = new Set<MessageListener>();
  readonly errorListeners = new Set<ErrorListener>();
  terminated = false;

  constructor() {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "message") {
      this.messageListeners.add(listener as MessageListener);
    } else if (type === "error") {
      this.errorListeners.add(listener as ErrorListener);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "message") {
      this.messageListeners.delete(listener as MessageListener);
    } else if (type === "error") {
      this.errorListeners.delete(listener as ErrorListener);
    }
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emitMessage(data: NerDetectionResponse) {
    const event = new MessageEvent<NerDetectionResponse>("message", { data });

    for (const listener of this.messageListeners) {
      listener(event);
    }
  }

  emitError() {
    const event = new ErrorEvent("error");

    for (const listener of this.errorListeners) {
      listener(event);
    }
  }
}

describe("runNerDetection", () => {
  beforeEach(() => {
    vi.resetModules();
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("進捗と成功結果を返し、成功したWorkerを次回も再利用する", async () => {
    const { runNerDetection } = await import("./runNerDetection");
    const onProgress = vi.fn();
    const firstResult = runNerDetection("山田太郎", {
      onProgress,
      timeoutMs: 1000,
    });
    const firstWorker = MockWorker.instances[0];

    firstWorker.emitMessage({
      id: 1,
      progress: { phase: "loading" },
      type: "progress",
    });
    firstWorker.emitMessage({ id: 1, candidates: [], type: "success" });

    await expect(firstResult).resolves.toEqual([]);
    expect(onProgress).toHaveBeenCalledWith({ phase: "loading" });
    expect(firstWorker.messageListeners.size).toBe(0);
    expect(firstWorker.errorListeners.size).toBe(0);
    expect(firstWorker.terminated).toBe(false);

    const secondResult = runNerDetection("佐藤花子", { timeoutMs: 1000 });
    expect(MockWorker.instances).toHaveLength(1);
    firstWorker.emitMessage({ id: 2, candidates: [], type: "success" });
    await expect(secondResult).resolves.toEqual([]);
  });

  it("Workerからエラーが返った場合は破棄し、次回呼び出しで再生成する", async () => {
    const { runNerDetection } = await import("./runNerDetection");
    const firstResult = runNerDetection("山田太郎", { timeoutMs: 1000 });
    const firstWorker = MockWorker.instances[0];

    firstWorker.emitMessage({
      id: 1,
      message: "AI検出を実行できませんでした。",
      type: "error",
    });

    await expect(firstResult).rejects.toThrow("AI検出を実行できませんでした");
    expect(firstWorker.terminated).toBe(true);

    const retryResult = runNerDetection("山田太郎", { timeoutMs: 1000 });
    const retryWorker = MockWorker.instances[1];
    expect(MockWorker.instances).toHaveLength(2);
    retryWorker.emitMessage({ id: 2, candidates: [], type: "success" });
    await expect(retryResult).resolves.toEqual([]);
  });

  it("Worker自体のエラーでも破棄し、次回呼び出しで再生成する", async () => {
    const { runNerDetection } = await import("./runNerDetection");
    const firstResult = runNerDetection("山田太郎", { timeoutMs: 1000 });
    const firstWorker = MockWorker.instances[0];

    firstWorker.emitError();

    await expect(firstResult).rejects.toThrow("NER検出でエラーが発生しました");
    expect(firstWorker.terminated).toBe(true);

    const retryResult = runNerDetection("山田太郎", { timeoutMs: 1000 });
    const retryWorker = MockWorker.instances[1];
    expect(MockWorker.instances).toHaveLength(2);
    retryWorker.emitMessage({ id: 2, candidates: [], type: "success" });
    await expect(retryResult).resolves.toEqual([]);
  });

  it("タイムアウト時はWorkerを破棄して専用エラーを返す", async () => {
    vi.useFakeTimers();
    const { runNerDetection } = await import("./runNerDetection");
    const result = runNerDetection("山田太郎", { timeoutMs: 10 });
    const assertion = expect(result).rejects.toMatchObject({
      name: "NerDetectionTimeoutError",
    });

    await vi.advanceTimersByTimeAsync(11);

    await assertion;
    expect(MockWorker.instances[0].terminated).toBe(true);
  });

  it("AbortSignalで中止した場合は理由を保持してWorkerを破棄する", async () => {
    const { runNerDetection } = await import("./runNerDetection");
    const controller = new AbortController();
    const result = runNerDetection("山田太郎", {
      signal: controller.signal,
      timeoutMs: 1000,
    });
    const assertion = expect(result).rejects.toMatchObject({
      name: "NerDetectionCancelledError",
      reason: "manual",
    });

    controller.abort("manual");

    await assertion;
    expect(MockWorker.instances[0].terminated).toBe(true);
  });
});
