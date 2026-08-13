import {
  ChevronDown,
  Copy,
  FolderOpen,
  Eraser,
  Eye,
  EyeOff,
  EllipsisVertical,
  Info,
  Link2,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Search,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  appReducer,
  type EntryFilter,
  initialAppState,
} from "./app/reducer";
import {
  getNormalizationAvailability,
  getNormalizationTooltipMessage,
} from "./app/normalizationAvailability";
import {
  getNextRelatedGroupNumber,
  getRelatedGroupLabels,
} from "./app/relatedGroupLabels";
import {
  selectActiveEntries,
  selectMaskableOccurrenceCount,
  selectMaskedText,
  selectRestoredResponse,
  selectSessionCounts,
  selectTokenInspection,
  selectVisibleEntries,
} from "./app/selectors";
import {
  OriginalTextEditor,
  type OriginalTextEditorHandle,
} from "./components/OriginalTextEditor";
import { PwaStatus, type PwaModelState } from "./components/PwaStatus";
import { TextNormalizationDialog } from "./components/TextNormalizationDialog";
import {
  MaskMappingLibraryDialog,
  MaskMappingSaveDialog,
} from "./components/MaskMappingDialogs";
import { useDialogFocus } from "./components/useDialogFocus";
import type { DetectionCandidate } from "./domain/detection/mergeCandidates";
import { enrichPersonCandidates } from "./domain/detection/enrichPersonCandidates";
import { extendHonorificCandidates } from "./domain/detection/extendHonorificCandidates";
import { refineDetectionCandidates } from "./domain/detection/refineDetectionCandidates";
import {
  NerDetectionCancelledError,
  runNerDetection,
} from "./domain/detection/ner/runNerDetection";
import type { NerDetectionProgress } from "./domain/detection/ner/types";
import { runRegexDetection } from "./domain/detection/regex/runRegexDetection";
import { countOccurrences, findOccurrences } from "./domain/mask/findOccurrences";
import { buildHighlightSegments } from "./domain/mask/highlightText";
import { buildMaskSegments } from "./domain/mask/maskText";
import { createMaskToken } from "./domain/mask/tokenFactory";
import {
  deleteAllMaskMappings,
  isMappingStorageSupported,
} from "./domain/mapping/opfsRepository";
import { createMaskMappingFingerprint } from "./domain/mapping/snapshot";
import type { MaskMapping } from "./domain/mapping/types";
import { normalizeText } from "./domain/normalization/normalizeText";
import { useTextNormalization } from "./hooks/useTextNormalization";
import {
  CATEGORY_LABELS,
  MASK_CATEGORIES,
  NORMALIZATION_RULE_LABELS,
  SOURCE_LABELS,
  type MaskCategory,
  type MaskEntry,
  type OccurrenceMaskingMode,
} from "./domain/types";

const MAX_CHAR_COUNT = 30_000;
const DETECTION_PROGRESS_DELAY_MS = 1000;
const RESTORE_TEXTAREA_MIN_HEIGHT = 160;
type DetectionPhase = "idle" | "regex" | "ner-loading" | "ner-running";
type NerDetectionOutcome = "success" | "failed" | "cancelled";
type DetectionCancellationReason =
  | "manual"
  | "source-changed"
  | "session-cleared"
  | "unmount";
type RelationMode = "new" | "existing";
type UnlinkScope = "entry" | "group";
type RelatedGroupOption = {
  groupId: string;
  label: string;
};

