import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { HighlightSegment } from "../domain/mask/highlightText";

type OriginalTextEditorProps = {
  highlights: HighlightSegment[];
  maxLength: number;
  onChange: (value: string) => void;
  onSelectionChange: (value: string) => void;
  placeholder: string;
  selectedEntryId?: string;
  value: string;
};

const setHighlightsEffect = StateEffect.define<DecorationSet>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  provide: (field) => EditorView.decorations.from(field),
  update: (decorations, transaction) => {
    let nextDecorations = decorations.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(setHighlightsEffect)) {
        nextDecorations = effect.value;
      }
    }

    return nextDecorations;
  },
});

export function OriginalTextEditor({
  highlights,
  maxLength,
  onChange,
  onSelectionChange,
  placeholder,
  selectedEntryId,
  value,
}: OriginalTextEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null);
  const callbacksRef = useRef({ onChange, onSelectionChange });
  const initialValueRef = useRef(value);

  useEffect(() => {
    callbacksRef.current = { onChange, onSelectionChange };
  }, [onChange, onSelectionChange]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "原文",
          "aria-multiline": "true",
          spellcheck: "true",
        }),
        placeholderExtension(placeholder),
        EditorState.changeFilter.of(
          (transaction) => transaction.newDoc.length <= maxLength,
        ),
        highlightField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            callbacksRef.current.onChange(update.state.doc.toString());
          }

          if (update.docChanged || update.selectionSet) {
            const { from, to } = update.state.selection.main;
            callbacksRef.current.onSelectionChange(update.state.sliceDoc(from, to));
          }
        }),
      ],
    });
    const view = new EditorView({ parent: host, state });
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [maxLength, placeholder]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view || view.state.doc.toString() === value) {
      return;
    }

    view.dispatch({
      changes: { from: 0, insert: value, to: view.state.doc.length },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    const ranges = highlights.flatMap((segment) => {
      if (
        segment.type !== "highlight" ||
        segment.start >= segment.end ||
        segment.end > view.state.doc.length
      ) {
        return [];
      }

      return [
        Decoration.mark({
          class: getHighlightClass(
            segment,
            selectedEntryId === segment.entryId,
          ),
        }).range(segment.start, segment.end),
      ];
    });

    view.dispatch({
      effects: setHighlightsEffect.of(Decoration.set(ranges, true)),
    });
  }, [highlights, selectedEntryId]);

  return <div className="original-text-editor" ref={hostRef} />;
}

function getHighlightClass(
  segment: Extract<HighlightSegment, { type: "highlight" }>,
  isSelected: boolean,
) {
  const stateClass =
    segment.reviewStatus === "unreviewed"
      ? "is-pending"
      : segment.enabled
        ? "is-approved"
        : "is-disabled";

  return `original-highlight ${stateClass}${isSelected ? " is-selected" : ""}`;
}
