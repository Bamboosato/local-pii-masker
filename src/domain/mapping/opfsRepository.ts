import {
  decryptMaskMapping,
  encryptMaskMapping,
} from "./crypto";
import {
  MASK_MAPPING_FORMAT_VERSION,
  type MaskMapping,
  type MaskMappingIndex,
  type MaskMappingIndexEntry,
} from "./types";
import { parseMaskMapping, validateMappingForCurrentMode } from "./validate";

const ROOT_DIRECTORY = "local-pii-masker";
const MAPPINGS_DIRECTORY = "mappings";
const TEMPORARY_DIRECTORY = "temporary";
const INDEX_FILE = "index.json";
const BACKUP_INDEX_FILE = "index.backup.json";
const LOCK_NAME = "local-pii-masker:mapping-storage";

export type MappingListItem = MaskMappingIndexEntry & {
  status: "available" | "missing";
  recovery?: boolean;
};

export type MappingStorageInventory = {
  encryptedFiles: number;
  unreferencedFiles: number;
  temporaryFiles: number;
  recovery: boolean;
  writable: boolean;
};

export class MappingStorageError extends Error {
  constructor(message = "保存済みの対応表を処理できませんでした。") {
    super(message);
    this.name = "MappingStorageError";
  }
}

export class MappingConflictError extends MappingStorageError {
  constructor() {
    super("別のタブで対応表が更新されました。再読み込みまたは名前を付けて保存してください。");
    this.name = "MappingConflictError";
  }
}

export function isMappingStorageSupported(): boolean {
  return typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function";
}

export function isMappingStorageWritable(): boolean {
  return isMappingStorageSupported() && typeof navigator.locks?.request === "function";
}

export async function listMaskMappings(): Promise<MappingListItem[]> {
  return withStorageLock(async () => {
    const root = await getRoot();
    const { index, recovery } = await readIndexState(root);
    const mappings = await root.getDirectoryHandle(MAPPINGS_DIRECTORY, { create: true });
    const result: MappingListItem[] = [];
    for (const entry of index) {
      result.push({
        ...entry,
        status: await hasFile(mappings, entry.fileName) ? "available" : "missing",
        recovery,
      });
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt || a.mappingId.localeCompare(b.mappingId));
  });
}

// Only counts are exposed; ciphertext, targets and temporary contents stay in OPFS.
export async function inspectMappingStorage(): Promise<MappingStorageInventory> {
  return withStorageLock(async () => {
    const root = await getRoot();
    const files = await directoryFileNames(root, MAPPINGS_DIRECTORY);
    const temporary = await directoryFileNames(root, TEMPORARY_DIRECTORY);
    let referenced = new Set<string>();
    let recovery: boolean;
    try {
      const state = await readIndexState(root);
      recovery = state.recovery;
      referenced = new Set(state.index.map((entry) => entry.fileName));
      const backup = await readOptionalIndex(root, BACKUP_INDEX_FILE);
      backup?.forEach((entry) => referenced.add(entry.fileName));
    } catch {
      recovery = true;
    }
    return {
      encryptedFiles: files.length,
      unreferencedFiles: files.filter((name) => !referenced.has(name)).length,
      temporaryFiles: temporary.length,
      recovery,
      writable: isMappingStorageWritable() && !recovery,
    };
  });
}

export async function loadMaskMapping(
  mappingId: string,
  passphrase: string,
): Promise<MaskMapping> {
  return withStorageLock(async () => {
    const root = await getRoot();
    const { index } = await readIndexState(root);
    const item = index.find((entry) => entry.mappingId === mappingId);
    if (!item) {
      throw new MappingStorageError("保存済みの対応表が見つかりません。");
    }
    const mappings = await root.getDirectoryHandle(MAPPINGS_DIRECTORY);
    const file = await mappings.getFileHandle(item.fileName);
    const serialized = await (await file.getFile()).text();
    const mapping = parseMaskMapping(await decryptMaskMapping(serialized, passphrase));
    if (mapping.mappingId !== item.mappingId || mapping.revision !== item.revision) {
      throw new MappingStorageError("対応表と一覧情報が一致しません。");
    }
    return mapping;
  });
}

