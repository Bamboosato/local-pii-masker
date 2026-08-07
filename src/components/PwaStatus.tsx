import {
  CircleAlert,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  canUsePwaServiceWorker,
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
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const isApplyingUpdateRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (!canUsePwaServiceWorker()) {
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
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

  const shouldShowStatus =
    !isOnline ||
    updateAvailable ||
    registrationState === "error" ||
    modelState === "loading" ||
    modelState === "unavailable";

  if (!shouldShowStatus) {
    return null;
  }

  const statusLabel = !isOnline
    ? "オフライン"
    : updateAvailable
      ? hasSessionData
        ? "更新を保留中"
        : "更新可能"
      : registrationState === "error"
        ? "オフライン利用不可"
        : modelState === "loading"
          ? "モデル準備中"
          : "モデル利用不可";

  const statusDescription = !isOnline
    ? "公開資産のキャッシュを利用しています。モデル未取得時は形式検出と手動追加を利用できます。"
    : updateAvailable && hasSessionData
      ? "入力中のセッションを保持するため、更新を延期しています。"
      : registrationState === "error"
        ? "Service Workerを登録できないため、オフライン利用は保証されません。"
        : modelState === "loading"
          ? "NERモデルを準備しています。完了するまで形式検出と手動追加を利用できます。"
          : "NERモデルを利用できません。形式検出と手動追加は利用できます。";

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
        ) : registrationState === "error" || modelState === "unavailable" ? (
          <CircleAlert aria-hidden="true" size={14} />
        ) : (
          <RefreshCw aria-hidden="true" size={14} />
        )}
        {statusLabel}
      </span>
      <span className="pwa-status-tooltip">{statusDescription}</span>
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
