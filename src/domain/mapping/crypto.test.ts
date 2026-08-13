import { describe, expect, it } from "vitest";
import { decryptMaskMapping, encryptMaskMapping, PBKDF2_MIN_ITERATIONS } from "./crypto";
import type { MaskMapping } from "./types";

const mapping: MaskMapping = {
  schemaVersion: 1,
  mappingId: "mapping-crypto",
  name: "テスト対応表",
  createdAt: 1,
  updatedAt: 2,
  revision: 1,
  occurrenceMaskingMode: "contextual_ambiguous_surnames",
  entries: [{
    id: "entry-1",
    targetText: "山田太郎",
    normalizedTargetText: "山田太郎",
    token: "[人名_1]",
    restorationText: "山田太郎",
    category: "PERSON",
    sources: ["manual"],
    manual: true,
  }],
};

describe("mask mapping envelope", () => {
  it("JSON→gzip→AES-GCMで暗号化し、同じEnvelopeを復号できる", async () => {
    const serialized = await encryptMaskMapping(mapping, "安全なパスフレーズ123", { iterations: PBKDF2_MIN_ITERATIONS });
    const envelope = JSON.parse(serialized) as Record<string, unknown>;
    expect(envelope.format).toBe("local-pii-masker-mask-mapping");
    expect(envelope.ciphertext).not.toContain("山田太郎");
    expect(envelope.ciphertext).not.toContain("[人名_1]");
    await expect(decryptMaskMapping(serialized, "安全なパスフレーズ123")).resolves.toEqual(mapping);
  });

  it("パスフレーズ不一致とAAD対象ヘッダー改ざんを拒否する", async () => {
    const serialized = await encryptMaskMapping(mapping, "安全なパスフレーズ123", { iterations: PBKDF2_MIN_ITERATIONS });
    await expect(decryptMaskMapping(serialized, "別のパスフレーズ123")).rejects.toThrow();

    const tampered = JSON.parse(serialized) as Record<string, unknown>;
    tampered.iterations = PBKDF2_MIN_ITERATIONS + 10_000;
    await expect(decryptMaskMapping(JSON.stringify(tampered), "安全なパスフレーズ123")).rejects.toThrow();
  });

  it("12文字未満のパスフレーズを拒否する", async () => {
    await expect(encryptMaskMapping(mapping, "短い", { iterations: PBKDF2_MIN_ITERATIONS })).rejects.toThrow("12文字以上");
  });
});