export async function saveMaskMapping(params: {
  mapping: MaskMapping;
  passphrase: string;
}): Promise<MaskMapping> {
  return withStorageLock(async () => {
    const validatedMapping = parseMaskMapping(params.mapping);
    validateMappingForCurrentMode(validatedMapping);
    const root = await getRoot();
    const index = await readWritableIndex(root);
    const existing = index.find((entry) => entry.mappingId === validatedMapping.mappingId);
    if ((existing && existing.revision !== validatedMapping.revision) || (!existing && validatedMapping.revision !== 0)) {
      throw new MappingConflictError();
    }

    const nextMapping: MaskMapping = {
      ...validatedMapping,
      revision: existing ? existing.revision + 1 : 1,
      updatedAt: Date.now(),
    };
    const serialized = await encryptMaskMapping(nextMapping, params.passphrase);
    const mappings = await root.getDirectoryHandle(MAPPINGS_DIRECTORY, { create: true });
    const temporary = await root.getDirectoryHandle(TEMPORARY_DIRECTORY, { create: true });
    // Never overwrite ciphertext referenced by either committed index.
    const fileName = `${nextMapping.mappingId}@r${nextMapping.revision}.mapping.enc`;
    const temporaryName = `${nextMapping.mappingId}.tmp`;
    await writeTextFile(temporary, temporaryName, serialized);
    const verified = await (await temporary.getFileHandle(temporaryName)).getFile();
    await decryptMaskMapping(await verified.text(), params.passphrase);

    try {
      await writeTextFile(mappings, fileName, serialized);
      if (await readOptionalFile(mappings, fileName) !== serialized) {
        throw new MappingStorageError("保存後の対応表を検証できませんでした。旧対応表は保持しています。");
      }
      const nextIndex = index.filter((entry) => entry.mappingId !== nextMapping.mappingId);
      nextIndex.push({
        mappingId: nextMapping.mappingId,
        name: nextMapping.name,
        createdAt: nextMapping.createdAt,
        updatedAt: nextMapping.updatedAt,
        fileName,
        formatVersion: MASK_MAPPING_FORMAT_VERSION,
        revision: nextMapping.revision,
      });
      await writeIndex(root, nextIndex, index);
      await removeOptionalEntry(temporary, temporaryName);
      return nextMapping;
    } catch (error) {
      // An uncertain commit is inspected on the next read. Do not remove a
      // ciphertext that index.json may already reference, or destroy recovery data.
      throw error instanceof MappingStorageError
        ? error
        : new MappingStorageError();
    }
  }, true);
}

export async function deleteMaskMapping(mappingId: string): Promise<void> {
  return withStorageLock(async () => {
    const root = await getRoot();
    const index = await readWritableIndex(root);
    const item = index.find((entry) => entry.mappingId === mappingId);
    if (!item) {
      return;
    }
    const mappings = await root.getDirectoryHandle(MAPPINGS_DIRECTORY, { create: true });
    try {
      const nextIndex = index.filter((entry) => entry.mappingId !== mappingId);
      // Prune recovery references before removing any ciphertext: a deletion
      // must never be undone by falling back to an older index.
      const backup = await readOptionalIndex(root, BACKUP_INDEX_FILE);
      await writeTextFile(root, BACKUP_INDEX_FILE, JSON.stringify((backup ?? index).filter((entry) => entry.mappingId !== mappingId)));
      for (const name of await directoryFileNames(root, MAPPINGS_DIRECTORY)) {
        if (isMappingFileName(name, mappingId)) {
          await mappings.removeEntry(name);
        }
      }
      const temporary = await optionalDirectory(root, TEMPORARY_DIRECTORY);
      if (temporary) await removeOptionalEntry(temporary, `${mappingId}.tmp`);
      await writeIndex(root, nextIndex, nextIndex);
    } catch (error) {
      throw error instanceof MappingStorageError
        ? error
        : new MappingStorageError("対応表の削除を完了できませんでした。残存データを確認し、再試行してください。");
    }
  }, true);
}

export async function deleteAllMaskMappings(): Promise<void> {
  return withStorageLock(async () => {
    const root = await getRoot();
    try {
      // Invalidate recovery first. Keep the primary index until deletion finishes.
      await removeOptionalEntry(root, BACKUP_INDEX_FILE);
      await removeOptionalEntry(root, MAPPINGS_DIRECTORY, true);
      await removeOptionalEntry(root, TEMPORARY_DIRECTORY, true);
      await removeOptionalEntry(root, INDEX_FILE);
    } catch {
      throw new MappingStorageError("すべての対応表を削除できませんでした。残存データを確認し、再試行してください。");
    }
  }, true);
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isMappingStorageSupported()) {
    throw new MappingStorageError("このブラウザでは対応表の保存を利用できません。");
  }
  return navigator.storage.getDirectory().then((directory) =>
    directory.getDirectoryHandle(ROOT_DIRECTORY, { create: true }),
  );
}

async function readIndexState(root: FileSystemDirectoryHandle): Promise<{ index: MaskMappingIndex; recovery: boolean }> {
  try {
    const index = await readOptionalIndex(root, INDEX_FILE);
    if (index !== undefined) return { index, recovery: false };
  } catch {
    // A corrupt or inaccessible primary index is never treated as an empty store.
    const backup = await readOptionalIndex(root, BACKUP_INDEX_FILE);
    if (backup !== undefined) return { index: backup, recovery: true };
    throw new MappingStorageError("保存済み対応表の一覧を読み込めません。保存データは変更していません。");
  }
  const backup = await readOptionalIndex(root, BACKUP_INDEX_FILE);
  if (backup !== undefined) return { index: backup, recovery: true };
  if ((await directoryFileNames(root, MAPPINGS_DIRECTORY)).length > 0) {
    throw new MappingStorageError("一覧に登録されていない保存データがあります。保存領域を確認してください。");
  }
  return { index: [], recovery: false };
}

