import ortWasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmBinaryUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

type OnnxBackend = {
  wasm?: {
    numThreads?: number;
    wasmPaths?: unknown;
  };
};

type OnnxRuntimeEnvironment = {
  backends: {
    onnx?: OnnxBackend;
  };
  useWasmCache?: boolean;
};

export const LOCAL_ONNX_RUNTIME_WASM_PATHS = {
  mjs: ortWasmModuleUrl,
  wasm: ortWasmBinaryUrl,
} as const;

export function configureLocalOnnxRuntime(environment: OnnxRuntimeEnvironment) {
  const backend = environment.backends.onnx;

  if (!backend?.wasm) {
    throw new Error("ONNX Runtime WASM backend is unavailable.");
  }

  // The runtime assets are bundled and served from the application origin.
  // Transformers.js otherwise wraps the MJS loader in a blob URL for caching.
  environment.useWasmCache = false;
  backend.wasm.numThreads = 1;
  backend.wasm.wasmPaths = LOCAL_ONNX_RUNTIME_WASM_PATHS;
}
