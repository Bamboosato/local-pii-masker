import { describe, expect, it } from "vitest";
import { evaluateAudit } from "./dependencyAuditPolicy";

function report(severity?: "info" | "low" | "moderate" | "high" | "critical") {
  return {
    auditReportVersion: 2,
    vulnerabilities: severity ? { example: { severity } } : {},
    metadata: {
      vulnerabilities: {
        info: 0, low: 0, moderate: 0, high: 0, critical: 0,
        ...(severity ? { [severity]: 1 } : {}),
        total: severity ? 1 : 0,
      },
    },
  };
}

describe("Dependency audit gate", () => {
  it("passes only a complete clean report with a successful exit", () => {
    expect(evaluateAudit({ status: 0, stdout: JSON.stringify(report()) }).passed).toBe(true);
  });

  it.each(["info", "low", "moderate", "high", "critical"] as const)(
    "blocks %s vulnerabilities, including development dependencies",
    (severity) => {
      for (const status of [0, 1]) {
        const result = evaluateAudit({ status, stdout: JSON.stringify(report(severity)) });
        expect(result.passed).toBe(false);
        expect(result.report).toEqual(report(severity));
      }
    },
  );

  it("does not accept exit 1 without findings as a successful audit", () => {
    expect(evaluateAudit({ status: 1, stdout: JSON.stringify(report()) }).passed).toBe(false);
  });

  it.each([null, 2])("blocks abnormal exit %s even with a clean-looking report", (status) => {
    expect(evaluateAudit({ status, stdout: JSON.stringify(report()) }).passed).toBe(false);
  });

  it("blocks a timeout or launch error rather than trusting partial output", () => {
    expect(evaluateAudit({ status: 0, stdout: JSON.stringify(report()), error: new Error("timeout") }).passed).toBe(false);
  });

  it.each(["", "not JSON", "null", "{}", JSON.stringify({ error: { code: "ENETUNREACH" } })])(
    "blocks missing, malformed, or failed registry responses: %s",
    (stdout) => expect(evaluateAudit({ status: 0, stdout }).passed).toBe(false),
  );

  it("requires a supported complete audit schema", () => {
    expect(evaluateAudit({ status: 0, stdout: JSON.stringify({ ...report(), auditReportVersion: 3 }) }).passed).toBe(false);
    expect(evaluateAudit({ status: 0, stdout: JSON.stringify({ ...report(), metadata: {} }) }).passed).toBe(false);
  });

  it("rejects hidden findings, unknown severities, and inconsistent totals", () => {
    const hidden = report("high");
    hidden.metadata.vulnerabilities.high = 0;
    hidden.metadata.vulnerabilities.total = 0;
    for (const value of [
      hidden,
      { ...report(), vulnerabilities: { example: { severity: "unknown" } } },
      { ...report(), metadata: { vulnerabilities: { ...report().metadata.vulnerabilities, total: 1 } } },
      { ...report(), metadata: { vulnerabilities: { ...report().metadata.vulnerabilities, low: "0" } } },
    ]) expect(evaluateAudit({ status: 0, stdout: JSON.stringify(value) }).passed).toBe(false);
  });
});