async function readWritableIndex(root: FileSystemDirectoryHandle): Promise<MaskMappingIndex> {
  const state = await readIndexState(root);
  if (state.recovery) throw new MappingStorageError("一覧のバックアップを読み込みました。復旧が必要なため保存・個別削除を停止しています。");
  await readOptionalIndex(root, BACKUP_INDEX_FILE);
  return state.index;
}

async function readOptionalIndex(root: FileSystemDirectoryHandle, name: string) {
  const serialized = await readOptionalFile(root, name);
  if (serialized === undefined) return undefined;
  try {
    return validateIndex(JSON.parse(serialized));
  } catch {
    throw new MappingStorageError("保存済み対応表の一覧が破損しています。保存データは変更していません。");
  }
}

async function writeIndex(
  root: FileSystemDirectoryHandle,
  nextIndex: MaskMappingIndex,
  previousIndex: MaskMappingIndex,
): Promise<void> {
  const temporary = await root.getDirectoryHandle(TEMPORARY_DIRECTORY, { create: true });
  const serialized = JSON.stringify(nextIndex);
  await writeTextFile(temporary, "index.tmp", serialized);
  validateIndex(JSON.parse(await (await temporary.getFileHandle("index.tmp")).getFile().then((file) => file.text())));
  await writeTextFile(root, BACKUP_INDEX_FILE, JSON.stringify(previousIndex));
  await writeTextFile(root, INDEX_FILE, serialized);
  await removeOptionalEntry(temporary, "index.tmp");
}

function validateIndex(value: unknown): MaskMappingIndex {
  if (!Array.isArray(value)) {
    throw new MappingStorageError();
  }
  const ids = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new MappingStorageError();
    }
    const candidate = entry as Record<string, unknown>;
    const allowed = ["mappingId", "name", "createdAt", "updatedAt", "fileName", "formatVersion", "revision"];
    if (Object.keys(candidate).some((key) => !allowed.includes(key))) {
      throw new MappingStorageError();
    }
    if (
      typeof candidate.mappingId !== "string" ||
      typeof candidate.name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate.mappingId) ||
      candidate.name.trim().length === 0 ||
      candidate.name.length > 200 ||
      typeof candidate.createdAt !== "number" ||
      typeof candidate.updatedAt !== "number" ||
      typeof candidate.fileName !== "string" ||
      !isMappingFileName(candidate.fileName, candidate.mappingId) ||
      candidate.formatVersion !== MASK_MAPPING_FORMAT_VERSION ||
      typeof candidate.revision !== "number" ||
      !Number.isSafeInteger(candidate.createdAt) ||
      !Number.isSafeInteger(candidate.updatedAt) ||
      candidate.createdAt <= 0 ||
      candidate.updatedAt <= 0 ||
      !Number.isSafeInteger(candidate.revision) ||
      candidate.revision < 1 ||
      (candidate.fileName !== `${candidate.mappingId}.mapping.enc` && candidate.fileName !== `${candidate.mappingId}@r${candidate.revision}.mapping.enc`) ||
      ids.has(candidate.mappingId)
    ) {
      throw new MappingStorageError();
    }
    ids.add(candidate.mappingId);
    return entry as MaskMappingIndexEntry;
  });
}

async function hasFile(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw new MappingStorageError();
  }
}

async function readOptionalFile(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<string | undefined> {
  try {
    return await (await directory.getFileHandle(name).then((handle) => handle.getFile())).text();
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw new MappingStorageError();
  }
}

async function writeTextFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  value: string,
): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(value);
    await writable.close();
  } catch {
    await writable.abort().catch(() => undefined);
    throw new MappingStorageError("保存領域へ書き込めませんでした。空き容量とブラウザの設定を確認してください。");
  }
}

async function withStorageLock<T>(work: () => Promise<T>, write = false): Promise<T> {
  if (typeof navigator !== "undefined" && typeof navigator.locks?.request === "function") {
    return navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, work);
  }
  if (write) throw new MappingStorageError("このブラウザではタブ間の排他制御を利用できないため、対応表は読込専用です。");
  return work();
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

async function removeOptionalEntry(directory: FileSystemDirectoryHandle, name: string, recursive = false) {
  try {
    await directory.removeEntry(name, { recursive });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

async function optionalDirectory(root: FileSystemDirectoryHandle, name: string) {
  try {
    return await root.getDirectoryHandle(name);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw new MappingStorageError();
  }
}

async function directoryFileNames(root: FileSystemDirectoryHandle, name: string): Promise<string[]> {
  const directory = await optionalDirectory(root, name);
  if (!directory) return [];
  const names: string[] = [];
  const iterable = directory as FileSystemDirectoryHandle & {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  };
  for await (const [fileName, handle] of iterable.entries()) {
    if (handle.kind === "file") names.push(fileName);
  }
  return names;
}

function isMappingFileName(name: string, mappingId: string): boolean {
  if (name === `${mappingId}.mapping.enc`) return true;
  const suffix = name.slice(mappingId.length);
  // @ is forbidden in mapping IDs, so versioned names cannot alias a legacy
  // filename owned by another valid ID (e.g. mapping-a.r1).
  return name.startsWith(`${mappingId}@r`) && /^@r[1-9]\d*\.mapping\.enc$/.test(suffix);
}
