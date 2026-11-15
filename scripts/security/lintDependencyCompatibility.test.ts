import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseForESLint, clearCaches } from "@typescript-eslint/parser";
import { expect, it } from "vitest";

it("keeps the temporary minimatch override scoped to the reviewed parser version", () => {
  const require = createRequire(import.meta.url);
  const parserRequire = createRequire(
    require.resolve("@typescript-eslint/typescript-estree/package.json"),
  );
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.overrides).toEqual({
    "@typescript-eslint/typescript-estree@8.63.0": { minimatch: "11.0.8" },
  });
  expect(parserRequire("minimatch/package.json").version).toBe("11.0.8");
  const { minimatch } = parserRequire("minimatch") as {
    minimatch: (path: string, pattern: string, options: { dot: boolean }) => boolean;
  };
  // The sole minimatch call in typescript-estree uses this CommonJS export/options.
  expect(minimatch(".config.ts", "*.ts", { dot: true })).toBe(true);
  expect(minimatch("config.tsx", "*.{ts,tsx}", { dot: true })).toBe(true);
  expect(minimatch("src/config.ts", "*.ts", { dot: true })).toBe(false);
});

it("preserves project-service allowDefaultProject inclusion and exclusion", () => {
  const directory = mkdtempSync(join(tmpdir(), "pii-lint-compat-"));
  try {
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: { allowJs: true }, include: ["included.ts"],
    }));
    writeFileSync(join(directory, "included.ts"), "export {};");
    const options = {
      tsconfigRootDir: directory,
      projectService: { allowDefaultProject: [".config.ts"] },
    };
    const parsed = parseForESLint("const value: number = 1;", {
      ...options, filePath: join(directory, ".config.ts"),
    });
    expect(parsed.ast.type).toBe("Program");
    expect(parsed.services.program).toBeTruthy();
    expect(() => parseForESLint("const value: number = 1;", {
      ...options, filePath: join(directory, "excluded.ts"),
    })).toThrow(/does not match/);
  } finally {
    clearCaches();
    rmSync(directory, { recursive: true, force: true });
  }
});
