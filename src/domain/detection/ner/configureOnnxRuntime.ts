import ortWasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmBinaryUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

type OnnxBackend = {
  wasm?: {
    wasmPaths?: unknown;
  };
};

export const LOCAL_ONNX_RUNTIME_WASM_PATHS = {
  mjs: ortWasmModuleUrl,
  wasm: ortWasmBinaryUrl,
} as const;

export function configureLocalOnnxRuntime(backend: OnnxBackend) {
  if (!backend.wasm) {
    throw new Error("ONNX Runtime WASM backend is unavailable.");
  }

  backend.wasm.wasmPaths = LOCAL_ONNX_RUNTIME_WASM_PATHS;
}
