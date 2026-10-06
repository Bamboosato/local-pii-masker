import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaskMapping } from "./types";
import { deleteAllMaskMappings, deleteMaskMapping, inspectMappingStorage, listMaskMappings, loadMaskMapping, saveMaskMapping } from "./opfsRepository";

vi.mock("./crypto", () => ({
  encryptMaskMapping: async (mapping: MaskMapping) => JSON.stringify(mapping),
  decryptMaskMapping: async (serialized: string) => JSON.parse(serialized) as unknown,
}));

// Deterministic OPFS fault injection. Individual close operations commit
// atomically; failures and inter-file interruptions are exercised separately.
class Directory {
  kind = "directory";
  files = new Map<string, string>();
  directories = new Map<string, Directory>();
  constructor(readonly path: string, readonly fail: (operation: string, path: string) => void) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    this.fail("directory", `${this.path}/${name}`);
    let directory = this.directories.get(name);
    if (!directory && options?.create) {
      directory = new Directory(`${this.path}/${name}`, this.fail);
      this.directories.set(name, directory);
    }
    if (!directory) throw new DOMException("missing", "NotFoundError");
    return directory;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    const path = `${this.path}/${name}`;
    this.fail("file", path);
    if (!this.files.has(name) && !options?.create) throw new DOMException("missing", "NotFoundError");
    if (!this.files.has(name)) this.files.set(name, "");
    return {
      kind: "file",
      getFile: async () => ({ text: async () => { this.fail("read", path); return this.files.get(name) ?? ""; } }),
      createWritable: async () => {
        let buffer = "";
        return {
          write: async (value: string) => { this.fail("write", path); buffer = value; },
          close: async () => { this.fail("close", path); this.files.set(name, buffer); },
          abort: async () => { this.fail("abort", path); },
        };
      },
    };
  }
  async removeEntry(name: string) {
    this.fail("remove", `${this.path}/${name}`);
    if (!this.files.delete(name) && !this.directories.delete(name)) throw new DOMException("missing", "NotFoundError");
  }
  async *entries() {
    for (const name of this.files.keys()) yield [name, { kind: "file" }] as const;
    for (const [name, directory] of this.directories) yield [name, directory] as const;
  }
}

function mapping(id = "mapping-1"): MaskMapping {
  return {
    schemaVersion: 1, mappingId: id, name: "合成検証", createdAt: 1, updatedAt: 2, revision: 0,
    occurrenceMaskingMode: "contextual_ambiguous_surnames",
    entries: [{ id: "entry-1", targetText: "検証太郎", normalizedTargetText: "検証太郎", token: "[人名_1]", restorationText: "検証太郎", category: "PERSON", sources: ["manual"], manual: true }],
  };
}

