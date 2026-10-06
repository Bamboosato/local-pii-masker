import {
  CircleAlert,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelCacheStatus } from "../domain/detection/ner/modelCache";
import {
  canUsePwaServiceWorker,
  registerPwaServiceWorker,
} from "../pwa/pwaClient";

type PwaRegistrationState = "registering" | "ready" | "error" | "unsupported";

export type PwaModelState = "unknown" | "loading" | "available" | "unavailable";

type PwaStatusProps = {
  hasSessionData: boolean;
  modelState?: PwaModelState;
  cacheStatus?: ModelCacheStatus;
  onClearModelCache?: () => void;
  modelBusy?: boolean;
};

export function PwaStatus({
  hasSessionData,
  modelState = "unknown",
  cacheStatus = { state: "unknown" },
  onClearModelCache,
  modelBusy = false,
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

  const cacheWarning = (modelState === "available" || modelState === "unavailable") && (Boolean(cacheStatus.issue) || ["partial", "unavailable"].includes(cacheStatus.state));
  if (registrationState === "unsupported" && isOnline && !cacheWarning && modelState !== "unavailable") return null;
  const shouldShowStatus =
    !isOnline ||
    updateAvailable ||
    registrationState === "error" ||
    modelState === "loading" ||
    modelState === "unavailable" || cacheWarning;

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
          : modelState === "unavailable" ? "モデル利用不可" : "モデルキャッシュ未完了";

  const statusDescription = !isOnline
    ? cacheStatus.state === "complete"
      ? "必要なモデル資材をキャッシュで確認しました。再起動後のAI検出を試して利用可否を確認してください。形式検出と手動追加も利用できます。"
      : "モデルキャッシュが未完了または未確認です。オフラインでは形式検出と手動追加を利用できます。"
    : updateAvailable && hasSessionData
      ? "入力中のセッションを保持するため、更新を延期しています。"
      : registrationState === "error"
        ? "Service Workerを登録できないため、オフライン利用は保証されません。"
        : modelState === "loading"
          ? "NERモデルを準備しています。完了するまで形式検出と手動追加を利用できます。"
          : modelState === "unavailable"
            ? "NERモデルを利用できません。形式検出と手動追加は利用できます。"
            : `AI検出は利用できましたが、モデル資材の保存は未完了です。オンラインで再試行してください。${cacheStatus.issue === "quota" ? "保存容量の上限に達しました。" : cacheStatus.issue === "permission" ? "ブラウザが保存を許可していません。" : cacheStatus.issue ? "キャッシュを読み書きできませんでした。容量不足とは断定できません。" : ""} サイトデータ全体の削除は、保存済み対応表も失うため行わないでください。`;

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
        ) : registrationState === "error" || modelState === "unavailable" || cacheWarning ? (
          <CircleAlert aria-hidden="true" size={14} />
        ) : (
          <RefreshCw aria-hidden="true" size={14} />
        )}
        {statusLabel}
      </span>
      <span className="pwa-status-tooltip">{statusDescription}{cacheWarning && cacheStatus.usageBytes !== undefined && cacheStatus.quotaBytes !== undefined ? ` 同一サイト全体の概算使用量 ${Math.round(cacheStatus.usageBytes / 1024 / 1024)}MB／上限 ${Math.round(cacheStatus.quotaBytes / 1024 / 1024)}MB（対応表を含み、空き容量の保証ではありません）。` : ""}</span>
      {cacheWarning && onClearModelCache ? <button className="pwa-status-button" disabled={modelBusy} onClick={onClearModelCache} type="button">モデルキャッシュを削除</button> : null}
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
