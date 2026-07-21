import { useEffect, useRef, useState } from "react";
import { createNormalizationClient } from "../domain/normalization/document/normalizationClient";
import type { NormalizationClient } from "../domain/normalization/document/normalizationClient";
import type {
  DocumentNormalizationMode,
  DocumentNormalizationResult,
} from "../domain/normalization/document/types";

export type TextNormalizationDialogState =
  | { open: false }
  | {
      open: true;
      mode: DocumentNormalizationMode;
      sourceText: string;
      sourceRevision: number;
      status: "computing" | "ready" | "error";
      result?: DocumentNormalizationResult;
      errorCode?: string;
    };

export function useTextNormalization() {
  const [state, setState] = useState<TextNormalizationDialogState>({ open: false });
  const clientRef = useRef<NormalizationClient | null>(null);
  const requestSequenceRef = useRef(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const isOpen = state.open;
  const mode = state.open ? state.mode : "standard";
  const sourceText = state.open ? state.sourceText : "";
  const sourceRevision = state.open ? state.sourceRevision : 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const requestSequence = ++requestSequenceRef.current;
    let client = clientRef.current;
    if (!client) {
      client = createNormalizationClient();
      clientRef.current = client;
    }

    void client
      .request(sourceText, mode, sourceRevision)
      .then((response) => {
        if (requestSequence !== requestSequenceRef.current) {
          return;
        }
        setState((current) =>
          current.open
            ? {
                ...current,
                status: "ready",
                result: response.result,
                errorCode: undefined,
              }
            : current,
        );
      })
      .catch((error: unknown) => {
        if (requestSequence !== requestSequenceRef.current) {
          return;
        }
        setState((current) =>
          current.open
            ? {
                ...current,
                status: "error",
                result: undefined,
                errorCode: error instanceof Error ? error.message : "NORMALIZATION_FAILED",
              }
            : current,
        );
      });
  }, [isOpen, mode, retryNonce, sourceRevision, sourceText]);

  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  function open(sourceText: string, sourceRevision: number) {
    requestSequenceRef.current += 1;
    setRetryNonce(0);
    setState({
      open: true,
      mode: "standard",
      sourceText,
      sourceRevision,
      status: "computing",
    });
  }

  function close() {
    requestSequenceRef.current += 1;
    clientRef.current?.terminate();
    clientRef.current = null;
    setState({ open: false });
  }

  function setMode(mode: DocumentNormalizationMode) {
    setState((current) =>
      current.open
        ? { ...current, mode, status: "computing", result: undefined, errorCode: undefined }
        : current,
    );
  }

  function retry() {
    setRetryNonce((current) => current + 1);
    setState((current) => (current.open ? { ...current, status: "computing" } : current));
  }

  return { state, open, close, setMode, retry };
}
