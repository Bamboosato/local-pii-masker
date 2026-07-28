import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  MODEL_ASSET_ORIGINS,
} from "./securityHeaders";

describe("security headers", () => {
  it("本番CSPは同一オリジンと公開モデル配信元だけへ接続を許可する", () => {
    const policy = buildContentSecurityPolicy();

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain(`connect-src 'self' ${MODEL_ASSET_ORIGINS.join(" ")}`);
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).not.toContain("ws://");
    expect(policy).not.toContain("frame-ancestors");
  });

  it("開発時だけReact RefreshとlocalhostのHMR接続を許可する", () => {
    const policy = buildContentSecurityPolicy({
      allowDevelopmentScripts: true,
      allowDevelopmentSockets: true,
    });

    expect(policy).toContain(
      "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
    );
    expect(policy).toContain("ws://localhost:*");
    expect(policy).toContain("ws://127.0.0.1:*");
  });

  it("HTTPヘッダーではフレーム埋め込みと不要な端末機能を拒否する", () => {
    const headers = buildSecurityHeaders();

    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["Permissions-Policy"]).toContain("microphone=()");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("Vercel配信では全パスへ本番HTTPヘッダーを適用する", () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      headers: Array<{
        source: string;
        headers: Array<{ key: string; value: string }>;
      }>;
    };

    expect(config.headers).toHaveLength(1);
    expect(config.headers[0]?.source).toBe("/(.*)");
    expect(
      Object.fromEntries(
        config.headers[0]?.headers.map(({ key, value }) => [key, value]) ?? [],
      ),
    ).toEqual(buildSecurityHeaders());
  });
});
