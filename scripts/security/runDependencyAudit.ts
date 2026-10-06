import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateAudit } from "./dependencyAuditPolicy";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this command through npm run audit:dependencies.");

const reportDirectory = resolve(".security-audit");
mkdirSync(reportDirectory, { recursive: true });
for (const scope of ["production", "full"] as const) {
  // Invoke npm's JS entry point directly: no shell expansion and no npm.cmd dependency.
  const args = [npmCli, "audit", "--json", ...(scope === "production" ? ["--omit=dev"] : [])];
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const decision = evaluateAudit(result);
  writeFileSync(
    resolve(reportDirectory, `${scope}.json`),
    `${JSON.stringify(decision.report ?? { error: decision.reason }, null, 2)}\n`,
    "utf8",
  );
  console.log(`${scope}: ${decision.reason}`);
  if (!decision.passed) process.exitCode = 1;
}
