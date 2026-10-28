import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { priorityPlan, reproductionPlan, reproductionSchemaPlan, negativeInstructionPlan, minimizationPlan, minimizationBoundaryPlan, type PriorityPlanItem } from "./priorityPlan";
import { referenceScreeningPlan } from "./referenceScreening";

const execute = promisify(execFile);
const args = process.argv.slice(2);
function option(name: string, fallback?: string) {
  const i = args.indexOf(name), value = i === -1 ? fallback : args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}`);
  return value;
}
const repo = process.cwd(), cli = path.resolve(option("--cli")), session = option("--session", "prompt-priority");
if (!/^[a-z0-9-]+$/u.test(session)) throw new Error("Invalid session");
const phase = option("--phase", "all");
if (!["all", "diagnostic", "quality", "long", "reproduction", "reproduction-schema", "negative-instruction", "negative-brief", "minimize", "minimize-sentences", "minimize-boundary", "reference-short", "reference-long"].includes(phase)) throw new Error("Invalid phase");
const output = path.resolve(option("--output"));
const allowed = path.resolve(repo, "output/playwright") + path.sep;
if (!output.startsWith(allowed) || fs.existsSync(output)) throw new Error("Output must be a new directory inside output/playwright");
const environmentFile = path.resolve(option("--environment"));
const environment = JSON.parse(fs.readFileSync(environmentFile, "utf8")) as { id: string; browserVersion: string; modelVersion: string; backend: string; state: string };
if (!environment.id || !environment.browserVersion || !environment.modelVersion || !environment.backend || environment.state !== "Ready") throw new Error("Incomplete environment record");
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function sourceFiles(folder: string): string[] {
  return fs.readdirSync(path.join(repo, folder), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error("Unsupported source link");
    const file = `${folder}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(file) : /\.(ts|tsx|json)$/u.test(file) ? [file] : [];
  });
}
const sourcePaths = [...sourceFiles("src"), ...sourceFiles("experiments/prompt-api"), ...sourceFiles("scripts/ner-evaluation"), "package-lock.json", "vite.config.ts"].sort();
const sourceHashes = () => Object.fromEntries(sourcePaths.map((file) => [file, sha(fs.readFileSync(path.join(repo, file)))]));
const sources = sourceHashes(), sourceHash = sha(JSON.stringify(sources));
const plan = phase === "reference-short" || phase === "reference-long" ? referenceScreeningPlan().filter((item) => item.phase === phase) : phase === "minimize-boundary" ? minimizationBoundaryPlan() : phase === "negative-instruction" || phase === "negative-brief" ? negativeInstructionPlan(phase === "negative-brief") : phase === "minimize" || phase === "minimize-sentences" ? minimizationPlan(phase === "minimize-sentences") : phase === "reproduction" ? reproductionPlan() : phase === "reproduction-schema" ? reproductionSchemaPlan() : priorityPlan().filter((item) => phase === "all" || item.phase === phase);
const cpuTime = () => os.cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
function hostSnapshot() {
  const free = (drive: string) => { const value = fs.statfsSync(drive); return value.bavail * value.bsize; };
  return { at: new Date().toISOString(), freeMemoryBytes: os.freemem(), totalMemoryBytes: os.totalmem(), freeCBytes: free("C:/"), freeDBytes: free("D:/"), cpu: cpuTime() };
}
function budget(snapshot: ReturnType<typeof hostSnapshot>) {
  if (snapshot.freeCBytes < 24 * 2 ** 30 || snapshot.freeDBytes < 2 * 2 ** 30) throw new Error("Disk margin insufficient");
}
async function evaluate(expression: string) {
  const result = await execute(process.execPath, [cli, `-s=${session}`, "--raw", "eval", expression], { cwd: repo, timeout: 25000, maxBuffer: 512 * 1024, windowsHide: true });
  try { return JSON.parse(result.stdout) as unknown; } catch { throw new Error("CLI returned invalid metadata"); }
}
let stopped = false;
process.once("SIGINT", () => { stopped = true; });
process.once("SIGTERM", () => { stopped = true; });
async function run(item: PriorityPlanItem) {
  await evaluate(`async () => { if (globalThis.__priorityJob?.state === 'running') throw new Error('Evaluation already running'); const m=await import('/experiments/prompt-api/priorityEvaluation.ts'); globalThis.__priorityAbort=new AbortController(); globalThis.__priorityJob={state:'running'}; let watchdog=false; const timer=setTimeout(()=>{watchdog=true;globalThis.__priorityAbort.abort();},180000); void m.evaluatePriorityDocument(${JSON.stringify(item.variant)},${JSON.stringify(item.documentId)},globalThis.__priorityAbort.signal).then(row=>{globalThis.__priorityJob={state:'done',row:{...row,harnessDeadlineReached:watchdog}};},()=>{globalThis.__priorityJob={state:'harness-error'};}).finally(()=>clearTimeout(timer)); return {started:true}; }`);
  const deadline = Date.now() + 210000;
  for (;;) {
    if (stopped || Date.now() > deadline) throw new Error("Harness stopped");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const state = await evaluate("() => globalThis.__priorityJob ?? {state:'page-lost'}") as { state: string; row?: { runtimeBefore: unknown; runtimeAfter: unknown } };
    if (state.state === "done" && state.row) return state.row;
    if (state.state !== "running") throw new Error("Evaluation state lost");
  }
}
fs.mkdirSync(output, { recursive: true });
budget(hostSnapshot());
const manifest = { schemaVersion: "priority-evaluation-1", at: new Date().toISOString(), nodeVersion: process.version, cliSHA256: sha(fs.readFileSync(cli)), environment, environmentHash: sha(fs.readFileSync(environmentFile)), sourceHashes: sources, sourceHash, phase, plan, planHash: sha(JSON.stringify(plan)), rowWatchdogMs: 180000, os: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length }, status: "running", stopReason: "", completed: 0 };
const save = () => fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
save();
function chromeVersion(runtime: unknown) {
  const value = runtime as { hints?: { fullVersionList?: { brand: string; version: string }[] } };
  return value.hints?.fullVersionList?.find((item) => item.brand === "Google Chrome")?.version;
}
try {
  const readiness = await evaluate("async () => { const m=await import('/experiments/prompt-api/priorityEvaluation.ts'); return {availability:await m.checkPriorityAvailability()}; }") as { availability?: string };
  fs.writeFileSync(path.join(output, "readiness.json"), JSON.stringify(readiness));
  if (readiness.availability !== "available") throw new Error("Model readiness unavailable");
  // Calibration is explicitly separate from measured rows.
  const warmup = await run({ phase: "quality", repeat: 0, variant: { id: "warmup", format: "evidence-v1", sessionMode: "clone", constraint: "schema", omitSchemaInput: false }, documentId: "development-v2-negative-1" });
  fs.writeFileSync(path.join(output, "warmup.json"), JSON.stringify(warmup));
  if (chromeVersion(warmup.runtimeBefore) !== environment.browserVersion || chromeVersion(warmup.runtimeAfter) !== environment.browserVersion) throw new Error("Browser version missing or changed");
  for (const [index, item] of plan.entries()) {
    if (stopped || sha(JSON.stringify(sourceHashes())) !== sourceHash) throw new Error("Source changed or stopped");
    const before = hostSnapshot(); budget(before);
    const row = await run(item), after = hostSnapshot();
    if (chromeVersion(row.runtimeBefore) !== environment.browserVersion || chromeVersion(row.runtimeAfter) !== environment.browserVersion) throw new Error("Browser version missing or changed");
    const delta = after.cpu.total - before.cpu.total;
    const hostCpuBusyPercent = delta > 0 ? 100 * (1 - (after.cpu.idle - before.cpu.idle) / delta) : undefined;
    fs.appendFileSync(path.join(output, "rows.jsonl"), JSON.stringify({ order: index + 1, phase: item.phase, repeat: item.repeat, environmentRecordId: environment.id, sourceHash, hostBefore: before, hostAfter: after, hostCpuBusyPercent, ...row }) + "\n");
    manifest.completed++; save();
    process.stdout.write(`Completed ${manifest.completed}/${plan.length}: ${item.variant.id} ${item.documentId}\n`);
  }
  manifest.status = "done";
} catch (error: unknown) {
  // Do not log child-process errors: their stdout can contain browser exception text.
  manifest.status = "stopped-or-harness-error"; process.exitCode = 1;
  const reasons = ["Source changed or stopped", "Browser version missing or changed", "Disk margin insufficient", "Harness stopped", "Evaluation state lost", "CLI returned invalid metadata", "Model readiness unavailable"];
  manifest.stopReason = error instanceof Error && reasons.includes(error.message) ? error.message : "harness-error";
} finally {
  try { await evaluate("() => { globalThis.__priorityAbort?.abort(); return {aborted:true}; }"); } catch { /* Preserve already saved rows. */ }
  save();
}
