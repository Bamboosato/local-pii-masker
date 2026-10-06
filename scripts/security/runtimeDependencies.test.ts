import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("NER runtime dependency compatibility", () => {
  it("serves WASM/MJS from the exact ONNX Runtime version used by Transformers.js", () => {
    const require = createRequire(import.meta.url);
    const transformersDirectory = resolve(
      dirname(require.resolve("@huggingface/transformers")),
      "..",
    );
    const transformers = JSON.parse(
      readFileSync(resolve(transformersDirectory, "package.json"), "utf8"),
    ) as { dependencies: { "onnxruntime-web": string } };
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: { "onnxruntime-web": string };
    };
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { version: string }>;
    };

    // A successful mocked NER test cannot detect mismatched native WASM assets.
    expect(manifest.dependencies["onnxruntime-web"]).toBe(
      transformers.dependencies["onnxruntime-web"],
    );
    expect(lock.packages["node_modules/onnxruntime-web"].version).toBe(
      transformers.dependencies["onnxruntime-web"],
    );
  });
});
