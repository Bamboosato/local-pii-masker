import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const FORBIDDEN_BROWSER_APIS = [
  { label: "fetch", pattern: /\bfetch\s*\(/ },
  { label: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { label: "WebSocket", pattern: /\bWebSocket\b/ },
  { label: "sendBeacon", pattern: /\bsendBeacon\s*\(/ },
  { label: "localStorage", pattern: /\blocalStorage\b/ },
  { label: "sessionStorage", pattern: /\bsessionStorage\b/ },
  { label: "IndexedDB", pattern: /\bindexedDB\b/ },
  { label: "cookie", pattern: /\bdocument\.cookie\b/ },
  { label: "console", pattern: /\bconsole\.(?:debug|error|info|log|warn)\s*\(/ },
] as const;

describe("privacy source audit", () => {
  it("アプリケーションコードが通信・永続化・Console APIを直接使用しない", () => {
    const findings = collectSourceFiles(SOURCE_ROOT).flatMap((path) => {
      const source = readFileSync(path, "utf8");

      return FORBIDDEN_BROWSER_APIS.flatMap(({ label, pattern }) =>
        pattern.test(source)
          ? [`${relative(process.cwd(), path)}: ${label}`]
          : [],
      );
    });

    expect(findings).toEqual([]);
  });
});

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectSourceFiles(path);
    }

    if (
      ![".ts", ".tsx"].includes(extname(entry.name)) ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".test.tsx")
    ) {
      return [];
    }

    return [path];
  });
}
