import { useEffect, useRef, type RefObject } from "react";

type DialogFocusOptions = {
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function useDialogFocus({
  dialogRef,
  initialFocusRef,
  onEscape,
  returnFocusRef,
}: DialogFocusOptions): void {
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const returnFocus = returnFocusRef?.current ?? (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    );
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    const isTopmostDialog = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      return dialogs[dialogs.length - 1] === dialog;
    };
    const initialFocus = initialFocusRef?.current ?? focusable()[0];
    initialFocus?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDialog()) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const currentFocusable = focusable();
      if (currentFocusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocus?.isConnected) {
        returnFocus.focus();
      }
    };
  }, [dialogRef, initialFocusRef, returnFocusRef]);
}
