import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PwaStatus } from "./PwaStatus";

function createRegistration(waiting?: ServiceWorker) {
  return {
    waiting,
    installing: null,
    addEventListener: vi.fn(),
  } as unknown as ServiceWorkerRegistration;
}

describe("PwaStatus", () => {
  const originalServiceWorker = navigator.serviceWorker;

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });
  });

  function mockServiceWorker(registration: ServiceWorkerRegistration) {
    const serviceWorker = {
      controller: {},
      register: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });
    vi.stubEnv("PROD", true);
    return serviceWorker;
  }

  it("通常状態ではPWAと未確認のNER状態を表示しない", async () => {
    const serviceWorker = mockServiceWorker(mockRegistration());

    render(<PwaStatus hasSessionData={false} modelState="available" />);

    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalled());
    expect(screen.queryByRole("status", { name: "PWA状態" })).not.toBeInTheDocument();
  });

  it("モデル失敗時は利用不可を表示する", async () => {
    mockServiceWorker(mockRegistration());

    render(<PwaStatus hasSessionData={false} modelState="unavailable" />);

    expect(await screen.findByRole("status", { name: "PWA状態" })).toHaveTextContent(
      "モデル利用不可",
    );
  });

  it("推論成功とキャッシュ失敗を別々に示し、公開モデルだけを削除する操作を提供する", async () => {
    mockServiceWorker(mockRegistration());
    const clear = vi.fn();
    const user = userEvent.setup();
    render(<PwaStatus hasSessionData modelState="available" cacheStatus={{ state: "partial", issue: "internal" }} onClearModelCache={clear} />);
    expect(await screen.findByRole("status", { name: "PWA状態" })).toHaveTextContent("モデルキャッシュ未完了");
    expect(screen.getByText(/容量不足とは断定できません/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "モデルキャッシュを削除" }));
    expect(clear).toHaveBeenCalledOnce();
  });
  it("AI検出中はキャッシュ削除を禁止する", async () => {
    mockServiceWorker(mockRegistration());
    render(<PwaStatus hasSessionData modelState="available" cacheStatus={{ state: "partial", issue: "quota" }} modelBusy onClearModelCache={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "モデルキャッシュを削除" })).toBeDisabled();
  });

  it("編集中は更新を適用せず延期する", async () => {
    const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
    mockServiceWorker(mockRegistration(waiting));

    render(<PwaStatus hasSessionData />);

    const updateButton = await screen.findByRole("button", { name: "後で更新" });
    expect(updateButton).toBeDisabled();
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  it("入力がないときは更新を明示適用できる", async () => {
    const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
    mockServiceWorker(mockRegistration(waiting));
    const user = userEvent.setup();

    render(<PwaStatus hasSessionData={false} />);

    const updateButton = await screen.findByRole("button", { name: "更新" });
    await user.click(updateButton);

    await waitFor(() =>
      expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" }),
    );
  });
});

function mockRegistration(waiting?: ServiceWorker) {
  return createRegistration(waiting);
}
