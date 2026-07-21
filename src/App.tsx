import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Eraser,
  Eye,
  EllipsisVertical,
  Info,
  LoaderCircle,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  appReducer,
  type EntryFilter,
  initialAppState,
} from "./app/reducer";
import {
  getNormalizationAvailability,
  getNormalizationAvailabilityMessage,
} from "./app/normalizationAvailability";
import {
  selectActiveEntries,
  selectMaskedText,
  selectRestoredResponse,
  selectSessionCounts,
  selectTokenInspection,
  selectVisibleEntries,
} from "./app/selectors";
import { OriginalTextEditor } from "./components/OriginalTextEditor";
import { TextNormalizationDialog } from "./components/TextNormalizationDialog";
import type { DetectionCandidate } from "./domain/detection/mergeCandidates";
import { enrichPersonCandidates } from "./domain/detection/enrichPersonCandidates";
import { refineDetectionCandidates } from "./domain/detection/refineDetectionCandidates";
import {
  NerDetectionCancelledError,
  runNerDetection,
} from "./domain/detection/ner/runNerDetection";
import type { NerDetectionProgress } from "./domain/detection/ner/types";
import { runRegexDetection } from "./domain/detection/regex/runRegexDetection";
import { countOccurrences } from "./domain/mask/findOccurrences";
import { buildHighlightSegments } from "./domain/mask/highlightText";
import { buildMaskSegments } from "./domain/mask/maskText";
import { createMaskToken } from "./domain/mask/tokenFactory";
import { normalizeText } from "./domain/normalization/normalizeText";
import { useTextNormalization } from "./hooks/useTextNormalization";
import {
  CATEGORY_LABELS,
  MASK_CATEGORIES,
  NORMALIZATION_RULE_LABELS,
  SOURCE_LABELS,
  type MaskCategory,
  type MaskEntry,
} from "./domain/types";

