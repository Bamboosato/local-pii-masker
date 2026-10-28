import { browserPromptAdapter } from "../../src/domain/detection/prompt/adapter";
import { PROMPT_CONFIG } from "../../src/domain/detection/prompt/config";
import { createLongCorpus, createPromptCorpus } from "./corpus";
import { evaluateDocument } from "./evaluate";
import { summarizeEvaluation } from "./summary";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element("status"), results = element("results");
const run = element<HTMLButtonElement>("run"), prepare = element<HTMLButtonElement>("prepare"), stop = element<HTMLButtonElement>("stop"), exportButton = element<HTMLButtonElement>("export");
const dataset = element<HTMLSelectElement>("dataset");
let controller: AbortController | undefined;
let report: Record<string, unknown> | undefined;
function busy(value: boolean) { run.disabled = value; prepare.disabled = value; stop.disabled = !value; dataset.disabled = value; }
stop.onclick = () => { controller?.abort(); status.textContent = "中止要求。未完了の結果は採用判断に使いません。"; };
prepare.onclick = async () => {
  busy(true); controller = new AbortController();
  try { status.textContent = `利用可否：${await browserPromptAdapter.availability()}`; const session = await browserPromptAdapter.create(controller.signal, (p) => { status.textContent = `モデル準備 ${Math.round(p * 100)}%`; }); session.destroy(); status.textContent = "モデル準備完了。"; }
  catch { status.textContent = "モデル準備は完了していません。Chromeの利用条件を確認してください。"; }
  finally { busy(false); }
};
run.onclick = async () => {
  const commit = element<HTMLInputElement>("commit").value.trim(), hardware = element<HTMLInputElement>("hardware").value.trim();
  if (!commit || !hardware) { status.textContent = "コミットと実機条件（不明項目を含む）を記入してください。"; return; }
  busy(true); exportButton.disabled = true; controller = new AbortController();
  const documents = dataset.value === "long" ? createLongCorpus() : createPromptCorpus(dataset.value === "final" ? "final" : "development");
  const rows: (Awaited<ReturnType<typeof evaluateDocument>> & { repeat: number })[] = [];
  report = { startedAt: new Date().toISOString(), commit, hardware, userAgent: navigator.userAgent, modelVersion: "不明（実機条件欄へ追記）", config: PROMPT_CONFIG, dataset: dataset.value, completed: false, rows, manualReviewBurden: "未実施：別途同一評価者による10文書各3回の計測が必要", adoption: "保留：実測結果と確認負担を人が評価する", };
  try {
    if (await browserPromptAdapter.availability() !== "available") throw new Error("unavailable");
    for (let repeat = 1; repeat <= 3; repeat++) for (const document of documents) {
      if (controller.signal.aborted) throw new Error("cancelled");
      const row = await evaluateDocument(document, controller.signal, (phase) => { status.textContent = `${repeat}/3 ${document.id} ${phase}`; });
      rows.push({ ...row, repeat });
      results.textContent = `${rows.length} / ${documents.length * 3}文書実行完了`;
    }
    report.completed = true;
    status.textContent = "評価終了。失敗文書を含むJSONを出力し、各回の完了率と最悪値を確認してください。";
  } catch { status.textContent = "評価は完了していません。モデル状態・容量・中止の有無を確認してください。部分結果は未完了として出力できます。"; }
  finally { if (report) report.summary = summarizeEvaluation(rows); busy(false); exportButton.disabled = !report; results.textContent = JSON.stringify(report, null, 2); }
};
exportButton.onclick = () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "synthetic-prompt-api-evaluation.json"; link.click(); URL.revokeObjectURL(url);
};
