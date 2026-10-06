const SEVERITIES = ["info", "low", "moderate", "high", "critical"] as const;

type Severity = (typeof SEVERITIES)[number];

export type AuditProcessResult = {
  status: number | null;
  stdout: string;
  error?: unknown;
};

export type AuditDecision = {
  passed: boolean;
  reason: string;
  report: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function evaluateAudit(result: AuditProcessResult): AuditDecision {
  let report: unknown;
  try {
    report = JSON.parse(result.stdout) as unknown;
  } catch {
    return { passed: false, reason: "Audit returned invalid JSON.", report: null };
  }

  const reject = (reason: string): AuditDecision => ({ passed: false, reason, report });
  // Exit 1 can be a valid vulnerability report; other exits and timeouts are errors.
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    return reject("Audit process failed or timed out.");
  }
  if (!isRecord(report) || report.error || report.auditReportVersion !== 2) {
    return reject("Audit report is unavailable or unsupported.");
  }
  if (!isRecord(report.metadata) || !isRecord(report.metadata.vulnerabilities)
    || !isRecord(report.vulnerabilities)) {
    return reject("Audit report is incomplete.");
  }

  const counts = report.metadata.vulnerabilities;
  const actual = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
  for (const item of Object.values(report.vulnerabilities)) {
    if (!isRecord(item) || !SEVERITIES.includes(item.severity as Severity)) {
      return reject("Audit contains an invalid vulnerability entry.");
    }
    actual[item.severity as Severity] += 1;
  }
  for (const severity of SEVERITIES) {
    if (!Number.isSafeInteger(counts[severity]) || counts[severity] !== actual[severity]) {
      return reject("Audit vulnerability counts are inconsistent.");
    }
  }
  const total = Object.values(actual).reduce((sum, count) => sum + count, 0);
  if (counts.total !== total) return reject("Audit total is inconsistent.");
  if (total > 0) return reject(`Audit detected ${total} affected packages.`);
  if (result.status !== 0) return reject("Clean report has an unsuccessful exit status.");
  return { passed: true, reason: "No vulnerabilities detected.", report };
}
