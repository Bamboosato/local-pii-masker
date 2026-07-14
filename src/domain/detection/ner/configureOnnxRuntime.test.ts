import { describe, expect, it } from "vitest";
import {
  configureLocalOnnxRuntime,
  LOCAL_ONNX_RUNTIME_WASM_PATHS,
} from "./configureOnnxRuntime";

describe("ONNX Runtimeのローカル資材設定", () => {
  it("WASMとMJSを外部CDNではなくアプリ配信URLへ固定する", () => {
    const environment: {
      backends: {
        onnx: {
          wasm: {
            numThreads?: number;
            wasmPaths?: string | { mjs: string; wasm: string };
          };
        };
      };
      useWasmCache: boolean;
    } = {
      backends: { onnx: { wasm: {} } },
      useWasmCache: true,
    };

    configureLocalOnnxRuntime(environment);

    expect(environment.useWasmCache).toBe(false);
    expect(environment.backends.onnx.wasm.numThreads).toBe(1);
    expect(environment.backends.onnx.wasm.wasmPaths).toEqual(
      LOCAL_ONNX_RUNTIME_WASM_PATHS,
    );
    expect(LOCAL_ONNX_RUNTIME_WASM_PATHS.mjs).not.toMatch(/^https?:/u);
    expect(LOCAL_ONNX_RUNTIME_WASM_PATHS.wasm).not.toMatch(/^https?:/u);
  });

  it("WASMバックエンドがない環境を明示的に拒否する", () => {
    expect(() => configureLocalOnnxRuntime({ backends: {} })).toThrow(
      "ONNX Runtime WASM backend is unavailable.",
    );
  });
});