describe("OPFS integrity and state transitions", () => {
  const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
  let root: Directory;
  let volume: Directory;
  let fault: (operation: string, path: string) => void;
  beforeEach(async () => {
    fault = () => undefined;
    volume = new Directory("", (operation, path) => fault(operation, path));
    root = await volume.getDirectoryHandle("local-pii-masker", { create: true });
    Object.defineProperty(navigator, "storage", { configurable: true, value: { getDirectory: async () => volume } });
    let queue = Promise.resolve();
    Object.defineProperty(navigator, "locks", { configurable: true, value: {
      request: (_name: string, _options: unknown, work: () => Promise<unknown>) => {
        const result = queue.then(work);
        queue = result.then(() => undefined, () => undefined);
        return result;
      },
    } });
  });
  afterEach(() => {
    for (const [name, descriptor] of [["storage", originalStorage], ["locks", originalLocks]] as const) {
      if (descriptor) Object.defineProperty(navigator, name, descriptor);
      else Reflect.deleteProperty(navigator, name);
    }
  });
  const save = (value = mapping()) => saveMaskMapping({ mapping: value, passphrase: "synthetic-passphrase" });

  it("保存・上書き・再読込が成立し、旧一覧と旧暗号化ファイルを対で保持する", async () => {
    const first = await save();
    const second = await save({ ...first, name: "更新後" });
    expect(second.revision).toBe(2);
    expect(await loadMaskMapping(second.mappingId, "passphrase")).toEqual(second);
    const files = root.directories.get("mappings")!.files;
    expect(files.has("mapping-1@r1.mapping.enc")).toBe(true);
    expect(JSON.parse(root.files.get("index.backup.json")!)[0].fileName).toBe("mapping-1@r1.mapping.enc");
  });
  it("一覧の書込中断でも旧対応表を読め、新ファイルを自動削除しない", async () => {
    const first = await save();
    fault = (op, path) => { if (op === "close" && path.endsWith("/index.json")) throw new DOMException("full", "QuotaExceededError"); };
    await expect(save(first)).rejects.toThrow("書き込めません");
    fault = () => undefined;
    expect(await loadMaskMapping(first.mappingId, "passphrase")).toEqual(first);
    expect((await inspectMappingStorage()).unreferencedFiles).toBe(1);
  });
  it("旧固定ファイル名を読み込み、上書き時も旧暗号化ファイルを保持する", async () => {
    const first = await save();
    const files = root.directories.get("mappings")!.files;
    files.set("mapping-1.mapping.enc", files.get("mapping-1@r1.mapping.enc")!);
    files.delete("mapping-1@r1.mapping.enc");
    const index = JSON.parse(root.files.get("index.json")!);
    index[0].fileName = "mapping-1.mapping.enc";
    root.files.set("index.json", JSON.stringify(index));
    expect(await loadMaskMapping(first.mappingId, "passphrase")).toEqual(first);
    await save(first);
    expect(files.has("mapping-1.mapping.enc")).toBe(true);
    expect(JSON.parse(root.files.get("index.backup.json")!)[0].fileName).toBe("mapping-1.mapping.enc");
  });
  it("破損した主一覧はバックアップと旧ファイルで読込専用にし、自動補正しない", async () => {
    const first = await save();
    await save(first);
    root.files.set("index.json", "broken");
    expect((await listMaskMappings())[0]).toMatchObject({ recovery: true, revision: 1 });
    expect(await loadMaskMapping(first.mappingId, "passphrase")).toEqual(first);
    await expect(save(first)).rejects.toThrow("復旧が必要");
    expect(root.files.get("index.json")).toBe("broken");
  });
  it("両一覧の破損や一覧欠落を空の保存領域と誤判定しない", async () => {
    await save();
    root.files.set("index.json", "broken");
    root.files.set("index.backup.json", "broken");
    await expect(listMaskMappings()).rejects.toThrow("破損");
    root.files.clear();
    await expect(listMaskMappings()).rejects.toThrow("登録されていない");
    expect(await inspectMappingStorage()).toMatchObject({ encryptedFiles: 1, recovery: true, writable: false });
  });
  it("主一覧が正常でも破損バックアップを自動上書きしない", async () => {
    const first = await save();
    root.files.set("index.backup.json", "broken");
    await expect(save(first)).rejects.toThrow("破損");
    expect(root.files.get("index.backup.json")).toBe("broken");
    expect(await loadMaskMapping(first.mappingId, "passphrase")).toEqual(first);
    expect((await inspectMappingStorage()).writable).toBe(false);
  });
  it("アクセス拒否をファイル欠落として扱わない", async () => {
    await save();
    fault = (op, path) => { if (op === "file" && path.endsWith(".mapping.enc")) throw new DOMException("denied", "NotAllowedError"); };
    await expect(listMaskMappings()).rejects.toThrow();
  });
  it("暗号化ファイルの欠落を一覧上で表示する", async () => {
    await save();
    root.directories.get("mappings")!.files.clear();
    expect((await listMaskMappings())[0].status).toBe("missing");
    await expect(loadMaskMapping("mapping-1", "passphrase")).rejects.toThrow();
  });
  it("異なるIDの同時保存で一覧を失わず、同じrevisionの更新は1件だけ成功する", async () => {
    await Promise.all([save(mapping("mapping-a")), save(mapping("mapping-b"))]);
    expect(await listMaskMappings()).toHaveLength(2);
    const first = await loadMaskMapping("mapping-a", "passphrase");
    const results = await Promise.allSettled([save(first), save(first)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
  it("Web Locks未対応時は読込を維持して保存・削除を拒否する", async () => {
    const first = await save();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    expect(await loadMaskMapping(first.mappingId, "passphrase")).toEqual(first);
    await expect(save(first)).rejects.toThrow("読込専用");
    await expect(deleteMaskMapping(first.mappingId)).rejects.toThrow("読込専用");
    await expect(deleteAllMaskMappings()).rejects.toThrow("読込専用");
  });
  it("個別削除は全revisionとバックアップ参照を消し、古いセッションの保存も拒否する", async () => {
    const first = await save();
    await save(first);
    await deleteMaskMapping(first.mappingId);
    expect(await listMaskMappings()).toEqual([]);
    expect(root.directories.get("mappings")!.files.size).toBe(0);
    expect(JSON.parse(root.files.get("index.backup.json")!)).toEqual([]);
    await expect(save(first)).rejects.toThrow("別のタブ");
  });
  it("revisionに似た別IDの旧ファイルを上書き・削除しない", async () => {
    const other = await save(mapping("mapping-a.r1"));
    const files = root.directories.get("mappings")!.files;
    files.set("mapping-a.r1.mapping.enc", files.get("mapping-a.r1@r1.mapping.enc")!);
    files.delete("mapping-a.r1@r1.mapping.enc");
    const index = JSON.parse(root.files.get("index.json")!);
    index[0].fileName = "mapping-a.r1.mapping.enc";
    root.files.set("index.json", JSON.stringify(index));
    await save(mapping("mapping-a"));
    await deleteMaskMapping("mapping-a");
    expect(await loadMaskMapping(other.mappingId, "passphrase")).toEqual(other);
    expect(files.has("mapping-a.r1.mapping.enc")).toBe(true);
  });
  it("削除失敗は成功にせず、残存データを保持して再試行できる", async () => {
    await save();
    fault = (op, path) => { if (op === "remove" && path.endsWith(".mapping.enc")) throw new DOMException("denied", "NotAllowedError"); };
    await expect(deleteMaskMapping("mapping-1")).rejects.toThrow("削除を完了");
    expect((await inspectMappingStorage()).encryptedFiles).toBe(1);
    fault = () => undefined;
    await deleteMaskMapping("mapping-1");
    expect(await listMaskMappings()).toEqual([]);
  });
  it("全件削除でアクセス拒否を握りつぶさず、再試行で領域を削除する", async () => {
    await save();
    fault = (op, path) => { if (op === "remove" && path.endsWith("/mappings")) throw new DOMException("denied", "NotAllowedError"); };
    await expect(deleteAllMaskMappings()).rejects.toThrow("削除できません");
    expect((await inspectMappingStorage()).encryptedFiles).toBe(1);
    fault = () => undefined;
    await deleteAllMaskMappings();
    expect(await inspectMappingStorage()).toMatchObject({ encryptedFiles: 0, temporaryFiles: 0, recovery: false });
  });
});