function calculateRestoreTextareaHeight(
  content: HTMLDivElement,
  dock: HTMLElement,
  appHeader: HTMLElement,
  appShell: HTMLElement,
): number | undefined {
  const textareas = Array.from(
    content.querySelectorAll<HTMLTextAreaElement>("textarea"),
  );

  if (textareas.length === 0) {
    return undefined;
  }

  const columns = Math.max(
    1,
    getComputedStyle(content).gridTemplateColumns
      .trim()
      .split(/\s+/)
      .filter(Boolean).length,
  );
  const rows = Math.ceil(textareas.length / columns);
  const rowHeights = Array.from({ length: rows }, () => 0);

  textareas.forEach((textarea, index) => {
    const row = Math.floor(index / columns);
    rowHeights[row] = Math.max(
      rowHeights[row],
      textarea.getBoundingClientRect().height,
    );
  });

  const currentTextareasHeight = rowHeights.reduce(
    (sum, height) => sum + height,
    0,
  );
  const contentRect = content.getBoundingClientRect();
  const dockRect = dock.getBoundingClientRect();
  const fixedHeight = contentRect.bottom - dockRect.top - currentTextareasHeight;
  const availableHeight =
    (appShell.getBoundingClientRect().bottom -
      appHeader.getBoundingClientRect().bottom -
      fixedHeight) /
    rows;

  if (!Number.isFinite(availableHeight)) {
    return undefined;
  }

  return Math.max(RESTORE_TEXTAREA_MIN_HEIGHT, Math.floor(availableHeight));
}

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [selectedText, setSelectedText] = useState("");
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualCategory, setManualCategory] = useState<MaskCategory>("PERSON");
  const [relationDialogOpen, setRelationDialogOpen] = useState(false);
  const [relationMode, setRelationMode] = useState<RelationMode>("new");
  const [relationGroupId, setRelationGroupId] = useState("");
  const [relationRestorationText, setRelationRestorationText] = useState("");
  const [unlinkDialogEntryId, setUnlinkDialogEntryId] = useState<string>();
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [mappingSaveOpen, setMappingSaveOpen] = useState(false);
  const [mappingLibraryOpen, setMappingLibraryOpen] = useState(false);
  const [mappingLibraryRefreshKey, setMappingLibraryRefreshKey] = useState(0);
  const [mappingDeleteAllConfirmOpen, setMappingDeleteAllConfirmOpen] = useState(false);
  const [mappingDeleteAllCount, setMappingDeleteAllCount] = useState(0);
  const [pendingLoadedMapping, setPendingLoadedMapping] = useState<MaskMapping>();
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [entrySearchOpen, setEntrySearchOpen] = useState(false);
  const [detectionPhase, setDetectionPhase] = useState<DetectionPhase>("idle");
  const [modelState, setModelState] = useState<PwaModelState>("unknown");
  const [showDetectionProgress, setShowDetectionProgress] = useState(false);
  const [restoreInputsExpanded, setRestoreInputsExpanded] = useState(false);
  const [restoreTextareaHeight, setRestoreTextareaHeight] = useState<number>();
  const mappingStorageSupported = isMappingStorageSupported();
  const normalization = useTextNormalization();
  const detectionAbortRef = useRef<AbortController | undefined>(undefined);
  const latestDetectionMergeContextRef = useRef({
    entries: state.entries,
    originalText: state.originalText,
  });
  const lastSelectionControlRef = useRef<HTMLButtonElement>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const appHeaderRef = useRef<HTMLElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const headerMenuButtonRef = useRef<HTMLButtonElement>(null);
  const clearMenuItemRef = useRef<HTMLButtonElement>(null);
  const normalizationMenuItemRef = useRef<HTMLButtonElement>(null);
  const detectionButtonRef = useRef<HTMLButtonElement>(null);
  const entrySearchButtonRef = useRef<HTMLButtonElement>(null);
  const entrySearchInputRef = useRef<HTMLInputElement>(null);
  const relationReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const unlinkReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const managementPanelRef = useRef<HTMLElement>(null);
  const entryListRef = useRef<HTMLDivElement>(null);
  const restoreDockRef = useRef<HTMLElement>(null);
  const restoreContentRef = useRef<HTMLDivElement>(null);
  const restoreTextareaHeightBeforeExpandRef = useRef<number | undefined>(undefined);
  const originalEditorRef = useRef<OriginalTextEditorHandle>(null);
  const maskedPreviewRef = useRef<HTMLDivElement>(null);
  const maskedText = selectMaskedText(state);
  const counts = selectSessionCounts(state);
  const visibleEntries = selectVisibleEntries(state);
  const activeEntries = selectActiveEntries(state.entries);
  const currentMappingFingerprint = createMaskMappingFingerprint(
    state.entries,
    state.occurrenceMaskingMode,
  );
  const hasUnsavedMappingChanges = state.mapping
    ? state.mapping.fingerprint !== currentMappingFingerprint
    : activeEntries.length > 0;
  const restoration = selectRestoredResponse(state);
  const tokenInspection = selectTokenInspection(state);
  const unlinkDialogEntry = unlinkDialogEntryId
    ? state.entries.find((entry) => entry.id === unlinkDialogEntryId)
    : undefined;
  const selectedRelationEntries = state.entries.filter((entry) =>
    state.selectedEntryIds.includes(entry.id),
  );
  const relatedGroupLabels = useMemo(
    () => getRelatedGroupLabels(state.entries),
    [state.entries],
  );
  const relatedGroupOptions = useMemo<RelatedGroupOption[]>(
    () =>
      [...relatedGroupLabels.entries()]
        .map(([groupId, label]) => ({ groupId, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "ja", { numeric: true })),
    [relatedGroupLabels],
  );
  const canRelateSelectedEntries =
    selectedRelationEntries.length >= 1 &&
    selectedRelationEntries.length === state.selectedEntryIds.length &&
    selectedRelationEntries.every(isRelatableEntry) &&
    state.externalResponse.trim().length === 0 &&
    (selectedRelationEntries.length >= 2 || relatedGroupOptions.length > 0);
  const relationDisabledReason =
    state.externalResponse.trim().length > 0
      ? "復元する文章を空にしてから関連付けてください"
      : selectedRelationEntries.length === 1 && relatedGroupOptions.length === 0
        ? "既存の関連付けがないため、人名を2件以上選択してください"
        : "有効な人名のマスク対象を1件以上選択してください";
  const isDetecting = detectionPhase !== "idle";
  const normalizationAvailability = getNormalizationAvailability({
    originalText: state.originalText,
    normalizationLockReason: state.normalizationLockReason,
    isDetecting,
    isNormalizing: normalization.state.open,
  });
  const normalizationTooltipMessage = getNormalizationTooltipMessage(normalizationAvailability);
  const hasSessionData =
    state.originalText.length > 0 ||
    state.entries.length > 0 ||
    state.externalResponse.length > 0;
  const restoreTextareaStyle =
    restoreTextareaHeight === undefined
      ? undefined
      : { height: `${restoreTextareaHeight}px` };
  const manualPreviewToken = useMemo(() => {
    const normalizedSelection = normalizeText(selectedText);
    const existing = state.entries.find(
      (entry) => entry.normalizedText === normalizedSelection,
    );

    return (
      existing?.token ??
      createMaskToken(manualCategory, {
        originalText: state.originalText,
        entries: state.entries,
      })
    );
  }, [manualCategory, selectedText, state.entries, state.originalText]);
  const maskedSegments = useMemo(
    () =>
      buildMaskSegments(
        state.originalText,
        state.entries,
        state.occurrenceMaskingMode,
      ),
    [state.entries, state.occurrenceMaskingMode, state.originalText],
  );
  const originalHighlightSegments = useMemo(
    () =>
      buildHighlightSegments(
        state.originalText,
        state.entries,
        state.occurrenceMaskingMode,
      ),
    [state.entries, state.occurrenceMaskingMode, state.originalText],
  );

  useEffect(() => {
    latestDetectionMergeContextRef.current = {
      entries: state.entries,
      originalText: state.originalText,
    };
  }, [state.entries, state.originalText]);

  useEffect(
    () => () => {
      const controller = detectionAbortRef.current;

      if (controller && !controller.signal.aborted) {
        controller.abort("unmount" satisfies DetectionCancellationReason);
      }
    },
    [],
  );

  useEffect(() => {
    if (entrySearchOpen) {
      window.requestAnimationFrame(() => entrySearchInputRef.current?.focus());
    }
  }, [entrySearchOpen]);

  useEffect(() => {
    const panel = managementPanelRef.current;
    const entryList = entryListRef.current;

    if (!panel || !entryList) {
      return;
    }

    const updateScrollbarWidth = () => {
      const scrollbarWidth = Math.max(0, entryList.offsetWidth - entryList.clientWidth);
      panel.style.setProperty("--entry-list-scrollbar-width", `${scrollbarWidth}px`);
    };

    updateScrollbarWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScrollbarWidth);
      return () => window.removeEventListener("resize", updateScrollbarWidth);
    }

    const observer = new ResizeObserver(updateScrollbarWidth);
    observer.observe(entryList);

    return () => observer.disconnect();
  }, [entrySearchOpen, state.entryFilter, state.entries, visibleEntries.length]);

  useEffect(() => {
    if (!headerMenuOpen) {
      return;
    }

    normalizationMenuItemRef.current?.focus();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !headerMenuRef.current?.contains(event.target)
      ) {
        setHeaderMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHeaderMenuOpen(false);
        headerMenuButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [headerMenuOpen]);

  useEffect(() => {
    if (!state.notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      dispatch({ type: "setNotice" });
    }, 2800);

    return () => window.clearTimeout(timeout);
  }, [state.notice]);

  useEffect(() => {
    if (!hasUnsavedMappingChanges) {
      return;
    }

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedMappingChanges]);

  useEffect(() => {
    if (!isDetecting) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowDetectionProgress(true);
    }, DETECTION_PROGRESS_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [isDetecting]);

  useEffect(() => {
    if (!state.restoreExpanded || typeof ResizeObserver === "undefined") {
      return;
    }

    const content = restoreContentRef.current;

    if (!content) {
      return;
    }

    const textareas = Array.from(
      content.querySelectorAll<HTMLTextAreaElement>("textarea"),
    );

    if (textareas.length === 0) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];

      if (!entry) {
        return;
      }

      const measuredHeight = Math.round(
        (entry.target as HTMLTextAreaElement).getBoundingClientRect().height,
      );
      const content = restoreContentRef.current;
      const dock = restoreDockRef.current;
      const appHeader = appHeaderRef.current;
      const appShell = appShellRef.current;
      const maxExpandedHeight =
        restoreInputsExpanded && content && dock && appHeader && appShell
          ? calculateRestoreTextareaHeight(content, dock, appHeader, appShell)
          : undefined;
      const nextHeight =
        maxExpandedHeight ??
        Math.max(RESTORE_TEXTAREA_MIN_HEIGHT, measuredHeight);
      setRestoreTextareaHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight,
      );
    });

    textareas.forEach((textarea) => observer.observe(textarea));

    return () => observer.disconnect();
  }, [restoreInputsExpanded, state.restoreExpanded]);

  useEffect(() => {
    if (!restoreInputsExpanded) {
      return;
    }

    const updateExpandedHeight = () => {
      const content = restoreContentRef.current;
      const dock = restoreDockRef.current;
      const appHeader = appHeaderRef.current;
      const appShell = appShellRef.current;

      if (!content || !dock || !appHeader || !appShell) {
        return;
      }

      const nextHeight = calculateRestoreTextareaHeight(
        content,
        dock,
        appHeader,
        appShell,
      );

      if (nextHeight !== undefined) {
        setRestoreTextareaHeight(nextHeight);
      }
    };

    window.addEventListener("resize", updateExpandedHeight);

    return () => window.removeEventListener("resize", updateExpandedHeight);
  }, [restoreInputsExpanded]);

  function openManualDialog() {
    const normalizedSelection = selectedText.normalize("NFC");

    if (normalizedSelection.trim().length === 0) {
      dispatch({ type: "setNotice", value: "文字列を選択してください。" });
      return;
    }

    setSelectedText(normalizedSelection);
    setManualDialogOpen(true);
  }

  function addManualEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({
      type: "addManualEntry",
      value: {
        id: createEntryId(),
        selectedText,
        category: manualCategory,
      },
    });
    setManualDialogOpen(false);
    lastSelectionControlRef.current?.focus();
  }

  function openRelationDialog() {
    if (!canRelateSelectedEntries) {
      dispatch({
        type: "setNotice",
        value:
          state.externalResponse.trim().length > 0
            ? "復元する文章を空にしてから関連付けてください。"
            : "既存の関連付けがない場合は、有効な人名のマスク対象を2件以上選択してください。",
      });
      return;
    }

    const initialMode: RelationMode =
      selectedRelationEntries.length >= 2 ? "new" : "existing";
    const suggestion = [...selectedRelationEntries]
      .sort((a, b) => b.restorationText.length - a.restorationText.length)[0]
      ?.restorationText ?? "";
    setRelationMode(initialMode);
    setRelationGroupId(relatedGroupOptions[0]?.groupId ?? "");
    setRelationRestorationText(suggestion);
    setRelationDialogOpen(true);
  }

  function openRelationDialogFromMenu(trigger: HTMLButtonElement | null) {
    relationReturnFocusRef.current = trigger;
    openRelationDialog();
  }

  function focusRelationTrigger() {
    window.requestAnimationFrame(() => relationReturnFocusRef.current?.focus());
  }

  function relateEntries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({
      type: "relateEntries",
      ids: state.selectedEntryIds,
      groupId:
        relationMode === "new"
          ? createRelatedGroupId(state.entries)
          : relationGroupId,
      mode: relationMode,
      restorationText:
        relationMode === "new" ? relationRestorationText : undefined,
    });
    setRelationDialogOpen(false);
    focusRelationTrigger();
  }

  function requestUnlinkRelatedEntry(
    entryId: string,
    trigger: HTMLButtonElement | null,
  ) {
    const target = state.entries.find((entry) => entry.id === entryId);
    const groupSize = target?.relatedGroupId
      ? state.entries.filter(
          (entry) => entry.relatedGroupId === target.relatedGroupId,
        ).length
      : 0;

    if (target?.relatedGroupId && groupSize >= 3) {
      unlinkReturnFocusRef.current = trigger;
      setUnlinkDialogEntryId(entryId);
      return;
    }

    dispatch({ type: "unlinkRelatedEntry", id: entryId });
  }

  function closeUnlinkDialog() {
    setUnlinkDialogEntryId(undefined);
    window.requestAnimationFrame(() => unlinkReturnFocusRef.current?.focus());
  }

  function unlinkRelatedEntry(scope: UnlinkScope) {
    const entryId = unlinkDialogEntryId;
    if (!entryId) {
      return;
    }

    dispatch({
      type: scope === "group" ? "unlinkRelatedGroup" : "unlinkRelatedEntry",
      id: entryId,
    });
    closeUnlinkDialog();
  }

  function openNormalizationDialog() {
    if (normalizationAvailability.state !== "enabled") {
      return;
    }
    setHeaderMenuOpen(false);
    normalization.open(state.originalText, state.originalRevision);
  }

  function openMappingSaveDialog() {
    setHeaderMenuOpen(false);
    if (!mappingStorageSupported) {
      dispatch({ type: "setNotice", value: "このブラウザでは対応表の保存を利用できません。現在の作業は一時利用できます。" });
      return;
    }
    if (activeEntries.length === 0 && !state.mapping) {
      dispatch({ type: "setNotice", value: "保存する有効なマスク対応がありません。" });
      return;
    }
    setMappingSaveOpen(true);
  }

  function openMappingLibrary() {
    setHeaderMenuOpen(false);
    if (!mappingStorageSupported) {
      dispatch({ type: "setNotice", value: "このブラウザでは保存済み対応表を利用できません。現在の作業は一時利用できます。" });
      return;
    }
    setMappingLibraryOpen(true);
  }

  function requestDeleteAllSavedMappings(count: number) {
    setMappingDeleteAllCount(count);
    setMappingDeleteAllConfirmOpen(true);
  }

  function handleMappingSaved(mapping: MaskMapping) {
    dispatch({
      type: "markMaskMappingSaved",
      mapping: {
        mappingId: mapping.mappingId,
        name: mapping.name,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
        revision: mapping.revision,
        fingerprint: createMaskMappingFingerprint(
          state.entries,
          state.occurrenceMaskingMode,
        ),
      },
    });
    setMappingSaveOpen(false);
    dispatch({ type: "setNotice", value: "マスク対応表を暗号化して保存しました。" });
  }

  function handleMappingLoaded(mapping: MaskMapping) {
    setMappingLibraryOpen(false);
    if (state.externalResponse.trim().length > 0) {
      dispatch({ type: "setNotice", value: "復元する文章を空にしてから対応表を開いてください。" });
      return;
    }
    if (state.entries.length > 0) {
      setPendingLoadedMapping(mapping);
      return;
    }
    dispatch({ type: "loadMaskMapping", mapping });
  }

  function closeMappingLibrary() {
    setMappingLibraryOpen(false);
    window.requestAnimationFrame(() => headerMenuButtonRef.current?.focus());
  }

  function applyPendingLoadedMapping() {
    if (!pendingLoadedMapping) {
      return;
    }
    dispatch({ type: "loadMaskMapping", mapping: pendingLoadedMapping });
    setPendingLoadedMapping(undefined);
  }

  async function removeAllSavedMappings() {
    try {
      await deleteAllMaskMappings();
      setMappingDeleteAllConfirmOpen(false);
      setMappingLibraryRefreshKey((key) => key + 1);
      dispatch({ type: "setNotice", value: "保存済みの対応表をすべて削除しました。現在の作業は消去していません。" });
    } catch {
      setMappingDeleteAllConfirmOpen(false);
      dispatch({ type: "setNotice", value: "保存済みの対応表を削除できませんでした。" });
    }
  }

  function applyNormalization(
    value: string,
    expectedRevision: number,
  ) {
    dispatch({ type: "applyNormalizedOriginal", value, expectedRevision });
    normalization.close();
    window.requestAnimationFrame(() => detectionButtonRef.current?.focus());
  }

  function toggleRestoreInputsExpanded() {
    runWithOptionalViewTransition(() => {
      const nextExpanded = !restoreInputsExpanded;

      if (nextExpanded) {
        const content = restoreContentRef.current;
        const dock = restoreDockRef.current;
        const appHeader = appHeaderRef.current;
        const appShell = appShellRef.current;

        const currentTextarea = content?.querySelector<HTMLTextAreaElement>("textarea");
        const currentHeight = currentTextarea?.getBoundingClientRect().height;

        restoreTextareaHeightBeforeExpandRef.current =
          restoreTextareaHeight ??
          (currentHeight && currentHeight >= RESTORE_TEXTAREA_MIN_HEIGHT
            ? Math.round(currentHeight)
            : RESTORE_TEXTAREA_MIN_HEIGHT);

        if (content && dock && appHeader && appShell) {
          const nextHeight = calculateRestoreTextareaHeight(
            content,
            dock,
            appHeader,
            appShell,
          );

          if (nextHeight !== undefined) {
            setRestoreTextareaHeight(nextHeight);
          }
        }
      } else {
        setRestoreTextareaHeight(restoreTextareaHeightBeforeExpandRef.current);
        restoreTextareaHeightBeforeExpandRef.current = undefined;
      }

      setRestoreInputsExpanded(nextExpanded);
    });
  }

  async function copyMaskedText(force = false) {
    if (!force && (activeEntries.length === 0 || maskedText === state.originalText)) {
      setCopyConfirmOpen(true);
      return;
    }

    try {
      await navigator.clipboard.writeText(maskedText);
      dispatch({ type: "setNotice", value: "マスク結果をコピーしました。" });
    } catch {
      dispatch({
        type: "setNotice",
        value: "コピーできませんでした。手動で選択してコピーしてください。",
      });
    }
  }

  async function runAutoDetection() {
    if (state.originalText.trim().length === 0 || isDetecting) {
      return;
    }

    setShowDetectionProgress(false);
    setDetectionPhase("regex");
    dispatch({ type: "setNotice" });
    const detectionText = state.originalText;
    const detectionController = new AbortController();
    detectionAbortRef.current = detectionController;

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    try {
      const regexCandidates = runRegexDetection(detectionText);
      let nerCandidates: DetectionCandidate[] = [];
      let nerOutcome: NerDetectionOutcome = "success";

      try {
        setDetectionPhase("ner-loading");
        setModelState("loading");
        nerCandidates = await runNerDetection(detectionText, {
          signal: detectionController.signal,
          onProgress: (progress) => {
            setDetectionPhase(toDetectionPhase(progress));
            setModelState(progress.phase === "loading" ? "loading" : "available");
          },
        });
        setModelState("available");
      } catch (error) {
        if (error instanceof NerDetectionCancelledError) {
          if (error.reason === "source-changed") {
            dispatch({
              type: "setNotice",
              value:
                "原文が変更されたため、自動検出結果は反映しませんでした。もう一度自動検出してください。",
            });
            return;
          }

          if (error.reason === "session-cleared" || error.reason === "unmount") {
            return;
          }

          nerOutcome = "cancelled";
        } else {
          nerOutcome = "failed";
          setModelState("unavailable");
        }
      }

      const latestContext = latestDetectionMergeContextRef.current;

      if (latestContext.originalText !== detectionText) {
        dispatch({
          type: "setNotice",
          value:
            "原文が変更されたため、自動検出結果は反映しませんでした。もう一度自動検出してください。",
        });
        return;
      }

      const refinedCandidates = refineDetectionCandidates(
        detectionText,
        enrichPersonCandidates(detectionText, [
          ...regexCandidates,
          ...nerCandidates,
        ]),
      );
      const candidates = extendHonorificCandidates(
        detectionText,
        refinedCandidates,
      );
      const summary = summarizeDetectionMerge(latestContext.entries, candidates);

      dispatch({
        type: "completeDetection",
        candidates,
        createId: createEntryId,
        outcome: nerOutcome,
      });

      if (candidates.length > 0) {
        dispatch({ type: "setEntryFilter", value: "enabled" });
      }

      dispatch({
        type: "setNotice",
        value: formatDetectionNotice(candidates.length, summary, nerOutcome),
      });
    } catch {
      dispatch({
        type: "setNotice",
        value:
          "自動検出でエラーが発生しました。原文と既存のマスク設定は保持されています。",
      });
    } finally {
      if (detectionAbortRef.current === detectionController) {
        detectionAbortRef.current = undefined;
      }

      setShowDetectionProgress(false);
      setDetectionPhase("idle");
    }
  }

  function abortActiveDetection(reason: DetectionCancellationReason) {
    const controller = detectionAbortRef.current;

    if (controller && !controller.signal.aborted) {
      controller.abort(reason);
    }
  }

  function handleOriginalTextChange(value: string) {
    abortActiveDetection("source-changed");
    dispatch({ type: "setOriginalText", value });
  }

  const isRestoreInputsMaximized = state.restoreExpanded && restoreInputsExpanded;

  function runWithOptionalViewTransition(update: () => void) {
    const applyUpdate = () => flushSync(update);

    if (!document.startViewTransition || prefersReducedMotion()) {
      applyUpdate();
      return;
    }

    document.startViewTransition(applyUpdate);
  }

  function toggleRestoreExpanded() {
    runWithOptionalViewTransition(() => {
      dispatch({
        type: "setRestoreExpanded",
        value: !state.restoreExpanded,
      });
    });
  }

  return (
    <div
      className={`app-shell${isRestoreInputsMaximized ? " is-restore-maximized" : ""}`}
      ref={appShellRef}
    >
      <header className="app-header" ref={appHeaderRef}>
        <div className="brand-cluster">
          <h1>Local PII Masker</h1>
          <span
            aria-describedby="privacy-status-details"
            className="privacy-status"
            tabIndex={0}
          >
            <ShieldCheck aria-hidden="true" size={14} />
            ローカル処理・外部送信なし
            <span
              className="privacy-tooltip"
              id="privacy-status-details"
              role="tooltip"
            >
              公開モデル資材を取得する場合があります。原文や検出値は外部へ送信されません。デフォルトではユーザーデータを永続保存せず、明示操作時だけマスク対応表を暗号化してブラウザ内に保存します。
            </span>
          </span>
        </div>
        <div className="header-actions">
          <PwaStatus hasSessionData={hasSessionData} modelState={modelState} />
          <div className="header-menu" ref={headerMenuRef}>
            <button
              aria-controls="header-session-menu"
              aria-expanded={headerMenuOpen}
              aria-haspopup="menu"
              aria-label="メニュー"
              className="icon-button header-menu-trigger"
              disabled={!hasSessionData && !mappingStorageSupported}
              onClick={() => setHeaderMenuOpen((open) => !open)}
              ref={headerMenuButtonRef}
              title="マスク対応表と現在の作業のメニューを開く"
              type="button"
            >
              <EllipsisVertical aria-hidden="true" size={20} />
            </button>
            {headerMenuOpen ? (
              <div
                aria-label="マスク対応表と現在の作業の操作"
                className="header-menu-popover"
                id="header-session-menu"
                role="menu"
              >
                <div aria-labelledby="header-mask-mapping-group" className="header-menu-group" role="group">
                  <div className="header-menu-group-label" id="header-mask-mapping-group">マスク対応表</div>
                  <button
                    className="header-menu-item"
                    disabled={!mappingStorageSupported || (activeEntries.length === 0 && !state.mapping)}
                    onClick={openMappingSaveDialog}
                    role="menuitem"
                    title={mappingStorageSupported ? "マスク対象とマスク文字列の対応関係だけを暗号化して保存します" : "このブラウザでは対応表の保存を利用できません"}
                    type="button"
                  >
                    <Save aria-hidden="true" size={16} />
                    対応表を保存
                  </button>
                  <button
                    className="header-menu-item"
                    disabled={!mappingStorageSupported}
                    onClick={openMappingLibrary}
                    role="menuitem"
                    title="保存済み対応表の一覧・開く・削除する操作を表示します"
                    type="button"
                  >
                    <FolderOpen aria-hidden="true" size={16} />
                    保存済み対応表を管理
                  </button>
                </div>
                <div aria-hidden="true" className="header-menu-separator" role="separator" />
                <div aria-labelledby="header-current-work-group" className="header-menu-group" role="group">
                  <div className="header-menu-group-label" id="header-current-work-group">現在の作業</div>
                  <div className="header-menu-tooltip-anchor" role="none">
                    <button
                      aria-describedby="normalization-menu-tooltip"
                      aria-disabled={normalizationAvailability.state !== "enabled"}
                      className="header-menu-item"
                      onClick={openNormalizationDialog}
                      ref={normalizationMenuItemRef}
                      role="menuitem"
                      type="button"
                    >
                      <Eraser aria-hidden="true" size={16} />
                      テキストを正規化
                    </button>
                    <span
                      className="normalization-menu-tooltip"
                      id="normalization-menu-tooltip"
                      role="tooltip"
                    >
                      {normalizationTooltipMessage}
                    </span>
                  </div>
                  <button
                    className="header-menu-item danger"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      setClearConfirmOpen(true);
                    }}
                    ref={clearMenuItemRef}
                    role="menuitem"
                    title="現在の画面上の作業だけを消去します"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                    現在の作業を消去
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main aria-busy={isDetecting} className="main-grid">
        <section className="workspace" aria-label="テキストワークスペース">
          <div className="tabs">
            <div className="tab-list" role="tablist" aria-label="表示切り替え">
              <button
                aria-controls="original-panel"
                className={state.activeTextView === "original" ? "tab is-active" : "tab"}
                id="original-tab"
                role="tab"
                aria-selected={state.activeTextView === "original"}
                title="原文を表示"
                type="button"
                onClick={() => dispatch({ type: "setActiveTextView", value: "original" })}
              >
                原文
              </button>
              <button
                aria-controls="masked-panel"
                className={state.activeTextView === "masked" ? "tab is-active" : "tab"}
                id="masked-tab"
                role="tab"
                aria-selected={state.activeTextView === "masked"}
                title="マスク結果を表示"
                type="button"
                onClick={() => dispatch({ type: "setActiveTextView", value: "masked" })}
              >
                マスク結果
              </button>
            </div>
            <div className="tab-actions">
              {state.activeTextView === "original" ? (
                <>
                  <button
                    className="button button-primary"
                    disabled={state.originalText.trim().length === 0}
                    onClick={() => {
                      if (isDetecting) {
                        abortActiveDetection("manual");
                      } else {
                        void runAutoDetection();
                      }
                    }}
                    ref={detectionButtonRef}
                    title={
                      isDetecting
                        ? "自動検出を中止します"
                        : getDetectionButtonLabel(detectionPhase, state.entries)
                    }
                    type="button"
                  >
                    {isDetecting ? <X aria-hidden="true" size={16} /> : <Search size={16} />}
                    {isDetecting
                      ? "中止"
                      : getDetectionButtonLabel(detectionPhase, state.entries)}
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={selectedText.trim().length === 0}
                    onClick={openManualDialog}
                    ref={lastSelectionControlRef}
                    title="選択した文字列をマスク対象に追加します"
                    type="button"
                  >
                    選択範囲を追加
                  </button>
                </>
              ) : (
                <button
                  className="button button-primary"
                  disabled={state.originalText.length === 0}
                  onClick={() => void copyMaskedText()}
                  title="マスク結果をクリップボードへコピーします"
                  type="button"
                >
                  <Copy size={16} />
                  コピー
                </button>
              )}
            </div>
          </div>

          <div className="editor-frame">
            {state.activeTextView === "original" ? (
              <div
                aria-label="原文パネル"
                className="text-view-panel"
                id="original-panel"
                role="tabpanel"
              >
                <OriginalTextEditor
                  highlights={originalHighlightSegments}
                  maxLength={MAX_CHAR_COUNT}
                  onChange={handleOriginalTextChange}
                  onHighlightClick={selectEntryFromOriginal}
                  onSelectionChange={setSelectedText}
                  placeholder="個人情報をマスキングしたい日本語テキストを入力または貼り付けてください。"
                  ref={originalEditorRef}
                  selectedEntryId={state.selectedEntryId}
                  value={state.originalText}
                />
              </div>
            ) : (
              <div
                aria-label="マスク結果"
                className="masked-preview"
                id="masked-panel"
                ref={maskedPreviewRef}
                role="tabpanel"
              >
                {state.originalText.length === 0 ? (
                  <span className="muted">マスク結果はここに表示されます。</span>
                ) : (
                  maskedSegments.map((segment, index) =>
                    segment.type === "token" ? (
                      <button
                        data-entry-id={segment.entryId}
                        className="inline-token"
                        key={`${segment.entryId}-${index}`}
                        onClick={() => selectEntryFromMaskedResult(segment.entryId)}
                        title="対応するマスク対象カードへ移動します"
                        type="button"
                      >
                        {segment.value}
                      </button>
                    ) : (
                      <span key={`text-${index}`}>{segment.value}</span>
                    ),
                  )
                )}
              </div>
            )}
          </div>

          <div
            className={
              state.activeTextView === "original"
                ? "workspace-footer is-compact"
                : "workspace-footer"
            }
          >
            {state.activeTextView === "original" ? (
              <span className="mono">
                文字数: {state.originalText.length.toLocaleString("ja-JP")} /{" "}
                {MAX_CHAR_COUNT.toLocaleString("ja-JP")}
              </span>
            ) : (
              <div className="result-summary">
                <p>
                  <Info size={16} />
                  自動検出はすべての個人情報を検出できるとは限りません。コピー前に原文とマスク結果を確認してください。
                </p>
              </div>
            )}
          </div>
        </section>

        <aside
          className="management-panel"
          aria-label="マスク対象管理"
          ref={managementPanelRef}
        >
          <div className="panel-header">
            <strong>マスク対象</strong>
            <div className="panel-header-actions">
              <div className="filter-row" role="group" aria-label="候補フィルター">
                <FilterButton
                  filter="enabled"
                  current={state.entryFilter}
                  onClick={setFilter}
                  title={`有効（${counts.activeEntries}）`}
                >
                  有効（{counts.activeEntries}）
                </FilterButton>
                <FilterButton
                  filter="disabled"
                  current={state.entryFilter}
                  onClick={setFilter}
                  title={`無効（${counts.disabledEntries}）`}
                >
                  無効（{counts.disabledEntries}）
                </FilterButton>
              </div>
              <button
                aria-controls="entry-search"
                aria-expanded={entrySearchOpen}
                aria-label={entrySearchOpen ? "検索を閉じる" : "マスク対象を検索"}
                className={`icon-button panel-search-toggle ${entrySearchOpen ? "is-active" : ""}`}
                onClick={() => {
                  if (entrySearchOpen) {
                    dispatch({ type: "setEntrySearch", value: "" });
                  }
                  setEntrySearchOpen((open) => !open);
                }}
                ref={entrySearchButtonRef}
                title={entrySearchOpen ? "検索を閉じる" : "マスク対象を検索"}
                type="button"
              >
                {entrySearchOpen ? <X size={18} /> : <Search size={18} />}
              </button>
            </div>
          </div>
          <div
            className={`entry-list${entrySearchOpen ? " has-search" : ""}${visibleEntries.length === 0 ? " is-empty" : ""}`}
            ref={entryListRef}
          >
            {entrySearchOpen ? (
              <div className="entry-search-row">
                <label className="search-box" id="entry-search">
                  <Search size={18} />
                  <input
                    aria-label="候補を検索"
                    onChange={(event) =>
                      dispatch({ type: "setEntrySearch", value: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        dispatch({ type: "setEntrySearch", value: "" });
                        setEntrySearchOpen(false);
                        window.requestAnimationFrame(() =>
                          entrySearchButtonRef.current?.focus(),
                        );
                      }
                    }}
                    placeholder="候補を検索..."
                    ref={entrySearchInputRef}
                    type="search"
                    value={state.entrySearch}
                  />
                </label>
              </div>
            ) : null}

            {visibleEntries.length === 0 ? (
              <div className="empty-state">
                {state.entries.length === 0
                  ? "原文でマスク対象が検出、選択されると表示されます。"
                  : state.entryFilter === "disabled"
                  ? "無効なマスク対象はありません。"
                  : state.entryFilter === "enabled"
                    ? "有効なマスク対象はありません。"
                    : "原文でマスク対象が検出、選択されると表示されます。"}
              </div>
            ) : (
              visibleEntries.map((entry) => (
                <EntryCard
                  entry={entry}
                  relatedGroupLabel={
                    entry.relatedGroupId
                      ? relatedGroupLabels.get(entry.relatedGroupId)
                      : undefined
                  }
                  maskingMode={state.occurrenceMaskingMode}
                  maskableOccurrenceCount={selectMaskableOccurrenceCount(state, entry)}
                  relationSelectable={isRelatableEntry(entry)}
                  relationSelected={state.selectedEntryIds.includes(entry.id)}
                  canRelateSelection={canRelateSelectedEntries}
                  relationDisabledReason={relationDisabledReason}
                  isSelected={state.selectedEntryId === entry.id}
                  key={entry.id}
                  onDelete={() => dispatch({ type: "deleteEntry", id: entry.id })}
                  onNavigateToEntry={() => navigateToEntry(entry.id)}
                  onSelect={() => dispatch({ type: "selectEntry", id: entry.id })}
                  onToggleRelationSelection={() =>
                    dispatch({ type: "toggleEntrySelection", id: entry.id })
                  }
                  onRelate={(trigger) => openRelationDialogFromMenu(trigger)}
                  onUnlink={(trigger) =>
                    requestUnlinkRelatedEntry(entry.id, trigger)
                  }
                  onToggle={() =>
                    dispatch({ type: "toggleEntryEnabled", id: entry.id })
                  }
                />
              ))
            )}
          </div>
        </aside>
      </main>

      <section
        className={`restore-dock${
          state.restoreExpanded && restoreInputsExpanded ? " is-maximized" : ""
        }`}
        aria-label="マスクの復元"
        ref={restoreDockRef}
      >
        <div className="restore-header">
          <button
            aria-expanded={state.restoreExpanded}
            className="restore-toggle"
            onClick={toggleRestoreExpanded}
            title={state.restoreExpanded ? "マスク復元欄を閉じる" : "マスク復元欄を開く"}
            type="button"
          >
            <ChevronDown className={state.restoreExpanded ? "is-open" : ""} size={20} />
            マスクを復元
          </button>
          <div className="restore-summary">
            既知: {tokenInspection.knownPresent.length} / 未出現:{" "}
            {tokenInspection.absent.length} / 不明: {tokenInspection.unknown.length}
            {tokenInspection.naturalCandidates?.length ? (
              <> / 要確認: {tokenInspection.naturalCandidates.length}</>
            ) : null}
          </div>
        </div>
        {state.restoreExpanded ? (
          <div
            className={`restore-content${restoreInputsExpanded ? " is-expanded" : ""}`}
            ref={restoreContentRef}
          >
            <label className="restore-field">
              <div className="restore-field-heading">
                <span>マスクを含む文章</span>
                <button
                  aria-label={
                    restoreInputsExpanded ? "入力欄を縮小" : "入力欄を拡大"
                  }
                  className="icon-button restore-expand-button"
                  onClick={toggleRestoreInputsExpanded}
                  title={restoreInputsExpanded ? "入力欄を縮小" : "入力欄を拡大"}
                  type="button"
                >
                  {restoreInputsExpanded ? (
                    <Minimize2 aria-hidden="true" size={17} />
                  ) : (
                    <Maximize2 aria-hidden="true" size={17} />
                  )}
                </button>
              </div>
              <div className="restore-textarea-wrap">
                <textarea
                  aria-label="マスクを含む文章"
                  onChange={(event) =>
                    dispatch({
                      type: "setExternalResponse",
                      value: event.target.value,
                    })
                  }
                  style={restoreTextareaStyle}
                  value={state.externalResponse}
                />
              </div>
            </label>
            <label className="restore-field">
              <div className="restore-field-heading">
                <span>マスクを復元した文章</span>
              </div>
              <div className="restore-textarea-wrap">
                <textarea
                  aria-label="マスクを復元した文章"
                  readOnly
                  style={restoreTextareaStyle}
                  value={restoration}
                />
              </div>
            </label>
          </div>
        ) : null}
      </section>

      {manualDialogOpen ? (
        <ManualAddDialog
          category={manualCategory}
          occurrenceCount={countSelectedOccurrences(state.originalText, selectedText)}
          onCategoryChange={setManualCategory}
          onClose={() => {
            setManualDialogOpen(false);
            lastSelectionControlRef.current?.focus();
          }}
          onSubmit={addManualEntry}
          previewToken={manualPreviewToken}
          selectedText={selectedText}
        />
      ) : null}

      {relationDialogOpen ? (
        <RelateEntriesDialog
          entries={selectedRelationEntries}
          existingGroupOptions={relatedGroupOptions}
          mode={relationMode}
          onClose={() => {
            setRelationDialogOpen(false);
            focusRelationTrigger();
          }}
          onGroupChange={setRelationGroupId}
          onModeChange={setRelationMode}
          onRestorationTextChange={setRelationRestorationText}
          onSubmit={relateEntries}
          selectedGroupId={relationGroupId}
          restorationText={relationRestorationText}
        />
      ) : null}

      {unlinkDialogEntryId ? (
        <UnlinkRelatedDialog
          entry={unlinkDialogEntry}
          onClose={closeUnlinkDialog}
          onSubmit={unlinkRelatedEntry}
        />
      ) : null}

      {copyConfirmOpen ? (
        <ConfirmDialog
          confirmLabel="コピーする"
          onCancel={() => setCopyConfirmOpen(false)}
          onConfirm={() => {
            setCopyConfirmOpen(false);
            void copyMaskedText(true);
          }}
          title="有効なマスク対象がありません"
        >
          マスク結果が原文と同じ可能性があります。内容を確認してからコピーしてください。
        </ConfirmDialog>
      ) : null}

      {clearConfirmOpen ? (
        <ConfirmDialog
          confirmLabel="現在の作業を消去"
          danger
          dangerTitle="現在の画面上の作業を消去します"
          onCancel={() => {
            setClearConfirmOpen(false);
            window.requestAnimationFrame(() =>
              headerMenuButtonRef.current?.focus(),
            );
          }}
          onConfirm={() => {
            abortActiveDetection("session-cleared");
            dispatch({ type: "clearSession" });
            setSelectedText("");
            setEntrySearchOpen(false);
            setClearConfirmOpen(false);
          }}
          title="現在の作業を消去しますか？"
        >
          原文、現在のマスク対象、復元入力など、画面上のインメモリ作業だけを初期化します。保存済みの対応表は削除されません。
        </ConfirmDialog>
      ) : null}

      {mappingSaveOpen ? (
        <MaskMappingSaveDialog
          entries={state.entries}
          existing={state.mapping}
          onClose={() => setMappingSaveOpen(false)}
          onError={(message) => dispatch({ type: "setNotice", value: message })}
          onSaved={handleMappingSaved}
          occurrenceMaskingMode={state.occurrenceMaskingMode}
        />
      ) : null}

      {mappingLibraryOpen ? (
        <MaskMappingLibraryDialog
          onClose={closeMappingLibrary}
          onDeleteAll={requestDeleteAllSavedMappings}
          onError={(message) => dispatch({ type: "setNotice", value: message })}
          onLoaded={handleMappingLoaded}
          refreshKey={mappingLibraryRefreshKey}
        />
      ) : null}

      {pendingLoadedMapping ? (
        <ConfirmDialog
          confirmLabel="対応表を適用"
          onCancel={() => setPendingLoadedMapping(undefined)}
          onConfirm={applyPendingLoadedMapping}
          title="現在のマスク対象を置き換えますか？"
        >
          保存済みの対応表を現在の原文へ適用します。原文、外部回答、保存済み対応表そのものは変更しません。
        </ConfirmDialog>
      ) : null}

      {mappingDeleteAllConfirmOpen ? (
        <ConfirmDialog
          confirmLabel="保存済み対応表をすべて削除"
          danger
          dangerTitle="保存済み対応表をすべて削除します"
          onCancel={() => setMappingDeleteAllConfirmOpen(false)}
          onConfirm={() => void removeAllSavedMappings()}
          title={`保存済み対応表${mappingDeleteAllCount}件をすべて削除しますか？`}
        >
          この操作は取り消せません。現在の作業には影響しません。
        </ConfirmDialog>
      ) : null}

      {normalization.state.open ? (
        <TextNormalizationDialog
          onApply={(result, sourceRevision) =>
            applyNormalization(result.normalizedText, sourceRevision)
          }
          onCancel={() => {
            normalization.close();
            window.requestAnimationFrame(() =>
              normalizationMenuItemRef.current?.focus(),
            );
          }}
          onModeChange={normalization.setMode}
          onRetry={normalization.retry}
          state={normalization.state}
        />
      ) : null}

      <div aria-live="polite" className="toast-region">
        {isDetecting && showDetectionProgress ? (
          <div className="toast toast-progress" role="status">
            <LoaderCircle aria-hidden="true" className="loading-spinner" size={18} />
            AI検出中
          </div>
        ) : state.notice ? (
          <div className="toast">{state.notice}</div>
        ) : null}
      </div>
    </div>
  );

  function setFilter(filter: EntryFilter) {
    dispatch({ type: "setEntryFilter", value: filter });
  }

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  function scrollEntryCard(entryId: string) {
    const entryCard = Array.from(
      entryListRef.current?.querySelectorAll<HTMLElement>(".entry-card") ?? [],
    ).find((card) => card.dataset.entryId === entryId);

    if (!entryCard) {
      return;
    }

    entryCard.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
    });
  }

  function selectEntryFromMaskedResult(entryId: string) {
    selectEntryFromOriginal(entryId);
  }

  function selectEntryFromOriginal(entryId: string) {
    dispatch({ type: "selectEntry", id: entryId });
    scrollEntryCard(entryId);
  }

  function navigateToEntry(entryId: string) {
    const entry = state.entries.find((candidate) => candidate.id === entryId);

    if (!entry || entry.occurrenceCount === 0) {
      return;
    }

    dispatch({ type: "selectEntry", id: entryId });

    if (state.activeTextView === "masked" && entry.enabled && entry.reviewStatus === "approved") {
      const maskedToken = Array.from(
        maskedPreviewRef.current?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? [],
      ).find((element) => element.dataset.entryId === entryId);

      if (maskedToken) {
        maskedToken.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "center",
          inline: "nearest",
        });
        return;
      }
    }

    const occurrence = findOccurrences(state.originalText, entry.originalText)[0];

    if (!occurrence) {
      return;
    }

    if (state.activeTextView !== "original") {
      dispatch({ type: "setActiveTextView", value: "original" });
    }

    window.requestAnimationFrame(() => {
      originalEditorRef.current?.scrollToRange(occurrence);
    });
  }
}

