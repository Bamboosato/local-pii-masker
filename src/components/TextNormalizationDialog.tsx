import { AlertTriangle, CheckCircle2, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildNormalizationPreview } from "../domain/normalization/document/buildPreviewSegments";
import type {
  DocumentNormalizationMode,
  DocumentNormalizationResult,
  NormalizationPreview,
  PreviewSegment,
} from "../domain/normalization/document/types";
import type { TextNormalizationDialogState } from "../hooks/useTextNormalization";

const RULE_LABELS: Record<string, string> = {
  unicode_nfc: "Unicode正規化",
  line_ending: "改行コード統一",
  invisible_character: "不可視文字除去",
  special_whitespace: "特殊空白補正",
  fullwidth_ascii: "全角文字補正",
  structured_hyphen: "ハイフン統一",
  email_spacing: "メール空白補正",
  email_line_break: "メール改行結合",
  phone_spacing: "電話番号空白補正",
  phone_line_break: "電話番号改行結合",
  postal_code_spacing: "郵便番号空白補正",
  postal_code_line_break: "郵便番号改行結合",
  date_time_spacing: "日付・時刻空白補正",
  date_time_line_break: "日付・時刻改行結合",
  label_value_line_break: "ラベルと値の結合",
  list_item_wrap: "箇条書き折り返し",
  japanese_inter_character_space: "日本語文字間空白補正",
  person_line_break: "氏名改行結合",
  kana_inter_character_space: "フリガナ空白補正",
  address_line_break: "住所改行結合",
  organization_line_break: "組織改行結合",
  identifier_spacing: "識別番号空白補正",
  identifier_line_break: "識別番号改行結合",
  japanese_line_wrap: "日本語折り返し",
  prose_line_wrap: "文章折り返し",
  excess_whitespace: "連続空白・改行整理",
};

export function TextNormalizationDialog(props: {
  state: Extract<TextNormalizationDialogState, { open: true }>;
  onModeChange: (mode: DocumentNormalizationMode) => void;
  onRetry: () => void;
  onCancel: () => void;
  onApply: (result: DocumentNormalizationResult, sourceRevision: number) => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const onCancelRef = useRef(props.onCancel);
  useEffect(() => {
    onCancelRef.current = props.onCancel;
  }, [props.onCancel]);
  const preview = useMemo<NormalizationPreview | undefined>(
    () =>
      props.state.result
        ? buildNormalizationPreview(props.state.sourceText, props.state.result)
        : undefined,
    [props.state.result, props.state.sourceText],
  );

  useEffect(() => {
    const returnFocus = returnFocusRef.current;
    titleRef.current?.focus();
    const dialog = dialogRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) {
        return;
      }
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        titleRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocus?.focus();
    };
  }, []);

  const changed = (props.state.result?.changedLocationCount ?? 0) > 0;
  const applyDisabled = props.state.status !== "ready" || !changed || !props.state.result;

  return (
    <div className="modal-backdrop normalization-backdrop">
      <div
        aria-describedby="text-normalization-description"
        aria-labelledby="text-normalization-title"
        aria-modal="true"
        className="modal normalization-modal"
        ref={dialogRef}
        role="dialog"
      >
        <div className="modal-header">
          <h2 id="text-normalization-title" ref={titleRef} tabIndex={-1}>
            テキスト正規化
          </h2>
          <button
            aria-label="正規化画面を閉じる"
            className="icon-button"
            onClick={props.onCancel}
            title="正規化画面を閉じます"
            type="button"
          >
            <X size={22} />
          </button>
        </div>
        <div className="modal-body normalization-modal-body">
          <div className="normalization-warning" id="text-normalization-description">
            <AlertTriangle aria-hidden="true" size={18} />
            <p>正規化すると、原文の空白、改行、表記、レイアウトが変わる場合があります。変更内容を確認してから適用してください。</p>
          </div>
          <div className="normalization-control-row">
            <fieldset className="normalization-mode-fieldset">
              <legend>正規化モード</legend>
              <span aria-hidden="true" className="normalization-mode-label">正規化モード</span>
              <label title="構造が明確な電話番号、メール、日付などを保守的に補正します。">
                <input
                  checked={props.state.mode === "standard"}
                  name="normalization-mode"
                  onChange={() => props.onModeChange("standard")}
                  type="radio"
                />
                <span>標準</span>
              </label>
              <label title="氏名、住所、組織名、折り返しを積極的に結合します。誤結合の可能性があります。">
                <input
                  checked={props.state.mode === "detection_priority"}
                  name="normalization-mode"
                  onChange={() => props.onModeChange("detection_priority")}
                  type="radio"
                />
                <span>検出優先</span>
              </label>
            </fieldset>

            {props.state.status === "ready" && props.state.result ? (
              <NormalizationSummary result={props.state.result} changed={changed} />
            ) : null}
          </div>

          {props.state.status === "computing" ? (
            <div className="normalization-status" role="status">
              <LoaderCircle aria-hidden="true" className="loading-spinner" size={18} />
              正規化結果を計算しています
            </div>
          ) : null}
          {props.state.status === "error" ? (
            <div className="normalization-error" role="alert">
              <AlertTriangle aria-hidden="true" size={18} />
              <span>テキストを正規化できませんでした。原文は変更されていません。</span>
              <button
                className="button button-secondary"
                onClick={props.onRetry}
                title="正規化を再試行します"
                type="button"
              >
                再試行
              </button>
            </div>
          ) : null}
          {props.state.status === "ready" && props.state.result && preview ? (
            <>
              <div className="normalization-preview-grid">
                <PreviewPane label="正規化前" segments={preview.before} />
                <PreviewPane label="正規化後" segments={preview.after} />
              </div>
            </>
          ) : null}
        </div>
        <div className="modal-footer">
          <button
            className="button button-ghost normalization-cancel-button"
            onClick={props.onCancel}
            title="正規化をキャンセルして画面を閉じます"
            type="button"
          >
            キャンセル
          </button>
          <button
            className="button button-primary large normalization-apply-button"
            disabled={applyDisabled}
            onClick={() => {
              if (props.state.result) {
                props.onApply(props.state.result, props.state.sourceRevision);
              }
            }}
            title="正規化後の内容を原文に適用します。"
            type="button"
          >
            適用
          </button>
        </div>
      </div>
    </div>
  );
}