const MAX_CHAR_COUNT = 10000;
const DETECTION_PROGRESS_DELAY_MS = 1000;
type DetectionPhase = "idle" | "regex" | "ner-loading" | "ner-running";
type NerDetectionOutcome = "success" | "failed" | "cancelled";
type DetectionCancellationReason =
  | "manual"
  | "source-changed"
  | "session-cleared"
  | "unmount";

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [selectedText, setSelectedText] = useState("");
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualCategory, setManualCategory] = useState<MaskCategory>("PERSON");
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [entrySearchOpen, setEntrySearchOpen] = useState(false);
  const [detectionPhase, setDetectionPhase] = useState<DetectionPhase>("idle");
  const [showDetectionProgress, setShowDetectionProgress] = useState(false);
  const normalization = useTextNormalization();
  const detectionAbortRef = useRef<AbortController | undefined>(undefined);
  const latestDetectionMergeContextRef = useRef({
    entries: state.entries,
    originalText: state.originalText,
  });
  const lastSelectionControlRef = useRef<HTMLButtonElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const headerMenuButtonRef = useRef<HTMLButtonElement>(null);
  const clearMenuItemRef = useRef<HTMLButtonElement>(null);
  const normalizationMenuItemRef = useRef<HTMLButtonElement>(null);
  const detectionButtonRef = useRef<HTMLButtonElement>(null);
  const entrySearchButtonRef = useRef<HTMLButtonElement>(null);
  const entrySearchInputRef = useRef<HTMLInputElement>(null);
  const entryListRef = useRef<HTMLDivElement>(null);
  const maskedText = selectMaskedText(state);
  const counts = selectSessionCounts(state);
  const visibleEntries = selectVisibleEntries(state);
  const activeEntries = selectActiveEntries(state.entries);
  const restoration = selectRestoredResponse(state);
  const tokenInspection = selectTokenInspection(state);
  const isDetecting = detectionPhase !== "idle";
  const normalizationAvailability = getNormalizationAvailability({
    originalText: state.originalText,
    normalizationLockReason: state.normalizationLockReason,
    isDetecting,
    isNormalizing: normalization.state.open,
  });
  const normalizationAvailabilityMessage = getNormalizationAvailabilityMessage(
    normalizationAvailability,
  );
  const hasSessionData =
    state.originalText.length > 0 ||
    state.entries.length > 0 ||
    state.externalResponse.length > 0;
  const manualPreviewToken = useMemo(() => {
    const normalizedSelection = normalizeText(selectedText);
    const existing = state.entries.find(
      (entry) => entry.normalizedText === normalizedSelection,
    );

    return (
      existing?.token ??
      createMaskToken(manualCategory, {
        originalText: state.originalText,
        entries: state.entries,
      })
    );
  }, [manualCategory, selectedText, state.entries, state.originalText]);
  const maskedSegments = useMemo(
    () => buildMaskSegments(state.originalText, state.entries),
    [state.entries, state.originalText],
  );
  const originalHighlightSegments = useMemo(
    () => buildHighlightSegments(state.originalText, state.entries),
    [state.entries, state.originalText],
  );

  useEffect(() => {
    latestDetectionMergeContextRef.current = {
      entries: state.entries,
      originalText: state.originalText,
    };
  }, [state.entries, state.originalText]);

  useEffect(
    () => () => {
      const controller = detectionAbortRef.current;

      if (controller && !controller.signal.aborted) {
        controller.abort("unmount" satisfies DetectionCancellationReason);
      }
    },
    [],
  );

  useEffect(() => {
    if (entrySearchOpen) {
      window.requestAnimationFrame(() => entrySearchInputRef.current?.focus());
    }
  }, [entrySearchOpen]);

  useEffect(() => {
    if (!headerMenuOpen) {
      return;
    }

    normalizationMenuItemRef.current?.focus();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !headerMenuRef.current?.contains(event.target)
      ) {
        setHeaderMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHeaderMenuOpen(false);
        headerMenuButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [headerMenuOpen]);

  useEffect(() => {
    if (!state.notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      dispatch({ type: "setNotice" });
    }, 2800);

    return () => window.clearTimeout(timeout);
  }, [state.notice]);

  useEffect(() => {
    if (!isDetecting) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowDetectionProgress(true);
    }, DETECTION_PROGRESS_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [isDetecting]);

  function openManualDialog() {
    const normalizedSelection = selectedText.normalize("NFC");

    if (normalizedSelection.trim().length === 0) {
      dispatch({ type: "setNotice", value: "文字列を選択してください。" });
      return;
    }

    setSelectedText(normalizedSelection);
    setManualDialogOpen(true);
  }

  function addManualEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({
      type: "addManualEntry",
      value: {
        id: createEntryId(),
        selectedText,
        category: manualCategory,
      },
    });
    setManualDialogOpen(false);
    lastSelectionControlRef.current?.focus();
  }

  function openNormalizationDialog() {
    if (normalizationAvailability.state !== "enabled") {
      return;
    }
    setHeaderMenuOpen(false);
    normalization.open(state.originalText, state.originalRevision);
  }

  function applyNormalization(
    value: string,
    expectedRevision: number,
  ) {
    dispatch({ type: "applyNormalizedOriginal", value, expectedRevision });
    normalization.close();
    window.requestAnimationFrame(() => detectionButtonRef.current?.focus());
  }

  async function copyMaskedText(force = false) {
    if (!force && (activeEntries.length === 0 || maskedText === state.originalText)) {
      setCopyConfirmOpen(true);
      return;
    }

    try {
      await navigator.clipboard.writeText(maskedText);
      dispatch({ type: "setNotice", value: "マスク結果をコピーしました。" });
    } catch {
      dispatch({
        type: "setNotice",
        value: "コピーできませんでした。手動で選択してコピーしてください。",
      });
    }
  }

  async function runAutoDetection() {
    if (state.originalText.trim().length === 0 || isDetecting) {
      return;
    }

    setShowDetectionProgress(false);
    setDetectionPhase("regex");
    dispatch({ type: "setNotice" });
    const detectionText = state.originalText;
    const detectionController = new AbortController();
    detectionAbortRef.current = detectionController;

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    try {
      const regexCandidates = runRegexDetection(detectionText);
      let nerCandidates: DetectionCandidate[] = [];
      let nerOutcome: NerDetectionOutcome = "success";

      try {
        setDetectionPhase("ner-loading");
        nerCandidates = await runNerDetection(detectionText, {
          signal: detectionController.signal,
          onProgress: (progress) => {
            setDetectionPhase(toDetectionPhase(progress));
          },
        });
      } catch (error) {
        if (error instanceof NerDetectionCancelledError) {
          if (error.reason === "source-changed") {
            dispatch({
              type: "setNotice",
              value:
                "原文が変更されたため、自動検出結果は反映しませんでした。もう一度自動検出してください。",
            });
            return;
          }

          if (error.reason === "session-cleared" || error.reason === "unmount") {
            return;
          }

          nerOutcome = "cancelled";
        } else {
          nerOutcome = "failed";
        }
      }

      const latestContext = latestDetectionMergeContextRef.current;

      if (latestContext.originalText !== detectionText) {
        dispatch({
          type: "setNotice",
          value:
            "原文が変更されたため、自動検出結果は反映しませんでした。もう一度自動検出してください。",
        });
        return;
      }

      const candidates = refineDetectionCandidates(
        detectionText,
        enrichPersonCandidates(detectionText, [
          ...regexCandidates,
          ...nerCandidates,
        ]),
      );
      const summary = summarizeDetectionMerge(latestContext.entries, candidates);

      dispatch({
        type: "completeDetection",
        candidates,
        createId: createEntryId,
        outcome: nerOutcome,
      });

      if (candidates.length > 0) {
        dispatch({ type: "setEntryFilter", value: "all" });
      }

      dispatch({
        type: "setNotice",
        value: formatDetectionNotice(candidates.length, summary, nerOutcome),
      });
    } catch {
      dispatch({
        type: "setNotice",
        value:
          "自動検出でエラーが発生しました。原文と既存のマスク設定は保持されています。",
      });
    } finally {
      if (detectionAbortRef.current === detectionController) {
        detectionAbortRef.current = undefined;
      }

      setShowDetectionProgress(false);
      setDetectionPhase("idle");
    }
  }

  function abortActiveDetection(reason: DetectionCancellationReason) {
    const controller = detectionAbortRef.current;

    if (controller && !controller.signal.aborted) {
      controller.abort(reason);
    }
  }

  function handleOriginalTextChange(value: string) {
    abortActiveDetection("source-changed");
    dispatch({ type: "setOriginalText", value });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-cluster">
          <h1>Local PII Masker</h1>
          <span
            aria-describedby="privacy-status-details"
            className="privacy-status"
            tabIndex={0}
          >
            <ShieldCheck aria-hidden="true" size={14} />
            ローカル処理・保存なし
            <span
              className="privacy-tooltip"
              id="privacy-status-details"
              role="tooltip"
            >
              公開モデル資材を取得する場合がありますが、入力内容は送信・保存されません。再読み込みまたは終了すると作業内容は失われます。
            </span>
          </span>
        </div>
        <div className="header-actions">
          <div className="header-menu" ref={headerMenuRef}>
            <button
              aria-controls="header-session-menu"
              aria-expanded={headerMenuOpen}
              aria-haspopup="menu"
              aria-label="メニュー"
              className="icon-button header-menu-trigger"
              disabled={!hasSessionData}
              onClick={() => setHeaderMenuOpen((open) => !open)}
              ref={headerMenuButtonRef}
              type="button"
            >
              <EllipsisVertical aria-hidden="true" size={20} />
            </button>
            {headerMenuOpen ? (
              <div
                aria-label="セッション操作"
                className="header-menu-popover"
                id="header-session-menu"
                role="menu"
              >
                <button
                  aria-describedby={
                    normalizationAvailabilityMessage
                      ? "normalization-menu-disabled-reason"
                      : undefined
                  }
                  aria-disabled={normalizationAvailability.state !== "enabled"}
                  className="header-menu-item"
                  onClick={openNormalizationDialog}
                  ref={normalizationMenuItemRef}
                  role="menuitem"
                  type="button"
                >
                  <Eraser aria-hidden="true" size={16} />
                  テキストを正規化
                </button>
                {normalizationAvailabilityMessage ? (
                  <span className="header-menu-disabled-reason" id="normalization-menu-disabled-reason">
                    {normalizationAvailabilityMessage}
                  </span>
                ) : null}
                <div aria-hidden="true" className="header-menu-separator" role="separator" />
                <button
                  className="header-menu-item danger"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setClearConfirmOpen(true);
                  }}
                  ref={clearMenuItemRef}
                  role="menuitem"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={16} />
                  すべて消去
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main aria-busy={isDetecting} className="main-grid">
        <section className="workspace" aria-label="テキストワークスペース">
          <div className="tabs">
            <div className="tab-list" role="tablist" aria-label="表示切り替え">
              <button
                aria-controls="original-panel"
                className={state.activeTextView === "original" ? "tab is-active" : "tab"}
                id="original-tab"
                role="tab"
                aria-selected={state.activeTextView === "original"}
                type="button"
                onClick={() => dispatch({ type: "setActiveTextView", value: "original" })}
              >
                原文
              </button>
              <button
                aria-controls="masked-panel"
                className={state.activeTextView === "masked" ? "tab is-active" : "tab"}
                id="masked-tab"
                role="tab"
                aria-selected={state.activeTextView === "masked"}
                type="button"
                onClick={() => dispatch({ type: "setActiveTextView", value: "masked" })}
              >
                マスク結果
              </button>
            </div>
            <div className="tab-actions">
              {state.activeTextView === "original" ? (
                <>
                  <button
                    className="button button-primary"
                    disabled={state.originalText.trim().length === 0}
                    onClick={() => {
                      if (isDetecting) {
                        abortActiveDetection("manual");
                      } else {
                        void runAutoDetection();
                      }
                    }}
                    ref={detectionButtonRef}
                    type="button"
                  >
                    {isDetecting ? <X aria-hidden="true" size={16} /> : <Search size={16} />}
                    {isDetecting
                      ? "中止"
                      : getDetectionButtonLabel(detectionPhase, state.entries)}
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={selectedText.trim().length === 0}
                    onClick={openManualDialog}
                    ref={lastSelectionControlRef}
                    type="button"
                  >
                    選択範囲を追加
                  </button>
                </>
              ) : (
                <button
                  className="button button-primary"
                  disabled={state.originalText.length === 0}
                  onClick={() => void copyMaskedText()}
                  type="button"
                >
                  <Copy size={16} />
                  コピー
                </button>
              )}
            </div>
          </div>

          <div className="editor-frame">
            {state.activeTextView === "original" ? (
              <div
                aria-label="原文パネル"
                className="text-view-panel"
                id="original-panel"
                role="tabpanel"
              >
                <OriginalTextEditor
                  highlights={originalHighlightSegments}
                  maxLength={MAX_CHAR_COUNT}
                  onChange={handleOriginalTextChange}
                  onSelectionChange={setSelectedText}
                  placeholder="個人情報をマスキングしたい日本語テキストを入力または貼り付けてください。"
                  selectedEntryId={state.selectedEntryId}
                  value={state.originalText}
                />
              </div>
            ) : (
              <div
                aria-label="マスク結果"
                className="masked-preview"
                id="masked-panel"
                role="tabpanel"
              >
                {state.originalText.length === 0 ? (
                  <span className="muted">マスク結果はここに表示されます。</span>
                ) : (
                  maskedSegments.map((segment, index) =>
                    segment.type === "token" ? (
                      <button
                        className="inline-token"
                        key={`${segment.entryId}-${index}`}
                        onClick={() => selectEntryFromMaskedResult(segment.entryId)}
                        type="button"
                      >
                        {segment.value}
                      </button>
                    ) : (
                      <span key={`text-${index}`}>{segment.value}</span>
                    ),
                  )
                )}
              </div>
            )}
          </div>

          <div
            className={
              state.activeTextView === "original"
                ? "workspace-footer is-compact"
                : "workspace-footer"
            }
          >
            {state.activeTextView === "original" ? (
              <span className="mono">
                文字数: {state.originalText.length.toLocaleString("ja-JP")} /{" "}
                {MAX_CHAR_COUNT.toLocaleString("ja-JP")}
              </span>
            ) : (
              <div className="result-summary">
                <p>
                  <Info size={16} />
                  自動検出はすべての個人情報を検出できるとは限りません。コピー前に原文とマスク結果を確認してください。
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className="management-panel" aria-label="マスク対象管理">
          <div className="panel-header">
            <strong>マスク対象</strong>
            <div className="panel-header-actions">
              <div className="filter-row" role="group" aria-label="候補フィルター">
                <FilterButton filter="all" current={state.entryFilter} onClick={setFilter}>
                  すべて ({counts.totalEntries})
                </FilterButton>
                <FilterButton filter="disabled" current={state.entryFilter} onClick={setFilter}>
                  無効 ({counts.disabledEntries})
                </FilterButton>
              </div>
              <button
                aria-controls="entry-search"
                aria-expanded={entrySearchOpen}
                aria-label={entrySearchOpen ? "検索を閉じる" : "マスク対象を検索"}
                className={`icon-button panel-search-toggle ${entrySearchOpen ? "is-active" : ""}`}
                onClick={() => {
                  if (entrySearchOpen) {
                    dispatch({ type: "setEntrySearch", value: "" });
                  }
                  setEntrySearchOpen((open) => !open);
                }}
                ref={entrySearchButtonRef}
                title={entrySearchOpen ? "検索を閉じる" : "マスク対象を検索"}
                type="button"
              >
                {entrySearchOpen ? <X size={18} /> : <Search size={18} />}
              </button>
            </div>
          </div>
          {entrySearchOpen ? (
            <label className="search-box" id="entry-search">
              <Search size={18} />
              <input
                aria-label="候補を検索"
                onChange={(event) =>
                  dispatch({ type: "setEntrySearch", value: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    dispatch({ type: "setEntrySearch", value: "" });
                    setEntrySearchOpen(false);
                    window.requestAnimationFrame(() =>
                      entrySearchButtonRef.current?.focus(),
                    );
                  }
                }}
                placeholder="候補を検索..."
                ref={entrySearchInputRef}
                type="search"
                value={state.entrySearch}
              />
            </label>
          ) : null}

          <div className="entry-list" ref={entryListRef}>
            {visibleEntries.length === 0 ? (
              <div className="empty-state">
                {state.entryFilter === "disabled"
                  ? "無効なマスク対象はありません。"
                  : "原文で文字列を選択し、マスク対象として追加してください。"}
              </div>
            ) : (
              visibleEntries.map((entry) => (
                <EntryCard
                  entry={entry}
                  isSelected={state.selectedEntryId === entry.id}
                  key={entry.id}
                  onDelete={() => dispatch({ type: "deleteEntry", id: entry.id })}
                  onSelect={() => dispatch({ type: "selectEntry", id: entry.id })}
                  onToggle={() =>
                    dispatch({ type: "toggleEntryEnabled", id: entry.id })
                  }
                />
              ))
            )}
          </div>
        </aside>
      </main>

      <section className="restore-dock" aria-label="マスクの復元">
        <button
          aria-expanded={state.restoreExpanded}
          className="restore-toggle"
          onClick={() =>
            dispatch({
              type: "setRestoreExpanded",
              value: !state.restoreExpanded,
            })
          }
          type="button"
        >
          <ChevronDown className={state.restoreExpanded ? "is-open" : ""} size={20} />
          マスクを復元
        </button>
        <div className="restore-summary">
          既知: {tokenInspection.knownPresent.length} / 未出現:{" "}
          {tokenInspection.absent.length} / 不明: {tokenInspection.unknown.length}
        </div>
        {state.restoreExpanded ? (
          <div className="restore-content">
            <label>
              <span>マスクを含む文章</span>
              <textarea
                aria-label="マスクを含む文章"
                onChange={(event) =>
                  dispatch({
                    type: "setExternalResponse",
                    value: event.target.value,
                  })
                }
                value={state.externalResponse}
              />
            </label>
            <label>
              <span>マスクを復元した文章</span>
              <textarea aria-label="マスクを復元した文章" readOnly value={restoration} />
            </label>
          </div>
        ) : null}
      </section>

      {manualDialogOpen ? (
        <ManualAddDialog
          category={manualCategory}
          occurrenceCount={countSelectedOccurrences(state.originalText, selectedText)}
          onCategoryChange={setManualCategory}
          onClose={() => {
            setManualDialogOpen(false);
            lastSelectionControlRef.current?.focus();
          }}
          onSubmit={addManualEntry}
          previewToken={manualPreviewToken}
          selectedText={selectedText}
        />
      ) : null}

      {copyConfirmOpen ? (
        <ConfirmDialog
          confirmLabel="コピーする"
          onCancel={() => setCopyConfirmOpen(false)}
          onConfirm={() => {
            setCopyConfirmOpen(false);
            void copyMaskedText(true);
          }}
          title="有効なマスク対象がありません"
        >
          マスク結果が原文と同じ可能性があります。内容を確認してからコピーしてください。
        </ConfirmDialog>
      ) : null}

      {clearConfirmOpen ? (
        <ConfirmDialog
          confirmLabel="全消去"
          danger
          onCancel={() => {
            setClearConfirmOpen(false);
            window.requestAnimationFrame(() =>
              headerMenuButtonRef.current?.focus(),
            );
          }}
          onConfirm={() => {
            abortActiveDetection("session-cleared");
            dispatch({ type: "clearSession" });
            setSelectedText("");
            setEntrySearchOpen(false);
            setClearConfirmOpen(false);
          }}
          title="セッションデータを消去します"
        >
          原文、候補、マスク対象、マスクを含む文章、マスクを復元した文章を初期化します。モデルなどの公開資材キャッシュは対象外です。
        </ConfirmDialog>
      ) : null}

      {normalization.state.open ? (
        <TextNormalizationDialog
          onApply={(result, sourceRevision) =>
            applyNormalization(result.normalizedText, sourceRevision)
          }
          onCancel={() => {
            normalization.close();
            window.requestAnimationFrame(() =>
              normalizationMenuItemRef.current?.focus(),
            );
          }}
          onModeChange={normalization.setMode}
          onRetry={normalization.retry}
          state={normalization.state}
        />
      ) : null}

      <div aria-live="polite" className="toast-region">
        {isDetecting && showDetectionProgress ? (
          <div className="toast toast-progress" role="status">
            <LoaderCircle aria-hidden="true" className="loading-spinner" size={18} />
            AI検出中
          </div>
        ) : state.notice ? (
          <div className="toast">{state.notice}</div>
        ) : null}
      </div>
    </div>
  );

  function setFilter(filter: EntryFilter) {
    dispatch({ type: "setEntryFilter", value: filter });
  }

  function selectEntryFromMaskedResult(entryId: string) {
    dispatch({ type: "selectEntry", id: entryId });

    const entryCard = Array.from(
      entryListRef.current?.querySelectorAll<HTMLElement>(".entry-card") ?? [],
    ).find((card) => card.dataset.entryId === entryId);

    if (!entryCard) {
      return;
    }

    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    entryCard.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }
}

function EntryCard(props: {
  entry: MaskEntry;
  isSelected: boolean;
  onDelete: () => void;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const isActive = props.entry.enabled;
  const statusLabel = isActive ? "有効" : "無効";
  const statusClass = isActive ? "is-approved" : "is-disabled";

  return (
    <article
      className={`entry-card ${statusClass} ${props.isSelected ? "is-selected" : ""}`}
      data-entry-id={props.entry.id}
      onFocus={props.onSelect}
      onMouseDown={props.onSelect}
      tabIndex={0}
    >
      <div className="entry-card-topline">
        <span className="entry-status">
          {isActive ? (
            <CheckCircle2 size={15} />
          ) : (
            <Info size={15} />
          )}
          {statusLabel}
        </span>
        {props.entry.confidence !== undefined ? (
          <span>信頼度 {Math.round(props.entry.confidence * 100)}%</span>
        ) : null}
      </div>
      <div className="entry-text">{props.entry.originalText}</div>
      <div className="chip-row">
        <span className="chip mono">{props.entry.token}</span>
        <span className="chip">{CATEGORY_LABELS[props.entry.category]}</span>
        <span
          aria-label={
            props.entry.occurrenceCount === 0
              ? "現在の原文に存在しない: 0か所"
              : undefined
          }
          className={`chip ${props.entry.occurrenceCount === 0 ? "chip-warning" : ""}`}
          title={props.entry.occurrenceCount === 0 ? "現在の原文に存在しません" : undefined}
        >
          {props.entry.occurrenceCount}か所
        </span>
        {props.entry.sources.map((source) => (
          <span className="chip" key={source}>
            {SOURCE_LABELS[source]}
          </span>
        ))}
        {props.entry.normalizationRules?.map((rule) => (
          <span className="chip chip-normalization" key={rule}>
            {NORMALIZATION_RULE_LABELS[rule]}
          </span>
        ))}
      </div>
      <div className="entry-card-actions">
        <button className="button button-primary" onClick={props.onToggle} type="button">
          {props.entry.enabled ? "無効化" : "有効化"}
        </button>
        <button
          aria-label={`${props.entry.originalText}を削除`}
          className="icon-button"
          onClick={props.onDelete}
          type="button"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </article>
  );
}

function ManualAddDialog(props: {
  category: MaskCategory;
  occurrenceCount: number;
  onCategoryChange: (value: MaskCategory) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  previewToken: string;
  selectedText: string;
}) {
  return (
    <div className="modal-backdrop">
      <form
        aria-labelledby="manual-dialog-title"
        className="modal"
        onSubmit={props.onSubmit}
        role="dialog"
      >
        <div className="modal-header">
          <h2 id="manual-dialog-title">マスク対象に追加</h2>
          <button
            aria-label="閉じる"
            className="icon-button"
            onClick={props.onClose}
            type="button"
          >
            <X size={22} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>対象の文字列</span>
            <input readOnly value={props.selectedText} />
          </label>
          <div className="info-callout">
            <Info size={18} />
            原文内の出現数: {props.occurrenceCount}か所すべてがマスク対象になります。
          </div>
          <label className="field">
            <span>
              カテゴリー選択 <strong aria-hidden="true">*</strong>
            </span>
            <select
              onChange={(event) =>
                props.onCategoryChange(event.target.value as MaskCategory)
              }
              value={props.category}
            >
              {MASK_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>マスク後のプレビュー</span>
            <div className="token-preview">
              <Eye size={18} />
              <span className="mono">{props.previewToken}</span>
              <span>自動生成</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="button button-ghost large" onClick={props.onClose} type="button">
            キャンセル
          </button>
          <button className="button button-primary large" type="submit">
            <ShieldCheck size={18} />
            追加してマスク
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog(props: {
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop">
      <div aria-labelledby="confirm-title" className="modal compact" role="dialog">
        <div className="modal-header">
          <h2 id="confirm-title">{props.title}</h2>
          <button
            aria-label="閉じる"
            className="icon-button"
            onClick={props.onCancel}
            type="button"
          >
            <X size={22} />
          </button>
        </div>
        <div className="modal-body">
          <p>{props.children}</p>
        </div>
        <div className="modal-footer">
          <button className="button button-ghost large" onClick={props.onCancel} type="button">
            キャンセル
          </button>
          <button
            className={props.danger ? "button button-danger large" : "button button-primary large"}
            onClick={props.onConfirm}
            type="button"
          >
            {props.danger ? <Eraser size={18} /> : <Copy size={18} />}
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterButton(props: {
  children: ReactNode;
  current: EntryFilter;
  filter: EntryFilter;
  onClick: (filter: EntryFilter) => void;
}) {
  return (
    <button
      className={props.current === props.filter ? "filter-button is-active" : "filter-button"}
      onClick={() => props.onClick(props.filter)}
      type="button"
    >
      {props.children}
    </button>
  );
}

function createEntryId(): string {
  return `entry-${crypto.randomUUID()}`;
}

function countSelectedOccurrences(originalText: string, selectedText: string): number {
  return countOccurrences(originalText, selectedText);
}

function toDetectionPhase(progress: NerDetectionProgress): DetectionPhase {
  return progress.phase === "loading" ? "ner-loading" : "ner-running";
}

function getDetectionButtonLabel(
  phase: DetectionPhase,
  entries: MaskEntry[],
): string {
  if (phase === "regex") {
    return "形式確認中";
  }

  if (phase === "ner-loading") {
    return "モデル準備中";
  }

  if (phase === "ner-running") {
    return "AI検出中";
  }

  return entries.some(
    (entry) => entry.sources.includes("regex") || entry.sources.includes("ner"),
  )
    ? "再検出"
    : "自動検出";
}

function formatDetectionNotice(
  candidateCount: number,
  summary: { mergedCount: number; newCount: number },
  nerOutcome: NerDetectionOutcome,
): string {
  if (candidateCount === 0) {
    if (nerOutcome === "failed") {
      return "AI検出に失敗しました。候補は見つかりませんでした。";
    }

    if (nerOutcome === "cancelled") {
      return "AI検出を中止しました。形式検出では候補が見つかりませんでした。";
    }

    return "自動検出では候補が見つかりませんでした。";
  }

  const result = `追加${summary.newCount}件、更新${summary.mergedCount}件。`;

  if (nerOutcome === "failed") {
    return `AI検出に失敗しました。形式検出のみ完了：${result}`;
  }

  if (nerOutcome === "cancelled") {
    return `AI検出を中止しました。形式検出のみ完了：${result}`;
  }

  return `自動検出完了：${result}`;
}

function summarizeDetectionMerge(
  entries: MaskEntry[],
  candidates: DetectionCandidate[],
): { mergedCount: number; newCount: number } {
  const existingTexts = new Set(entries.map((entry) => entry.normalizedText));
  const candidateTexts = new Set(
    candidates
      .map((candidate) => normalizeText(candidate.originalText))
      .filter((value) => value.trim().length > 0),
  );
  let newCount = 0;
  let mergedCount = 0;

  for (const candidateText of candidateTexts) {
    if (existingTexts.has(candidateText)) {
      mergedCount += 1;
    } else {
      newCount += 1;
    }
  }

  return { newCount, mergedCount };
}
