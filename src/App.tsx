import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Eraser,
  Eye,
  Info,
  RotateCw,
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
  selectActiveEntries,
  selectMaskedText,
  selectReplacementCount,
  selectRestoredResponse,
  selectSessionCounts,
  selectTokenInspection,
  selectVisibleEntries,
} from "./app/selectors";
import { countOccurrences } from "./domain/mask/findOccurrences";
import { buildMaskSegments } from "./domain/mask/maskText";
import { createMaskToken } from "./domain/mask/tokenFactory";
import { normalizeText } from "./domain/normalization/normalizeText";
import {
  CATEGORY_LABELS,
  MASK_CATEGORIES,
  REVIEW_STATUS_LABELS,
  SOURCE_LABELS,
  type MaskCategory,
  type MaskEntry,
} from "./domain/types";

const MAX_CHAR_COUNT = 10000;

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [selectedText, setSelectedText] = useState("");
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualCategory, setManualCategory] = useState<MaskCategory>("PERSON");
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSelectionControlRef = useRef<HTMLButtonElement>(null);
  const maskedText = selectMaskedText(state);
  const counts = selectSessionCounts(state);
  const visibleEntries = selectVisibleEntries(state);
  const activeEntries = selectActiveEntries(state.entries);
  const restoration = selectRestoredResponse(state);
  const tokenInspection = selectTokenInspection(state);
  const replacementCount = selectReplacementCount(state);
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

  useEffect(() => {
    if (!state.notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      dispatch({ type: "setNotice" });
    }, 2800);

    return () => window.clearTimeout(timeout);
  }, [state.notice]);

  function updateSelection() {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    setSelectedText(
      textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
    );
  }

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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-cluster">
          <h1>Local PII Masker</h1>
          <span className="badge badge-neutral">LOCAL ONLY</span>
          <span className="badge badge-neutral">保存されません</span>
        </div>
        <div className="header-actions">
          <IconButton label="プライバシー境界">
            <ShieldCheck size={20} />
          </IconButton>
          <IconButton label="再計算">
            <RotateCw size={20} />
          </IconButton>
          <button
            className="button button-danger-outline"
            type="button"
            onClick={() => setClearConfirmOpen(true)}
          >
            Clear All
          </button>
        </div>
      </header>

      <div className="privacy-strip">
        入力内容は保存されません。ページを再読み込みまたは閉じると、原文、マスク設定、回答、復元結果は失われます。
      </div>

      <main className="main-grid">
        <section className="workspace" aria-label="テキストワークスペース">
          <div className="tabs" role="tablist" aria-label="表示切り替え">
            <button
              className={state.activeTextView === "original" ? "tab is-active" : "tab"}
              role="tab"
              aria-selected={state.activeTextView === "original"}
              type="button"
              onClick={() => dispatch({ type: "setActiveTextView", value: "original" })}
            >
              原文
            </button>
            <button
              className={state.activeTextView === "masked" ? "tab is-active" : "tab"}
              role="tab"
              aria-selected={state.activeTextView === "masked"}
              type="button"
              onClick={() => dispatch({ type: "setActiveTextView", value: "masked" })}
            >
              マスク結果
            </button>
            <div className="tab-actions">
              {state.activeTextView === "original" ? (
                <button
                  className="button button-secondary"
                  disabled={selectedText.trim().length === 0}
                  onClick={openManualDialog}
                  ref={lastSelectionControlRef}
                  type="button"
                >
                  選択範囲を追加
                </button>
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
              <textarea
                aria-label="原文"
                className="text-editor"
                maxLength={MAX_CHAR_COUNT}
                onChange={(event) =>
                  dispatch({ type: "setOriginalText", value: event.target.value })
                }
                onKeyUp={updateSelection}
                onMouseUp={updateSelection}
                onSelect={updateSelection}
                placeholder="個人情報をマスキングしたい日本語テキストを入力または貼り付けてください。"
                ref={textareaRef}
                value={state.originalText}
              />
            ) : (
              <div
                aria-label="マスク結果"
                className="masked-preview"
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
                        onClick={() =>
                          dispatch({ type: "selectEntry", id: segment.entryId })
                        }
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

          <div className="workspace-footer">
            {state.activeTextView === "original" ? (
              <span className="mono">
                文字数: {state.originalText.length.toLocaleString("ja-JP")} /{" "}
                {MAX_CHAR_COUNT.toLocaleString("ja-JP")}
              </span>
            ) : (
              <div className="result-summary">
                <strong>有効な対象文字列数: {counts.activeEntries}件</strong>
                <span>置換箇所数: {replacementCount}か所</span>
                <span>未確認候補数: {counts.unreviewed}件</span>
                <span>0件対象: {counts.zeroOccurrence}件</span>
                <small>
                  <Info size={14} />
                  自動検出はすべての個人情報を検出できるとは限りません。コピー前に原文とマスク結果を確認してください。
                </small>
              </div>
            )}
          </div>
        </section>

        <aside className="management-panel" aria-label="マスク対象管理">
          <div className="panel-header">
            <span>Manage identified PII tokens</span>
          </div>
          <div className="filter-row" role="group" aria-label="候補フィルター">
            <FilterButton filter="all" current={state.entryFilter} onClick={setFilter}>
              すべて
            </FilterButton>
            <FilterButton filter="unreviewed" current={state.entryFilter} onClick={setFilter}>
              未確認 ({counts.unreviewed})
            </FilterButton>
            <FilterButton filter="approved" current={state.entryFilter} onClick={setFilter}>
              有効 ({counts.activeEntries})
            </FilterButton>
            <FilterButton filter="zero" current={state.entryFilter} onClick={setFilter}>
              0件
            </FilterButton>
          </div>
          <label className="search-box">
            <Search size={18} />
            <input
              aria-label="候補を検索"
              onChange={(event) =>
                dispatch({ type: "setEntrySearch", value: event.target.value })
              }
              placeholder="候補を検索..."
              type="search"
              value={state.entrySearch}
            />
          </label>

          <div className="entry-list">
            {visibleEntries.length === 0 ? (
              <div className="empty-state">
                原文で文字列を選択し、マスク対象として追加してください。
              </div>
            ) : (
              visibleEntries.map((entry) => (
                <EntryCard
                  entry={entry}
                  isSelected={state.selectedEntryId === entry.id}
                  key={entry.id}
                  onApprove={() =>
                    dispatch({
                      type: "setEntryReviewStatus",
                      id: entry.id,
                      reviewStatus: "approved",
                      enabled: true,
                    })
                  }
                  onDelete={() => dispatch({ type: "deleteEntry", id: entry.id })}
                  onExclude={() =>
                    dispatch({
                      type: "setEntryReviewStatus",
                      id: entry.id,
                      reviewStatus: "excluded",
                      enabled: false,
                    })
                  }
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

      <section className="restore-dock" aria-label="外部回答の復元">
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
          外部AI回答のトークンを復元
        </button>
        <div className="restore-summary">
          既知: {tokenInspection.knownPresent.length} / 未出現:{" "}
          {tokenInspection.absent.length} / 不明: {tokenInspection.unknown.length}
        </div>
        {state.restoreExpanded ? (
          <div className="restore-content">
            <label>
              <span>外部回答</span>
              <textarea
                aria-label="外部回答"
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
              <span>復元結果</span>
              <textarea aria-label="復元結果" readOnly value={restoration} />
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
          onCancel={() => setClearConfirmOpen(false)}
          onConfirm={() => {
            dispatch({ type: "clearSession" });
            setSelectedText("");
            setClearConfirmOpen(false);
          }}
          title="セッションデータを消去します"
        >
          原文、候補、マスク対象、外部回答、復元結果を初期化します。モデルなどの公開資材キャッシュは対象外です。
        </ConfirmDialog>
      ) : null}

      <div aria-live="polite" className="toast-region">
        {state.notice ? <div className="toast">{state.notice}</div> : null}
      </div>
    </div>
  );

  function setFilter(filter: EntryFilter) {
    dispatch({ type: "setEntryFilter", value: filter });
  }
}

function EntryCard(props: {
  entry: MaskEntry;
  isSelected: boolean;
  onApprove: () => void;
  onDelete: () => void;
  onExclude: () => void;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const statusClass =
    props.entry.reviewStatus === "unreviewed"
      ? "is-pending"
      : props.entry.enabled && props.entry.reviewStatus === "approved"
        ? "is-approved"
        : "is-excluded";

  return (
    <article
      className={`entry-card ${statusClass} ${props.isSelected ? "is-selected" : ""}`}
      onFocus={props.onSelect}
      onMouseDown={props.onSelect}
      tabIndex={0}
    >
      <div className="entry-card-topline">
        <span className="entry-status">
          {props.entry.enabled ? (
            <CheckCircle2 size={15} />
          ) : (
            <Info size={15} />
          )}
          {REVIEW_STATUS_LABELS[props.entry.reviewStatus]}
        </span>
        {props.entry.confidence !== undefined ? (
          <span>信頼度 {Math.round(props.entry.confidence * 100)}%</span>
        ) : null}
      </div>
      <div className="entry-text">{props.entry.originalText}</div>
      <div className="chip-row">
        <span className="chip mono">{props.entry.token}</span>
        <span className="chip">{props.entry.occurrenceCount}か所</span>
        {props.entry.sources.map((source) => (
          <span className="chip" key={source}>
            {SOURCE_LABELS[source]}
          </span>
        ))}
      </div>
      <div className="entry-card-actions">
        {props.entry.reviewStatus === "unreviewed" ? (
          <button className="button button-primary" onClick={props.onApprove} type="button">
            マスクする
          </button>
        ) : (
          <button className="button button-primary" onClick={props.onToggle} type="button">
            {props.entry.enabled ? "無効化" : "有効化"}
          </button>
        )}
        <button className="button button-ghost" onClick={props.onExclude} type="button">
          除外
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

function IconButton(props: { children: ReactNode; label: string }) {
  return (
    <button aria-label={props.label} className="icon-button" type="button">
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