function NormalizationSummary(props: {
  result: DocumentNormalizationResult;
  changed: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsButtonRef = useRef<HTMLButtonElement>(null);
  const detailsPopoverRef = useRef<HTMLDivElement>(null);
  const hasDetails = props.result.summary.length > 0;

  useEffect(() => {
    if (!detailsOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (detailsButtonRef.current?.contains(target) || detailsPopoverRef.current?.contains(target)) {
        return;
      }
      setDetailsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setDetailsOpen(false);
      detailsButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [detailsOpen]);

  return (
    <div aria-live="polite" className="normalization-summary" role="status">
      <div className="normalization-summary-content">
        {props.changed ? (
          <>
            <CheckCircle2 aria-hidden="true" size={18} />
            <strong>変更箇所 {props.result.changedLocationCount}件</strong>
          </>
        ) : (
          "変更箇所なし"
        )}
      </div>
      {hasDetails ? (
        <div className="normalization-summary-actions">
          <button
            aria-controls="normalization-summary-details"
            aria-expanded={detailsOpen}
            className="normalization-details-trigger"
            onClick={() => setDetailsOpen((open) => !open)}
            ref={detailsButtonRef}
            title="変更ルール別の内訳を表示します。"
            type="button"
          >
            {detailsOpen ? "内訳を閉じる" : "内訳を表示"}
            <span aria-hidden="true">{detailsOpen ? "▴" : "▾"}</span>
          </button>
          <div
            aria-label="内訳（ルール別・延べ件数）"
            className="normalization-details-popover"
            hidden={!detailsOpen}
            id="normalization-summary-details"
            ref={detailsPopoverRef}
            role="region"
          >
            <strong>内訳（ルール別・延べ件数）</strong>
            <ul>
              {props.result.summary.map((item) => (
                <li key={`${item.ruleId}-${item.kind}`}>
                  <span>{RULE_LABELS[item.ruleId] ?? item.ruleId}</span>
                  <span>{item.count}件</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PreviewPane(props: { label: string; segments: PreviewSegment[] }) {
  return (
    <section aria-label={props.label} className="normalization-preview-pane">
      <h3>{props.label}</h3>
      <pre>
        {props.segments.map((segment, index) =>
          segment.changed ? (
            <mark key={`${props.label}-${index}`} title={segment.ruleIds.map((rule) => RULE_LABELS[rule] ?? rule).join("、")}>
              {segment.text}
            </mark>
          ) : (
            <span key={`${props.label}-${index}`}>{segment.text}</span>
          ),
        )}
      </pre>
    </section>
  );
}
