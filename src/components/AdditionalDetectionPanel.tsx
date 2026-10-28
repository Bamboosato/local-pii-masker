import { useEffect, useRef, useState } from "react";
import { browserPromptAdapter, type PromptAvailability } from "../domain/detection/prompt/adapter";
import { runAdditionalDetection, type AdditionalResult } from "../domain/detection/prompt/run";
import { classifyAdditionalCandidates, type AdditionalCandidate } from "../domain/detection/prompt/validation";
import { countMaskableOccurrences } from "../domain/mask/contextualMasking";
import { findOccurrences } from "../domain/mask/findOccurrences";
import { CATEGORY_LABELS, type MaskEntry, type OccurrenceMaskingMode } from "../domain/types";

export function AdditionalDetectionPanel(props: {
  text: string; entries: MaskEntry[]; ready: boolean; mode: OccurrenceMaskingMode;
  onApply: (candidates: AdditionalCandidate[]) => void;
  onInspect: (range: { start: number; end: number }) => void;
}) {
  const [availability, setAvailability] = useState<PromptAvailability>("unavailable");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<AdditionalResult>();
  const [selected, setSelected] = useState<string[]>([]);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const jobRef = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const occurrenceRef = useRef(new Map<string, number>());
  useEffect(() => {
    let disposed = false;
    void browserPromptAdapter.availability().then((value) => { if (!disposed) { setAvailability(value); setChecking(false); } });
    const leave = () => {
      jobRef.current++;
      controllerRef.current?.abort();
      setBusy(false); setResult(undefined); setSelected([]); occurrenceRef.current.clear();
      setMessage("画面を離れたため、追加検出結果を破棄しました。");
    };
    window.addEventListener("pagehide", leave);
    return () => { disposed = true; window.removeEventListener("pagehide", leave); controllerRef.current?.abort(); };
  }, []);

  function cancel() {
    jobRef.current++;
    controllerRef.current?.abort();
    setBusy(false); setResult(undefined); setSelected([]);
    setMessage("追加検出は完了していません。中止しました。準備中のChrome側の取得停止は保証されません。");
    triggerRef.current?.focus();
  }
  async function run(prepareOnly: boolean) {
    if (!prepareOnly && !props.ready) return;
    if (controllerRef.current && !controllerRef.current.signal.aborted && busy) return;
    const job = ++jobRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true); setResult(undefined); setSelected([]); occurrenceRef.current.clear();
    setMessage("追加AIの準備中です。");
    try {
      if (prepareOnly) {
        const session = await browserPromptAdapter.create(controller.signal, (progress) => { if (job === jobRef.current) setMessage(`モデル準備中：${Math.round(progress * 100)}%`); });
        session.destroy();
      } else {
        const next = await runAdditionalDetection(props.text, { signal: controller.signal,
          onPhase: (phase) => { if (job === jobRef.current) setMessage(phase === "preparing" ? "追加AIの初期化中です。" : "追加AI検出中です。"); },
          onProgress: (done, total) => { if (job === jobRef.current) setMessage(`追加AI検出中：${done} / ${total}区間`); },
        });
        if (job !== jobRef.current || controller.signal.aborted) return;
        setResult(next);
        setMessage(next.rejected.length ? `検証警告あり：${next.rejected.length}件を棄却しました。` : next.candidates.length ? "追加候補を確認してください。" : "追加候補は見つかりませんでした。検出漏れがないことを保証するものではありません。");
      }
      const status = await browserPromptAdapter.availability();
      if (job === jobRef.current && !controller.signal.aborted) { setAvailability(status); if (prepareOnly) setMessage(status === "available" ? "モデルの準備が完了しました。" : "モデルの準備状態を確認して再試行してください。"); }
    } catch {
      if (job === jobRef.current && !controller.signal.aborted) { setResult(undefined); setMessage("追加検出は完了していません。準備状態や入力の長さを確認して再試行してください。"); }
    } finally { if (job === jobRef.current && !controller.signal.aborted) { setBusy(false); triggerRef.current?.focus(); } }
  }
  const candidates = classifyAdditionalCandidates(result?.candidates ?? [], props.entries);
  const key = (candidate: AdditionalCandidate) => JSON.stringify([candidate.text, candidate.category]);
  const applicable = candidates.filter((candidate) => candidate.status === "new" && selected.includes(key(candidate)));
  return <details className="additional-detection">
    <summary>追加AI検出（試験）</summary>
    <p>端末内AIで見落とし候補を追加確認します。初回はモデルのダウンロードが必要です。結果には誤りがあるため、追加する対象を確認してください。</p>
    {!props.ready ? <p>現在の原文で自動検出を正常完了してから実行してください。AI検出に失敗した場合は再試行してください。</p> : null}
    <p>{checking ? "利用可否を確認中です。" : availability === "unavailable" ? "この環境では追加AI検出を利用できません" : availability === "downloadable" ? "初回準備が必要です。Chromeプロファイルのドライブに十分な空き容量が必要です。" : availability === "downloading" ? "Chromeがモデルを取得中です。" : "追加AIを利用できます。"}</p>
    <button className="button button-secondary" type="button" title="追加AIの利用可否確認・準備・検出を明示的に実行します" ref={triggerRef} disabled={busy || checking || (availability === "available" && !props.ready)} onClick={() => {
      if (availability === "unavailable") {
        setChecking(true); void browserPromptAdapter.availability().then((value) => { setAvailability(value); setChecking(false); });
      } else void run(availability !== "available");
    }}>{availability === "unavailable" ? "利用可否を再確認" : availability === "available" ? "追加AI検出を実行" : "モデルを準備"}</button>
    {availability === "available" && !props.ready ? <span>（検出前のため実行不可）</span> : null}
    {busy ? <button className="button button-secondary" type="button" title="追加検出を中止して未適用の結果を破棄します" onClick={cancel}>追加検出を中止</button> : null}
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
    {result ? <>
      <p>新規候補 {candidates.filter((c) => c.status === "new").length}件 / 既存一致 {candidates.filter((c) => c.status === "existing").length}件 / カテゴリ競合 {candidates.filter((c) => c.status === "conflict").length}件</p>
      <ul className="additional-candidates">{candidates.map((candidate) => {
        const candidateKey = key(candidate);
        const count = countMaskableOccurrences(props.text, { originalText: candidate.text, category: candidate.category, sources: ["prompt-api"] }, props.mode);
        return <li key={candidateKey}>
          <label><input type="checkbox" checked={candidate.status === "new" && selected.includes(candidateKey)} disabled={candidate.status !== "new"} onChange={(event) => setSelected((current) => event.target.checked ? [...current, candidateKey] : current.filter((k) => k !== candidateKey))} />{candidate.text}（{CATEGORY_LABELS[candidate.category]}）</label>
          <p>追加AI検出 / {candidate.status === "new" ? "新規" : candidate.status === "existing" ? "既存一致：変更しません" : "カテゴリ競合：追加できません"} / 置換対象 {count}箇所（最長一致適用前）</p>
          <p>根拠：{candidate.evidence.slice(0, 160)}</p>
          <button type="button" title="同じ文字列の出現箇所を順に確認します" onClick={() => {
            const ranges = findOccurrences(props.text, candidate.text);
            const index = occurrenceRef.current.get(candidateKey) ?? 0;
            const range = ranges[index % ranges.length];
            if (range) props.onInspect(range);
            occurrenceRef.current.set(candidateKey, index + 1);
          }}>原文の次の箇所を確認</button>
        </li>;
      })}</ul>
      <p>同一文字列の置換対象箇所を一括してマスクします。出現箇所ごとの選択はできません。</p>
      <button className="button button-primary" type="button" title="選択した新規候補だけを最新状態へ追加します" disabled={!props.ready || applicable.length === 0} onClick={() => { props.onApply(applicable); setResult(undefined); setSelected([]); setMessage("選択候補を最新の登録項目と照合して適用しました。未選択候補は破棄しました。"); triggerRef.current?.focus(); }}>選択した候補を追加</button>
      <button className="button button-secondary" type="button" title="未適用の追加候補を全て破棄します" onClick={() => { setResult(undefined); setSelected([]); setMessage(""); triggerRef.current?.focus(); }}>追加候補を閉じる</button>
    </> : null}
  </details>;
}
