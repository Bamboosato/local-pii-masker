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

export async function listMaskMappings(): Promise<MappingListItem[]> {
  return withStorageLock(async () => {
    const root = await getRoot();
    const index = await readIndex(root);
    const mappings = await root.getDirectoryHandle(MAPPINGS_DIRECTORY, { create: true });
    const result: MappingListItem[] = [];
    for (const entry of index) {
      result.push({
        ...entry,
        status: await hasFile(mappings, entry.fileName) ? "available" : "missing",
      });
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt || a.mappingId.localeCompare(b.mappingId));
  });
}

export async function loadMaskMapping(
  mappingId: string,
  passphrase: string,
): Promise<MaskMapping> {
  return withStorageLock(async () => {
    const root = await getRoot();
    const index = await readIndex(root);
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
    const index = await readIndex(root);
    const existing = index.find((entry) => entry.mappingId === validatedMapping.mappingId);
    if (existing && existing.revision !== validatedMapping.revision) {
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
    const fileName = `${nextMapping.mappingId}.mapping.enc`;
    const temporaryName = `${nextMapping.mappingId}.tmp`;
    await writeTextFile(temporary, temporaryName, serialized);
    const verified = await (await temporary.getFileHandle(temporaryName)).getFile();
    await decryptMaskMapping(await verified.text(), params.passphrase);

    const oldSerialized = existing
      ? await readOptionalFile(mappings, fileName)
      : undefined;
    try {
      await writeTextFile(mappings, fileName, serialized);
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
      await temporary.removeEntry(temporaryName).catch(() => undefined);
      return nextMapping;
    } catch (error) {
      if (oldSerialized !== undefined) {
        await writeTextFile(mappings, fileName, oldSerialized).catch(() => undefined);
      } else {
        await mappings.removeEntry(fileName).catch(() => undefined);
      }
      throw error instanceof MappingStorageError
        ? error
        : new MappingStorageError();
    }
  });
}

export async function deleteMaskMapping(mappingId: string): Promise<void> {
  return withStorageLock(async () => {
    const root = await getRoot();
    const index = await readIndex(root);
    const item = index.find((entry) => entry.mappingId === mappingId);
    if (!item) {
      return;
    }
    const mappings = await root.getDirectoryHandle(MAPPINGS_DIRECTORY, { create: true });
    const previousSerialized = await readOptionalFile(mappings, item.fileName);
    try {
      if (previousSerialized !== undefined) {
        await mappings.removeEntry(item.fileName);
      }
      await writeIndex(root, index.filter((entry) => entry.mappingId !== mappingId), index);
    } catch (error) {
      if (previousSerialized !== undefined) {
        await writeTextFile(mappings, item.fileName, previousSerialized).catch(() => undefined);
      }
      await writeIndex(root, index, index).catch(() => undefined);
      throw error instanceof MappingStorageError
        ? error
        : new MappingStorageError();
    }
  });
}

export async function deleteAllMaskMappings(): Promise<void> {
  return withStorageLock(async () => {
    const root = await getRoot();
    await root.removeEntry(MAPPINGS_DIRECTORY, { recursive: true }).catch(() => undefined);
    await root.removeEntry(TEMPORARY_DIRECTORY, { recursive: true }).catch(() => undefined);
    await root.removeEntry(INDEX_FILE).catch(() => undefined);
    await root.removeEntry(BACKUP_INDEX_FILE).catch(() => undefined);
  });
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isMappingStorageSupported()) {
    throw new MappingStorageError("このブラウザでは対応表の保存を利用できません。");
  }
  return navigator.storage.getDirectory().then((directory) =>
    directory.getDirectoryHandle(ROOT_DIRECTORY, { create: true }),
  );
}

async function readIndex(root: FileSystemDirectoryHandle): Promise<MaskMappingIndex> {
  const parsed = await readJsonFile(root, INDEX_FILE);
  if (parsed === undefined) {
    const backup = await readJsonFile(root, BACKUP_INDEX_FILE);
    return backup ? validateIndex(backup) : [];
  }
  try {
    return validateIndex(parsed);
  } catch {
    const backup = await readJsonFile(root, BACKUP_INDEX_FILE);
    if (backup === undefined) {
      throw new MappingStorageError("保存済み対応表の一覧を読み込めません。");
    }
    return validateIndex(backup);
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
  if (previousIndex.length > 0) {
    await writeTextFile(root, BACKUP_INDEX_FILE, JSON.stringify(previousIndex));
  }
  await writeTextFile(root, INDEX_FILE, serialized);
  await temporary.removeEntry("index.tmp").catch(() => undefined);
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
      candidate.fileName !== `${candidate.mappingId}.mapping.enc` ||
      candidate.formatVersion !== MASK_MAPPING_FORMAT_VERSION ||
      typeof candidate.revision !== "number" ||
      !Number.isSafeInteger(candidate.createdAt) ||
      !Number.isSafeInteger(candidate.updatedAt) ||
      candidate.createdAt <= 0 ||
      candidate.updatedAt <= 0 ||
      !Number.isSafeInteger(candidate.revision) ||
      candidate.revision < 1 ||
      ids.has(candidate.mappingId)
    ) {
      throw new MappingStorageError();
    }
    ids.add(candidate.mappingId);
    return entry as MaskMappingIndexEntry;
  });
}

async function readJsonFile(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<unknown | undefined> {
  try {
    const handle = await directory.getFileHandle(name);
    return JSON.parse(await (await handle.getFile()).text());
  } catch {
    return undefined;
  }
}

async function hasFile(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalFile(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<string | undefined> {
  try {
    return (await directory.getFileHandle(name).then((handle) => handle.getFile())).text();
  } catch {
    return undefined;
  }
}

async function writeTextFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  value: string,
): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(value);
  await writable.close();
}

async function withStorageLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, work);
  }
  return work();
}