function EntryCard(props: {
  entry: MaskEntry;
  relatedGroupLabel?: string;
  isSelected: boolean;
  maskingMode: OccurrenceMaskingMode;
  maskableOccurrenceCount: number;
  relationSelectable: boolean;
  relationSelected: boolean;
  canRelateSelection: boolean;
  relationDisabledReason: string;
  onDelete: () => void;
  onNavigateToEntry: () => void;
  onSelect: () => void;
  onToggleRelationSelection: () => void;
  onRelate: (trigger: HTMLButtonElement | null) => void;
  onUnlink: (trigger: HTMLButtonElement | null) => void;
  onToggle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [relationTooltipPosition, setRelationTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);
  const isActive = props.entry.enabled;
  const statusLabel = isActive ? "有効" : "無効";
  const statusClass = isActive ? "is-approved" : "is-disabled";
  const confidenceLabel =
    props.entry.confidence !== undefined
      ? `AI検出の信頼度：${Math.round(props.entry.confidence * 100)}%`
      : undefined;
  const confidenceTooltipId = `confidence-tooltip-${props.entry.id}`;
  const normalizationLabels = [
    ...new Set(
      props.entry.normalizationRules?.map(
        (rule) => NORMALIZATION_RULE_LABELS[rule],
      ) ?? [],
    ),
  ];
  const menuId = `entry-menu-${props.entry.id}`;
  const relationTooltipText = props.relationSelectable
    ? "同一人物として関連付ける対象に選択"
    : "有効な人名のマスク対象だけ選択できます";

  function showRelationTooltip(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const tooltipWidth = Math.min(240, Math.max(0, viewportWidth - 32));
    const maxLeft = Math.max(16, viewportWidth - tooltipWidth - 16);
    const left = Math.min(
      Math.max(16, rect.right - tooltipWidth),
      maxLeft,
    );

    setRelationTooltipPosition({
      left,
      top: Math.max(8, rect.bottom + 6),
    });
  }

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    firstMenuItemRef.current?.focus();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRootRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <article
      aria-label={`${props.entry.originalText}、${statusLabel}`}
      className={`entry-card ${statusClass} ${props.isSelected ? "is-selected" : ""} ${props.relationSelected ? "is-relation-selected" : ""}`}
      data-entry-id={props.entry.id}
      onFocus={props.onSelect}
      onMouseDown={props.onSelect}
      tabIndex={0}
    >
      <div className="entry-card-menu" ref={menuRootRef}>
        <button
          aria-controls={menuId}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`${props.entry.originalText}の操作メニュー`}
          className="icon-button entry-card-menu-trigger"
          onClick={() => setMenuOpen((open) => !open)}
          ref={menuButtonRef}
          title="マスク対象の操作メニューを開く"
          type="button"
        >
          <EllipsisVertical aria-hidden="true" size={20} />
        </button>
        {menuOpen ? (
          <div
            aria-label={`${props.entry.originalText}の操作`}
            className="entry-card-menu-popover"
            id={menuId}
            role="menu"
          >
            <button
              className="entry-card-menu-item"
              onClick={() => {
                setMenuOpen(false);
                props.onToggle();
              }}
              ref={firstMenuItemRef}
              role="menuitem"
              type="button"
            >
              {props.entry.enabled ? (
                <EyeOff aria-hidden="true" size={16} />
              ) : (
                <Eye aria-hidden="true" size={16} />
              )}
              {props.entry.enabled ? "無効化" : "有効化"}
            </button>
            {props.relationSelected ? (
              <button
                className="entry-card-menu-item"
                disabled={!props.canRelateSelection}
                onClick={() => {
                  setMenuOpen(false);
                  props.onRelate(menuButtonRef.current);
                }}
                role="menuitem"
                title={
                  props.canRelateSelection
                    ? "選択中の人名を同一人物として関連付けます"
                    : props.relationDisabledReason
                }
                type="button"
              >
                <Link2 aria-hidden="true" size={16} />
                同一人物として関連付け
              </button>
            ) : null}
            {props.entry.relatedGroupId ? (
              <button
                className="entry-card-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  props.onUnlink(menuButtonRef.current);
                }}
                role="menuitem"
                type="button"
              >
                <Link2 aria-hidden="true" size={16} />
                関連付けを解除
              </button>
            ) : null}
            <button
              className="entry-card-menu-item is-danger"
              onClick={() => {
                setMenuOpen(false);
                props.onDelete();
              }}
              role="menuitem"
              type="button"
            >
              <Trash2 aria-hidden="true" size={16} />
              削除
            </button>
          </div>
        ) : null}
      </div>
      <div className="entry-text-row">
        <label
          className="entry-relation-select"
          onClick={(event) => event.stopPropagation()}
          onBlur={() => setRelationTooltipPosition(null)}
          onFocus={(event) => showRelationTooltip(event.currentTarget)}
          onMouseEnter={(event) => showRelationTooltip(event.currentTarget)}
          onMouseLeave={() => setRelationTooltipPosition(null)}
          onMouseDown={(event) => event.stopPropagation()}
          title={
            props.relationSelectable
              ? "同一人物として関連付ける対象に選択"
              : "有効な人名のマスク対象だけ選択できます"
          }
        >
          <input
            aria-label={`${props.entry.originalText}を同一人物として選択`}
            checked={props.relationSelected}
            disabled={!props.relationSelectable}
            onChange={props.onToggleRelationSelection}
            type="checkbox"
          />
          <span
            className={`entry-relation-tooltip${relationTooltipPosition ? " is-visible" : ""}`}
            role="tooltip"
            style={relationTooltipPosition ?? undefined}
          >
            {relationTooltipText}
          </span>
        </label>
        <div className="entry-text">
        <div className="entry-value-line">
          {confidenceLabel ? (
            <span
              aria-describedby={confidenceTooltipId}
              className="entry-value entry-value-with-tooltip"
              tabIndex={0}
            >
              {props.entry.originalText}
              <span
                className="entry-confidence-tooltip"
                id={confidenceTooltipId}
                role="tooltip"
              >
                {confidenceLabel}
              </span>
            </span>
          ) : (
            <span className="entry-value">{props.entry.originalText}</span>
          )}
          <button
            aria-label={`${props.entry.originalText}の最初の出現箇所へ移動`}
            className="icon-button entry-locate-button"
            disabled={props.entry.occurrenceCount === 0}
            onClick={props.onNavigateToEntry}
            title={
              props.entry.occurrenceCount === 0
                ? "現在の原文に存在しません"
                : "本文内の最初の出現箇所へ移動"
            }
            type="button"
          >
            <Link2 aria-hidden="true" size={17} />
          </button>
        </div>
        </div>
      </div>
      <div className="chip-row">
        <span className="chip mono">{props.entry.token}</span>
        <span
          aria-label={
            props.entry.occurrenceCount === 0
              ? "現在の原文に存在しない: 0か所"
              : undefined
          }
          className={`chip ${props.entry.occurrenceCount === 0 ? "chip-warning" : ""}`}
          title={props.entry.occurrenceCount === 0 ? "現在の原文に存在しません" : undefined}
        >
          {props.maskingMode === "contextual_ambiguous_surnames" &&
          props.maskableOccurrenceCount !== props.entry.occurrenceCount
            ? `${props.maskableOccurrenceCount}/${props.entry.occurrenceCount}か所`
            : `${props.entry.occurrenceCount}か所`}
        </span>
        {props.entry.sources.map((source) => (
          <span className="chip" key={source}>
            {SOURCE_LABELS[source]}
          </span>
        ))}
        {normalizationLabels.map((label) => (
          <span className="chip chip-normalization" key={label}>
            {label}
          </span>
        ))}
        {props.entry.relatedGroupId ? (
          <span className="chip chip-related">
            {props.relatedGroupLabel ?? "関連付け"}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function ManualAddDialog(props: {
  category: MaskCategory;
  occurrenceCount: number;
  onCategoryChange: (value: MaskCategory) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  previewToken: string;
  selectedText: string;
}) {
  return (
    <div className="modal-backdrop">
      <form
        aria-labelledby="manual-dialog-title"
        className="modal"
        onSubmit={props.onSubmit}
        role="dialog"
      >
        <div className="modal-header">
          <h2 id="manual-dialog-title">マスク対象に追加</h2>
          <button
            aria-label="閉じる"
            className="icon-button"
            onClick={props.onClose}
            title="ダイアログを閉じます"
            type="button"
          >
            <X size={22} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>対象の文字列</span>
            <input readOnly value={props.selectedText} />
          </label>
          <div className="info-callout">
            <Info size={18} />
            原文内の出現数: {props.occurrenceCount}か所すべてがマスク対象になります。
          </div>
          <label className="field">
            <span>
              カテゴリー選択 <strong aria-hidden="true">*</strong>
            </span>
            <select
              onChange={(event) =>
                props.onCategoryChange(event.target.value as MaskCategory)
              }
              value={props.category}
            >
              {MASK_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>マスク後のプレビュー</span>
            <div className="token-preview">
              <Eye size={18} />
              <span className="mono">{props.previewToken}</span>
              <span>自動生成</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="button button-ghost"
            onClick={props.onClose}
            title="追加をキャンセルします"
            type="button"
          >
            キャンセル
          </button>
          <button className="button button-primary" title="選択した文字列をマスク対象に追加します" type="submit">
            <ShieldCheck size={18} />
            追加してマスク
          </button>
        </div>
      </form>
    </div>
  );
}

function RelateEntriesDialog(props: {
  entries: MaskEntry[];
  existingGroupOptions: RelatedGroupOption[];
  mode: RelationMode;
  onClose: () => void;
  onGroupChange: (value: string) => void;
  onModeChange: (value: RelationMode) => void;
  onRestorationTextChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  selectedGroupId: string;
  restorationText: string;
}) {
  const canCreateNewGroup = props.entries.length >= 2;
  const canAddToExistingGroup = props.existingGroupOptions.length > 0;

  return (
    <div className="modal-backdrop">
      <form
        aria-labelledby="relate-dialog-title"
        className="modal relation-modal"
        onSubmit={props.onSubmit}
        role="dialog"
      >
        <div className="modal-header">
          <h2 id="relate-dialog-title">同一人物として関連付け</h2>
          <button
            aria-label="閉じる"
            className="icon-button"
            onClick={props.onClose}
            title="ダイアログを閉じます"
            type="button"
          >
            <X size={22} />
          </button>
        </div>
        <div className="modal-body">
          <p>
            選択した表記をマスク済み文章内で同じトークンに統一します。復元時は、指定した代表表記へ戻ります。
          </p>
          <div className="relation-entry-list">
            <strong>関連付ける表記</strong>
            <ul>
              {props.entries.map((entry) => (
                <li key={entry.id}>
                  <span>{entry.originalText}</span>
                  <span className="chip mono">{entry.token}</span>
                </li>
              ))}
            </ul>
          </div>
          <fieldset className="relation-mode-fieldset">
            <legend>関連付け方法</legend>
            <label className="relation-mode-option">
              <input
                aria-label="① 新規の関連付け"
                checked={props.mode === "new"}
                disabled={!canCreateNewGroup}
                name="relation-mode"
                onChange={() => props.onModeChange("new")}
                type="radio"
                value="new"
              />
              <span>① 新規の関連付け</span>
            </label>
            <label className="relation-mode-option relation-mode-existing">
              <input
                aria-label="② 既存の関連付けへの追加"
                checked={props.mode === "existing"}
                disabled={!canAddToExistingGroup}
                name="relation-mode"
                onChange={() => props.onModeChange("existing")}
                type="radio"
                value="existing"
              />
              <span>② 既存の関連付けへの追加</span>
              <select
                aria-label="追加先の関連付け"
                disabled={props.mode !== "existing" || !canAddToExistingGroup}
                onChange={(event) => props.onGroupChange(event.target.value)}
                required={props.mode === "existing"}
                value={props.selectedGroupId}
              >
                {props.existingGroupOptions.map((option) => (
                  <option key={option.groupId} value={option.groupId}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          {props.mode === "new" ? (
            <label className="field">
              <span>復元時の代表表記</span>
              <input
                aria-label="復元時の代表表記"
                onChange={(event) => props.onRestorationTextChange(event.target.value)}
                required
                value={props.restorationText}
              />
            </label>
          ) : null}
          <div className="info-callout">
            <Info size={18} />
            {props.mode === "new"
              ? "新しい関連付けでは、復元時の代表表記へ戻します。"
              : "選択した既存の関連付けと同じトークン・復元表記になります。"}
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="button button-ghost"
            onClick={props.onClose}
            title="関連付けをキャンセルします"
            type="button"
          >
            キャンセル
          </button>
          <button
            className="button button-primary"
            disabled={
              props.mode === "existing" && props.selectedGroupId.length === 0
            }
            title="選択した表記を同一人物として関連付けます"
            type="submit"
          >
            <Link2 size={18} />
            関連付ける
          </button>
        </div>
      </form>
    </div>
  );
}

function UnlinkRelatedDialog(props: {
  entry?: MaskEntry;
  onClose: () => void;
  onSubmit: (scope: UnlinkScope) => void;
}) {
  const [scope, setScope] = useState<UnlinkScope>("entry");

  if (!props.entry) {
    return null;
  }

  return (
    <div className="modal-backdrop">
      <form
        aria-labelledby="unlink-related-dialog-title"
        className="modal compact unlink-related-modal"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit(scope);
        }}
        role="dialog"
      >
        <div className="modal-header">
          <h2 id="unlink-related-dialog-title">関連付けを解除</h2>
          <button
            aria-label="閉じる"
            className="icon-button"
            onClick={props.onClose}
            title="ダイアログを閉じます"
            type="button"
          >
            <X size={22} />
          </button>
        </div>
        <div className="modal-body">
          <p>
            「{props.entry.originalText}」は、3件以上のマスクと同一人物として関連付けられています。
          </p>
          <fieldset className="unlink-mode-fieldset">
            <legend>解除方法</legend>
            <label className="unlink-mode-option">
              <input
                aria-label="このマスクのみ解除する"
                checked={scope === "entry"}
                name="unlink-scope"
                onChange={() => setScope("entry")}
                type="radio"
                value="entry"
              />
              <span>
                <strong>このマスクのみ解除する</strong>
                <small>選択したマスクだけを関連付けから外します。</small>
              </span>
            </label>
            <label className="unlink-mode-option">
              <input
                aria-label="同一の関連付けをすべて解除する"
                checked={scope === "group"}
                name="unlink-scope"
                onChange={() => setScope("group")}
                type="radio"
                value="group"
              />
              <span>
                <strong>同一の関連付けをすべて解除する</strong>
                <small>このグループに含まれるすべてのマスクを個別に戻します。</small>
              </span>
            </label>
          </fieldset>
        </div>
        <div className="modal-footer">
          <button
            className="button button-ghost"
            onClick={props.onClose}
            title="関連付けの解除をキャンセルします"
            type="button"
          >
            キャンセル
          </button>
          <button
            className="button button-primary"
            title="選択した方法で関連付けを解除します"
            type="submit"
          >
            <Link2 size={18} />
            関連付けを解除する
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog(props: {
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  dangerTitle?: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useDialogFocus({
    dialogRef,
    initialFocusRef: cancelButtonRef,
    onEscape: props.onCancel,
  });

  return (
    <div className="modal-backdrop">
      <div
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        aria-modal="true"
        className={props.danger ? "modal compact clear-confirm-modal" : "modal compact"}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id="confirm-title">{props.title}</h2>
          <button
            aria-label="閉じる"
            className="icon-button"
            onClick={props.onCancel}
            title="ダイアログを閉じます"
            type="button"
          >
            <X size={22} />
          </button>
        </div>
        <div className="modal-body">
          <p id="confirm-description">{props.children}</p>
        </div>
        <div className="modal-footer">
          <button
            className="button button-ghost"
            onClick={props.onCancel}
            ref={cancelButtonRef}
            title="操作をキャンセルします"
            type="button"
          >
            キャンセル
          </button>
          <button
            className={props.danger ? "button button-danger" : "button button-primary"}
            onClick={props.onConfirm}
            title={props.danger ? props.dangerTitle ?? props.confirmLabel : props.confirmLabel}
            type="button"
          >
            {props.danger ? <Eraser size={18} /> : <Copy size={18} />}
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterButton(props: {
  children: ReactNode;
  current: EntryFilter;
  filter: EntryFilter;
  onClick: (filter: EntryFilter) => void;
  title: string;
}) {
  return (
    <button
      className={props.current === props.filter ? "filter-button is-active" : "filter-button"}
      onClick={() => props.onClick(props.filter)}
      title={props.title}
      type="button"
    >
      {props.children}
    </button>
  );
}

function createEntryId(): string {
  return `entry-${crypto.randomUUID()}`;
}

function createRelatedGroupId(entries: MaskEntry[]): string {
  return `related-${getNextRelatedGroupNumber(entries)}-${crypto.randomUUID()}`;
}

function isRelatableEntry(entry: MaskEntry): boolean {
  return (
    entry.category === "PERSON" &&
    entry.enabled &&
    entry.reviewStatus === "approved" &&
    entry.relatedGroupId === undefined
  );
}

function countSelectedOccurrences(originalText: string, selectedText: string): number {
  return countOccurrences(originalText, selectedText);
}

function toDetectionPhase(progress: NerDetectionProgress): DetectionPhase {
  return progress.phase === "loading" ? "ner-loading" : "ner-running";
}

function getDetectionButtonLabel(
  phase: DetectionPhase,
  entries: MaskEntry[],
): string {
  if (phase === "regex") {
    return "形式確認中";
  }

  if (phase === "ner-loading") {
    return "モデル準備中";
  }

  if (phase === "ner-running") {
    return "AI検出中";
  }

  return entries.some(
    (entry) => entry.sources.includes("regex") || entry.sources.includes("ner"),
  )
    ? "再検出"
    : "自動検出";
}

function formatDetectionNotice(
  candidateCount: number,
  summary: { mergedCount: number; newCount: number },
  nerOutcome: NerDetectionOutcome,
): string {
  if (candidateCount === 0) {
    if (nerOutcome === "failed") {
      return "AI検出に失敗しました。候補は見つかりませんでした。";
    }

    if (nerOutcome === "cancelled") {
      return "AI検出を中止しました。形式検出では候補が見つかりませんでした。";
    }

    return "自動検出では候補が見つかりませんでした。";
  }

  const result = `追加${summary.newCount}件、更新${summary.mergedCount}件。`;

  if (nerOutcome === "failed") {
    return `AI検出に失敗しました。形式検出のみ完了：${result}`;
  }

  if (nerOutcome === "cancelled") {
    return `AI検出を中止しました。形式検出のみ完了：${result}`;
  }

  return `自動検出完了：${result}`;
}

function summarizeDetectionMerge(
  entries: MaskEntry[],
  candidates: DetectionCandidate[],
): { mergedCount: number; newCount: number } {
  const existingTexts = new Set(entries.map((entry) => entry.normalizedText));
  const candidateTexts = new Set(
    candidates
      .map((candidate) => normalizeText(candidate.originalText))
      .filter((value) => value.trim().length > 0),
  );
  let newCount = 0;
  let mergedCount = 0;

  for (const candidateText of candidateTexts) {
    if (existingTexts.has(candidateText)) {
      mergedCount += 1;
    } else {
      newCount += 1;
    }
  }

  return { newCount, mergedCount };
}
