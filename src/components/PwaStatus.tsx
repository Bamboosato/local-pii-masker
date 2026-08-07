import {
  CircleAlert,
  Download,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  canUsePwaServiceWorker,
  type BeforeInstallPromptEvent,
  registerPwaServiceWorker,
} from "../pwa/pwaClient";

type PwaRegistrationState = "registering" | "ready" | "error" | "unsupported";

export type PwaModelState = "unknown" | "loading" | "available" | "unavailable";

type PwaStatusProps = {
  hasSessionData: boolean;
  modelState?: PwaModelState;
};

export function PwaStatus({
  hasSessionData,
  modelState = "unknown",
}: PwaStatusProps) {
  const [registrationState, setRegistrationState] =
    useState<PwaRegistrationState>(() =>
      canUsePwaServiceWorker() ? "registering" : "unsupported",
    );
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent>();
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const isApplyingUpdateRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(undefined);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    if (!canUsePwaServiceWorker()) {
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        window.removeEventListener(
          "beforeinstallprompt",
          handleBeforeInstallPrompt,
        );
        window.removeEventListener("appinstalled", handleInstalled);
      };
    }

    const serviceWorkerContainer = navigator.serviceWorker;
    let disposed = false;
    const watchRegistration = (nextRegistration: ServiceWorkerRegistration) => {
      if (nextRegistration.waiting) {
        setUpdateAvailable(true);
      }

      nextRegistration.addEventListener("updatefound", () => {
        const installingWorker = nextRegistration.installing;
        if (!installingWorker) {
          return;
        }

        installingWorker.addEventListener("statechange", () => {
          if (
            installingWorker.state === "installed" &&
            serviceWorkerContainer.controller
          ) {
            setUpdateAvailable(true);
          }
        });
      });
    };

    registerPwaServiceWorker()
      .then((nextRegistration) => {
        if (disposed) {
          return;
        }
        setRegistration(nextRegistration);
        setRegistrationState("ready");
        watchRegistration(nextRegistration);
      })
      .catch(() => {
        if (!disposed) {
          setRegistrationState("error");
        }
      });

    return () => {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!canUsePwaServiceWorker()) {
      return undefined;
    }

    const serviceWorkerContainer = navigator.serviceWorker;
    const handleControllerChange = () => {
      if (isApplyingUpdateRef.current) {
        window.location.reload();
      }
    };

    serviceWorkerContainer.addEventListener(
      "controllerchange",
      handleControllerChange,
    );
    return () =>
      serviceWorkerContainer.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
  }, []);

  if (registrationState === "unsupported") {
    return null;
  }

  const statusLabel = !isOnline
    ? "オフライン"
    : updateAvailable
      ? hasSessionData
        ? "更新を保留中"
        : "更新可能"
      : registrationState === "error"
        ? "PWA未登録"
        : registrationState === "registering"
          ? "PWA準備中"
          : "PWA準備完了";

  const statusDescription = !isOnline
    ? "公開資産のキャッシュを利用しています。モデル未取得時は形式検出と手動追加を利用できます。"
    : updateAvailable && hasSessionData
        ? "入力中のセッションを保持するため、更新を延期しています。"
      : registrationState === "error"
        ? "通常のブラウザアプリとして利用を継続できます。"
        : "入力内容はService Workerのキャッシュへ保存されません。";

  const modelLabel = getModelLabel(modelState);

  async function handleInstall() {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(undefined);
  }

  function handleApplyUpdate() {
    if (hasSessionData || !registration?.waiting) {
      return;
    }

    isApplyingUpdateRef.current = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }

  return (
    <div
      aria-label="PWA状態"
      className={`pwa-status${!isOnline ? " is-offline" : ""}${updateAvailable ? " has-update" : ""}`}
      role="status"
    >
      <span className="pwa-status-label">
        {!isOnline ? (
          <WifiOff aria-hidden="true" size={14} />
        ) : registrationState === "error" ? (
          <CircleAlert aria-hidden="true" size={14} />
        ) : (
          <Wifi aria-hidden="true" size={14} />
        )}
        {statusLabel}
      </span>
      <span aria-label={`NERモデル: ${modelLabel}`} className="pwa-status-model">
        NER: {modelLabel}
      </span>
      <span className="pwa-status-tooltip">{statusDescription}</span>
      {installPrompt ? (
        <button
          className="pwa-status-button"
          onClick={handleInstall}
          title="アプリとしてインストール"
          type="button"
        >
          <Download aria-hidden="true" size={14} />
          インストール
        </button>
      ) : null}
      {updateAvailable ? (
        <button
          className="pwa-status-button"
          disabled={hasSessionData}
          onClick={handleApplyUpdate}
          title={
            hasSessionData
              ? "入力中のため更新を保留しています"
              : "アプリを更新"
          }
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
          {hasSessionData ? "後で更新" : "更新"}
        </button>
      ) : null}
    </div>
  );
}

function getModelLabel(modelState: PwaModelState): string {
  switch (modelState) {
    case "loading":
      return "準備中";
    case "available":
      return "利用可能";
    case "unavailable":
      return "利用不可";
    case "unknown":
      return "未確認";
  }
}
