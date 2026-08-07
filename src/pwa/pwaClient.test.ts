import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canUsePwaServiceWorker,
  registerPwaServiceWorker,
} from "./pwaClient";

describe("pwaClient", () => {
  const originalServiceWorker = navigator.serviceWorker;

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });
  });

  it("開発環境ではService Workerを利用しない", () => {
    vi.stubEnv("PROD", false);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: vi.fn() },
    });

    expect(canUsePwaServiceWorker()).toBe(false);
  });

  it("本番環境ではルートスコープへService Workerを登録する", async () => {
    vi.stubEnv("PROD", true);
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    await expect(registerPwaServiceWorker()).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });
});
