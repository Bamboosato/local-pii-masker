import { KeyRound, LoaderCircle, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
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

export function MaskMappingSaveDialog(props: {
  entries: MaskEntry[];
  existing?: Pick<MaskMapping, "mappingId" | "name" | "createdAt" | "revision">;
  onClose: () => void;
  onError: (message: string) => void;
  onSaved: (mapping: MaskMapping) => void;
  occurrenceMaskingMode: OccurrenceMaskingMode;
}) {
  const [name, setName] = useState(props.existing?.name ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

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
        existing: props.existing,
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
      <form aria-labelledby="mapping-save-title" className="modal mapping-modal" onSubmit={submit} role="dialog">
        <div className="modal-header">
          <h2 id="mapping-save-title">現在のマスク対応を保存</h2>
          <button aria-label="閉じる" className="icon-button" onClick={props.onClose} type="button">
            <X size={22} />
          </button>
        </div>
        <div className="modal-body">
          <p className="mapping-explanation">
            原文や処理結果は保存されません。マスク対象文字列とマスク文字列の対応関係だけが、暗号化してブラウザ内に保存されます。
          </p>
          <label className="field mapping-field">
            <span>対応表名</span>
            <input autoFocus maxLength={200} onChange={(event) => setName(event.target.value)} value={name} />
            <small>対応表名は暗号化されません。氏名、住所などの個人情報を入力しないでください。</small>
          </label>
          <label className="field mapping-field">
            <span>パスフレーズ（12文字以上）</span>
            <input autoComplete="new-password" onChange={(event) => setPassphrase(event.target.value)} type="password" value={passphrase} />
          </label>
          <label className="field mapping-field">
            <span>パスフレーズ（確認）</span>
            <input autoComplete="new-password" onChange={(event) => setConfirmation(event.target.value)} type="password" value={confirmation} />
          </label>
          <p className="mapping-storage-note">
            AES-GCM 256bit・PBKDF2(SHA-256)・gzipで保存します。鍵とパスフレーズは保存しません。
          </p>
          {error ? <p className="mapping-error" role="alert">{error}</p> : null}
        </div>
        <div className="modal-footer">
          <button className="button button-ghost" onClick={props.onClose} type="button">キャンセル</button>
          <button className="button button-primary" disabled={saving} type="submit">
            {saving ? <LoaderCircle className="loading-spinner" size={18} /> : <KeyRound size={18} />}
            {saving ? "保存中…" : "暗号化して保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function MaskMappingLibraryDialog(props: {
  onClose: () => void;
  onDeleteAll: () => void;
  onError: (message: string) => void;
  onLoaded: (mapping: MaskMapping) => void;
}) {
  const reportError = props.onError;
  const [items, setItems] = useState<MappingListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      setItems(await listMaskMappings());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存済み対応表を一覧表示できません。";
      setError(message);
      props.onError(message);
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
        }
      })
      .catch((cause: unknown) => {
        if (disposed) {
          return;
        }
        const message = cause instanceof Error ? cause.message : "保存済み対応表を一覧表示できません。";
        setError(message);
        reportError(message);
      });

    return () => {
      disposed = true;
    };
  }, [reportError]);

  async function openSelected() {
    if (!selectedId || passphrase.length === 0) {
      setError("対応表とパスフレーズを指定してください。");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      props.onLoaded(await loadMaskMapping(selectedId, passphrase.normalize("NFKC")));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "対応表を開けませんでした。";
      setError(message);
      props.onError(message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selectedId) {
      setError("削除する対応表を選択してください。");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await deleteMaskMapping(selectedId);
      setSelectedId(undefined);
      await refresh();
    } catch (cause) {
      const message = cause instanceof MappingStorageError ? cause.message : "対応表を削除できませんでした。";
      setError(message);
      props.onError(message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div aria-labelledby="mapping-library-title" className="modal mapping-modal" role="dialog">
        <div className="modal-header">
          <h2 id="mapping-library-title">保存済み対応表を管理</h2>
          <button aria-label="閉じる" className="icon-button" onClick={props.onClose} type="button"><X size={22} /></button>
        </div>
        <div className="modal-body mapping-library-body">
          <p className="mapping-explanation">原文や処理結果は復元されません。対応表を開くと、現在の原文へマスク対応だけを適用します。</p>
          {busy && items.length === 0 ? <p>一覧を読み込んでいます…</p> : null}
          {!busy && items.length === 0 ? <p className="muted">保存済みの対応表はありません。</p> : null}
          <div className="mapping-list" role="list">
            {items.map((item) => (
              <label className={`mapping-list-item${selectedId === item.mappingId ? " is-selected" : ""}`} key={item.mappingId}>
                <input checked={selectedId === item.mappingId} name="mapping" onChange={() => setSelectedId(item.mappingId)} type="radio" />
                <span className="mapping-list-details">
                  <strong>{item.name}</strong>
                  <small>{new Date(item.updatedAt).toLocaleString("ja-JP")}・{item.status === "available" ? "利用可能" : "保存データ欠損"}</small>
                </span>
              </label>
            ))}
          </div>
          <label className="field mapping-field">
            <span>パスフレーズ（対応表を開く場合）</span>
            <input autoComplete="current-password" onChange={(event) => setPassphrase(event.target.value)} type="password" value={passphrase} />
          </label>
          {error ? <p className="mapping-error" role="alert">{error}</p> : null}
        </div>
        <div className="modal-footer mapping-library-footer">
          <button className="button button-ghost" onClick={props.onClose} type="button">閉じる</button>
          <button className="button button-danger mapping-delete-all" disabled={busy} onClick={props.onDeleteAll} type="button">
            <Trash2 size={18} /> 保存済み対応表を全削除
          </button>
          <button className="button button-danger" disabled={busy || !selectedId} onClick={() => void deleteSelected()} type="button">
            <Trash2 size={18} /> 対応表を削除
          </button>
          <button className="button button-primary" disabled={busy || !selectedId || items.find((item) => item.mappingId === selectedId)?.status !== "available"} onClick={() => void openSelected()} type="button">
            <KeyRound size={18} /> 対応表を開く
          </button>
        </div>
      </div>
    </div>
  );
}
