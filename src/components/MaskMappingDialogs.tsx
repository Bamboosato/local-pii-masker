import { EllipsisVertical, KeyRound, LoaderCircle, Trash2, X } from "lucide-react";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { createMaskMappingForSave } from "../domain/mapping/create";
import {
  deleteMaskMapping,
  listMaskMappings,
  loadMaskMapping,
  type MappingListItem,
  MappingStorageError,
  saveMaskMapping,
} from "../domain/mapping/opfsRepository";
import type { MaskMapping } from "../domain/mapping/types";
import type { MaskEntry, OccurrenceMaskingMode } from "../domain/types";
import { useDialogFocus } from "./useDialogFocus";

type MappingSaveMode = "overwrite" | "new";

export function MaskMappingSaveDialog(props: {
  entries: MaskEntry[];
  existing?: Pick<MaskMapping, "mappingId" | "name" | "createdAt" | "revision">;
  onClose: () => void;
  onError: (message: string) => void;
  onSaved: (mapping: MaskMapping) => void;
  occurrenceMaskingMode: OccurrenceMaskingMode;
}) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [saveMode, setSaveMode] = useState<MappingSaveMode>(
    props.existing ? "overwrite" : "new",
  );
  const [name, setName] = useState(props.existing?.name ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const isOverwrite = saveMode === "overwrite" && props.existing !== undefined;

  useDialogFocus({
    dialogRef,
    initialFocusRef: nameInputRef,
    onEscape: props.onClose,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.normalize("NFKC").trim();
    const normalizedPassphrase = passphrase.normalize("NFKC");

    if (normalizedName.length === 0 || normalizedName.length > 200) {
      setError("対応表名を入力してください。");
      return;
    }
    if (Array.from(normalizedPassphrase).length < 12) {
      setError("パスフレーズは12文字以上で入力してください。");
      return;
    }
    if (normalizedPassphrase !== confirmation.normalize("NFKC")) {
      setError("パスフレーズが一致しません。");
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const mapping = createMaskMappingForSave({
        existing: isOverwrite ? props.existing : undefined,
        name: normalizedName,
        entries: props.entries,
        occurrenceMaskingMode: props.occurrenceMaskingMode,
      });
      const saved = await saveMaskMapping({ mapping, passphrase: normalizedPassphrase });
      setPassphrase("");
      setConfirmation("");
      props.onSaved(saved);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "対応表を保存できませんでした。";
      setError(message);
      props.onError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form
        aria-labelledby="mapping-save-title"
        aria-modal="true"
        className="modal mapping-modal"
        onSubmit={submit}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id="mapping-save-title">対応表を保存</h2>
          <button aria-label="閉じる" className="icon-button" onClick={props.onClose} type="button">
            <X size={22} />
          </button>
        </div>
        <div className="modal-body">
          <p className="mapping-storage-note">マスク対応表だけを暗号化して保存します。</p>
          {props.existing ? (
            <fieldset className="mapping-save-mode-fieldset">
              <legend>保存方法</legend>
              <label>
                <input
                  checked={isOverwrite}
                  disabled={saving}
                  name="mapping-save-mode"
                  onChange={() => {
                    setSaveMode("overwrite");
                    setError(undefined);
                  }}
                  type="radio"
                  value="overwrite"
                />
                既存の対応表を上書き
              </label>
              <label>
                <input
                  checked={!isOverwrite}
                  disabled={saving}
                  name="mapping-save-mode"
                  onChange={() => {
                    setSaveMode("new");
                    setError(undefined);
                  }}
                  type="radio"
                  value="new"
                />
                新しい対応表として保存
              </label>
            </fieldset>
          ) : null}
          <div className="field mapping-field">
            <label htmlFor="mapping-save-name">対応表名</label>
            <input
              autoFocus
              id="mapping-save-name"
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              ref={nameInputRef}
              value={name}
            />
            <small>対応表名は暗号化されません。氏名、住所などの個人情報を入力しないでください。</small>
          </div>
          <div className="field mapping-field">
            <label htmlFor="mapping-save-passphrase">パスフレーズ（12文字以上）</label>
            <input id="mapping-save-passphrase" autoComplete="new-password" onChange={(event) => setPassphrase(event.target.value)} type="password" value={passphrase} />
          </div>
          {isOverwrite ? <p className="mapping-storage-note">入力したパスフレーズで上書きします。</p> : null}
          <div className="field mapping-field">
            <label htmlFor="mapping-save-confirmation">パスフレーズ（確認）</label>
            <input id="mapping-save-confirmation" autoComplete="new-password" onChange={(event) => setConfirmation(event.target.value)} type="password" value={confirmation} />
          </div>
          {error ? <p className="mapping-error" role="alert">{error}</p> : null}
        </div>
        <div className="modal-footer">
          <button className="button button-ghost" disabled={saving} onClick={props.onClose} type="button">キャンセル</button>
          <button className="button button-primary" disabled={saving} type="submit">
            {saving ? <LoaderCircle className="loading-spinner" size={18} /> : <KeyRound size={18} />}
            {saving ? "保存中…" : isOverwrite ? "上書き保存" : "新規に保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

type PendingMappingDelete = {
  item: MappingListItem;
};

export function MaskMappingLibraryDialog(props: {
  onClose: () => void;
  onDeleteAll: (count: number) => void;
  onDeleted?: (mappingId: string) => void;
  onError: (message: string) => void;
  onLoaded: (mapping: MaskMapping) => void;
  refreshKey: number;
}) {
  const { onClose, onDeleteAll, onDeleted, onError, onLoaded, refreshKey } = props;
  const reportError = useRef(onError);
  useEffect(() => {
    reportError.current = onError;
  }, [onError]);
  const [items, setItems] = useState<MappingListItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [loadedRefreshKey, setLoadedRefreshKey] = useState(-1);
  const [error, setError] = useState<string>();
  const [openItem, setOpenItem] = useState<MappingListItem>();
  const [focusMappingId, setFocusMappingId] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<PendingMappingDelete>();
  const [deleteError, setDeleteError] = useState<string>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);

  async function refresh() {
    setBusy(true);
    try {
      setItems(await listMaskMappings());
      setError(undefined);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存済み対応表を一覧表示できません。";
      setError(message);
      reportError.current(message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    void listMaskMappings()
      .then((nextItems) => {
        if (!disposed) {
          setItems(nextItems);
          setError(undefined);
          setLoadedRefreshKey(refreshKey);
          setBusy(false);
        }
      })
      .catch((cause: unknown) => {
        if (disposed) {
          return;
        }
        const message = cause instanceof Error ? cause.message : "保存済み対応表を一覧表示できません。";
        setError(message);
        reportError.current(message);
        setLoadedRefreshKey(refreshKey);
        setBusy(false);
      });

    return () => {
      disposed = true;
    };
  }, [refreshKey]);

  function requestOpen(item: MappingListItem) {
    if (item.status !== "available") {
      return;
    }
    setFocusMappingId(undefined);
    setOpenItem(item);
  }

  function cancelOpen() {
    if (!openItem) {
      return;
    }
    setFocusMappingId(openItem.mappingId);
    setOpenItem(undefined);
  }

  function requestDelete(item: MappingListItem, trigger: HTMLElement | null) {
    deleteReturnFocusRef.current = trigger;
    setDeleteError(undefined);
    setPendingDelete({ item });
  }

  async function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    const target = pendingDelete;
    setBusy(true);
    setDeleteError(undefined);
    try {
      await deleteMaskMapping(target.item.mappingId);
      onDeleted?.(target.item.mappingId);
      deleteReturnFocusRef.current = closeButtonRef.current;
      setPendingDelete(undefined);
      await refresh();
    } catch (cause) {
      const message = cause instanceof MappingStorageError ? cause.message : "対応表を削除できませんでした。";
      setDeleteError(message);
      reportError.current(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!openItem ? (
        <MaskMappingLibraryView
          busy={busy || loadedRefreshKey !== refreshKey}
          closeButtonRef={closeButtonRef}
          error={error}
          focusMappingId={focusMappingId}
          items={items}
          onClose={onClose}
          onDeleteAll={onDeleteAll}
          onDeleteRequest={requestDelete}
          onFocusHandled={() => setFocusMappingId(undefined)}
          onOpen={requestOpen}
        />
      ) : null}
      {openItem ? (
        <MaskMappingOpenDialog
          item={openItem}
          onCancel={cancelOpen}
          onLoad={(passphrase) => loadMaskMapping(openItem.mappingId, passphrase)}
          onLoaded={onLoaded}
        />
      ) : null}
      {pendingDelete ? (
        <MaskMappingDeleteConfirmDialog
          error={deleteError}
          item={pendingDelete.item}
          onCancel={() => {
            setPendingDelete(undefined);
            setDeleteError(undefined);
          }}
          onConfirm={() => void confirmDelete()}
          returnFocusRef={deleteReturnFocusRef}
          busy={busy}
        />
      ) : null}
    </>
  );
}

function MaskMappingLibraryView(props: {
  busy: boolean;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  error?: string;
  focusMappingId?: string;
  items: MappingListItem[];
  onClose: () => void;
  onDeleteAll: (count: number) => void;
  onDeleteRequest: (item: MappingListItem, trigger: HTMLElement | null) => void;
  onFocusHandled: () => void;
  onOpen: (item: MappingListItem) => void;
}) {
  const {
    busy,
    closeButtonRef,
    error,
    focusMappingId,
    items,
    onClose,
    onDeleteAll,
    onDeleteRequest,
    onFocusHandled,
    onOpen,
  } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const openButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuRootRefs = useRef(new Map<string, HTMLDivElement>());
  const menuItemRef = useRef<HTMLButtonElement>(null);
  const [menuOpenId, setMenuOpenId] = useState<string>();

  useDialogFocus({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  useEffect(() => {
    if (!focusMappingId) {
      return;
    }
    const button = openButtonRefs.current.get(focusMappingId);
    button?.focus();
    onFocusHandled();
  }, [focusMappingId, onFocusHandled]);

  useEffect(() => {
    if (!menuOpenId) {
      return;
    }
    menuItemRef.current?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const root = menuRootRefs.current.get(menuOpenId);
      if (event.target instanceof Node && !root?.contains(event.target)) {
        setMenuOpenId(undefined);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [menuOpenId]);

  function closeMenuOnEscape(event: React.KeyboardEvent) {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const button = menuOpenId ? menuButtonRefs.current.get(menuOpenId) : undefined;
    setMenuOpenId(undefined);
    button?.focus();
  }

  return (
    <div className="modal-backdrop">
      <div
        aria-describedby="mapping-library-description"
        aria-labelledby="mapping-library-title"
        aria-modal="true"
        className="modal mapping-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id="mapping-library-title">保存済み対応表を管理</h2>
          <button aria-label="閉じる" className="icon-button" onClick={onClose} ref={closeButtonRef} type="button"><X size={22} /></button>
        </div>
        <div className="modal-body mapping-library-body">
          <p className="mapping-library-description" id="mapping-library-description">
            対応表を開くと、現在の原文へマスク対応を適用します。
          </p>
          {busy && items.length === 0 ? <p role="status">一覧を読み込んでいます…</p> : null}
          {!busy && items.length === 0 ? <p className="muted">保存済みの対応表はありません。</p> : null}
          {items.length > 0 ? (
            <div className="mapping-list" role="list">
              {items.map((item) => {
                const menuId = `mapping-menu-${item.mappingId}`;
                const isMenuOpen = menuOpenId === item.mappingId;
                return (
                  <div className="mapping-list-item" key={item.mappingId} role="listitem">
                    <div className="mapping-list-details">
                      <strong title={item.name}>{item.name}</strong>
                      <small>
                        {new Date(item.updatedAt).toLocaleString("ja-JP")}
                        {item.status === "missing" ? "・保存データ欠損" : ""}
                      </small>
                    </div>
                    <div className="mapping-list-actions">
                      <button
                        aria-label={`${item.name}を開く`}
                        className="button button-primary mapping-open-button"
                        disabled={busy || item.status !== "available"}
                        onClick={() => onOpen(item)}
                        title={item.status === "available" ? "この対応表を開きます" : "保存データがないため開けません"}
                        type="button"
                        ref={(element) => {
                          if (element) {
                            openButtonRefs.current.set(item.mappingId, element);
                          } else {
                            openButtonRefs.current.delete(item.mappingId);
                          }
                        }}
                      >
                        開く
                      </button>
                      <div className="mapping-row-menu" ref={(element) => {
                        if (element) {
                          menuRootRefs.current.set(item.mappingId, element);
                        } else {
                          menuRootRefs.current.delete(item.mappingId);
                        }
                      }}>
                        <button
                          aria-controls={menuId}
                          aria-expanded={isMenuOpen}
                          aria-haspopup="menu"
                          aria-label={`${item.name}のその他の操作`}
                          className="icon-button mapping-row-menu-trigger"
                          disabled={busy}
                          onClick={() => setMenuOpenId(isMenuOpen ? undefined : item.mappingId)}
                          ref={(element) => {
                            if (element) {
                              menuButtonRefs.current.set(item.mappingId, element);
                            } else {
                              menuButtonRefs.current.delete(item.mappingId);
                            }
                          }}
                          title={`${item.name}のその他の操作`}
                          type="button"
                        >
                          <EllipsisVertical aria-hidden="true" size={20} />
                        </button>
                        {isMenuOpen ? (
                          <div
                            aria-label={`${item.name}のその他の操作`}
                            className="mapping-row-menu-popover"
                            id={menuId}
                            onKeyDown={closeMenuOnEscape}
                            role="menu"
                          >
                            <button
                              className="mapping-row-menu-item is-danger"
                              onClick={() => {
                                const trigger = menuButtonRefs.current.get(item.mappingId) ?? null;
                                setMenuOpenId(undefined);
                                onDeleteRequest(item, trigger);
                              }}
                              ref={menuItemRef}
                              role="menuitem"
                              type="button"
                            >
                              <Trash2 aria-hidden="true" size={16} />
                              対応表を削除
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {items.length > 0 ? (
            <div className="mapping-library-danger-action">
              <button
                className="button button-danger-outline"
                disabled={busy}
                onClick={() => onDeleteAll(items.length)}
                type="button"
              >
                保存済み対応表をすべて削除
              </button>
            </div>
          ) : null}
          {error ? <p className="mapping-error" role="alert">{error}</p> : null}
        </div>
        <div className="modal-footer mapping-library-footer">
          <button className="button button-ghost" onClick={onClose} type="button">閉じる</button>
        </div>
      </div>
    </div>
  );
}

function MaskMappingOpenDialog(props: {
  item: MappingListItem;
  onCancel: () => void;
  onLoad: (passphrase: string) => Promise<MaskMapping>;
  onLoaded: (mapping: MaskMapping) => void;
}) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useDialogFocus({
    dialogRef,
    initialFocusRef: passphraseRef,
    onEscape: props.onCancel,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPassphrase = passphrase.normalize("NFKC");
    if (normalizedPassphrase.length === 0) {
      setError("パスフレーズを入力してください。");
      return;
    }
    if (Array.from(normalizedPassphrase).length < 12) {
      setError("パスフレーズは12文字以上で入力してください。");
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      props.onLoaded(await props.onLoad(normalizedPassphrase));
    } catch {
      const message = "対応表を開けませんでした。パスフレーズを確認してください。";
      setError(message);
      requestAnimationFrame(() => passphraseRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form
        aria-describedby={error ? "mapping-open-description mapping-open-error" : "mapping-open-description"}
        aria-labelledby="mapping-open-title"
        aria-modal="true"
        className="modal compact mapping-open-modal"
        onSubmit={submit}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id="mapping-open-title">対応表を開く</h2>
          <button aria-label="閉じる" className="icon-button" disabled={busy} onClick={props.onCancel} type="button"><X size={22} /></button>
        </div>
        <div className="modal-body">
          <p className="mapping-open-name">{props.item.name}</p>
          <label className="field mapping-field">
            <span>パスフレーズ</span>
            <input
              autoComplete="current-password"
              autoFocus
              disabled={busy}
              onChange={(event) => setPassphrase(event.target.value)}
              ref={passphraseRef}
              type="password"
              value={passphrase}
            />
          </label>
          <p className="mapping-storage-note" id="mapping-open-description">対応表の内容は画面上の現在の原文へ適用されます。</p>
          {error ? <p className="mapping-error" id="mapping-open-error" role="alert">{error}</p> : null}
        </div>
        <div className="modal-footer">
          <button className="button button-ghost" disabled={busy} onClick={props.onCancel} type="button">キャンセル</button>
          <button className="button button-primary" disabled={busy || passphrase.length === 0} type="submit">
            {busy ? <LoaderCircle className="loading-spinner" size={18} /> : <KeyRound size={18} />}
            {busy ? "開いています…" : "対応表を開く"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MaskMappingDeleteConfirmDialog(props: {
  busy: boolean;
  error?: string;
  item: MappingListItem;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useDialogFocus({
    dialogRef,
    initialFocusRef: cancelButtonRef,
    onEscape: props.busy ? () => undefined : props.onCancel,
    returnFocusRef: props.returnFocusRef,
  });

  return (
    <div className="modal-backdrop">
      <form
        aria-describedby={props.error ? "mapping-delete-description mapping-delete-error" : "mapping-delete-description"}
        aria-labelledby="mapping-delete-title"
        aria-modal="true"
        className="modal compact clear-confirm-modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (!props.busy) {
            props.onConfirm();
          }
        }}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id="mapping-delete-title">「{props.item.name}」を削除しますか？</h2>
          <button aria-label="閉じる" className="icon-button" disabled={props.busy} onClick={props.onCancel} type="button"><X size={22} /></button>
        </div>
        <div className="modal-body">
          <p id="mapping-delete-description">この操作は取り消せません。現在の作業には影響しません。</p>
          {props.error ? <p className="mapping-error" id="mapping-delete-error" role="alert">{props.error}</p> : null}
        </div>
        <div className="modal-footer">
          <button className="button button-ghost" disabled={props.busy} onClick={props.onCancel} ref={cancelButtonRef} type="button">キャンセル</button>
          <button className="button button-danger" disabled={props.busy} type="submit">
            {props.busy ? <LoaderCircle className="loading-spinner" size={18} /> : <Trash2 size={18} />}
            {props.busy ? "削除中…" : "削除"}
          </button>
        </div>
      </form>
    </div>
  );
}
