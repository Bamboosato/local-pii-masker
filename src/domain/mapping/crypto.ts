import {
  MASK_MAPPING_FORMAT,
  MASK_MAPPING_FORMAT_VERSION,
  type MaskMapping,
} from "./types";
import { parseMaskMapping } from "./validate";

export const PBKDF2_MIN_ITERATIONS = 100_000;
export const PBKDF2_MAX_ITERATIONS = 2_000_000;
export const PBKDF2_TARGET_MS = 350;
const AES_KEY_LENGTH = 256;
const GCM_TAG_LENGTH = 128;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

type EnvelopeHeader = {
  format: typeof MASK_MAPPING_FORMAT;
  formatVersion: typeof MASK_MAPPING_FORMAT_VERSION;
  kdf: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  salt: string;
  encryption: "AES-GCM";
  keyLength: typeof AES_KEY_LENGTH;
  iv: string;
  tagLength: typeof GCM_TAG_LENGTH;
  compression: "gzip";
};

export type MaskMappingEnvelope = EnvelopeHeader & {
  ciphertext: string;
};

export class MaskMappingCryptoError extends Error {
  constructor(message = "マスク対応表を処理できませんでした。") {
    super(message);
    this.name = "MaskMappingCryptoError";
  }
}

export async function encryptMaskMapping(
  mapping: MaskMapping,
  passphrase: string,
  options: { iterations?: number } = {},
): Promise<string> {
  const normalizedPassphrase = normalizePassphrase(passphrase);
  const iterations = options.iterations ?? await calibratePbkdf2Iterations();
  assertIterations(iterations);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const header: EnvelopeHeader = {
    format: MASK_MAPPING_FORMAT,
    formatVersion: MASK_MAPPING_FORMAT_VERSION,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations,
    salt: bytesToBase64(salt),
    encryption: "AES-GCM",
    keyLength: AES_KEY_LENGTH,
    iv: bytesToBase64(iv),
    tagLength: GCM_TAG_LENGTH,
    compression: "gzip",
  };
  const key = await deriveKey(normalizedPassphrase, salt, iterations);
  const compressed = await gzipEncode(new TextEncoder().encode(JSON.stringify(mapping)));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(iv),
      additionalData: asBufferSource(new TextEncoder().encode(canonicalJson(header))),
      tagLength: GCM_TAG_LENGTH,
    },
    key,
    asBufferSource(compressed),
  );

  return JSON.stringify({ ...header, ciphertext: bytesToBase64(new Uint8Array(ciphertext)) });
}

export async function decryptMaskMapping(
  serializedEnvelope: string,
  passphrase: string,
): Promise<MaskMapping> {
  try {
    const parsed: unknown = JSON.parse(serializedEnvelope);
    const header = parseHeader(parsed);
    const normalizedPassphrase = normalizePassphrase(passphrase);
    const salt = base64ToBytes(header.salt);
    const iv = base64ToBytes(header.iv);
    const ciphertext = base64ToBytes(readCiphertext(parsed));
    const key = await deriveKey(normalizedPassphrase, salt, header.iterations);
    const compressed = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(iv),
        additionalData: asBufferSource(new TextEncoder().encode(canonicalJson(header))),
        tagLength: header.tagLength,
      },
      key,
      asBufferSource(ciphertext),
    );
    const json = await gzipDecode(new Uint8Array(compressed));
    return parseMaskMapping(JSON.parse(new TextDecoder().decode(json)));
  } catch (error) {
    if (error instanceof MaskMappingCryptoError) {
      throw error;
    }
    throw new MaskMappingCryptoError(
      "パスフレーズが違うか、対応表が破損しています。",
    );
  }
}

export async function calibratePbkdf2Iterations(): Promise<number> {
  const probeIterations = PBKDF2_MIN_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const startedAt = performance.now();
  await deriveKey("local-pii-masker-calibration", salt, probeIterations);
  const elapsedMs = Math.max(1, performance.now() - startedAt);
  const estimate = Math.round((probeIterations * PBKDF2_TARGET_MS) / elapsedMs);
  const rounded = Math.round(estimate / 10_000) * 10_000;
  return Math.min(PBKDF2_MAX_ITERATIONS, Math.max(PBKDF2_MIN_ITERATIONS, rounded));
}

export function normalizePassphrase(passphrase: string): string {
  const normalized = passphrase.normalize("NFKC");
  if (Array.from(normalized).length < 12) {
    throw new MaskMappingCryptoError("パスフレーズは12文字以上で入力してください。");
  }
  return normalized;
}

function parseHeader(value: unknown): EnvelopeHeader {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MaskMappingCryptoError();
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.format !== MASK_MAPPING_FORMAT ||
    candidate.formatVersion !== MASK_MAPPING_FORMAT_VERSION ||
    candidate.kdf !== "PBKDF2" ||
    candidate.hash !== "SHA-256" ||
    candidate.encryption !== "AES-GCM" ||
    candidate.keyLength !== AES_KEY_LENGTH ||
    candidate.tagLength !== GCM_TAG_LENGTH ||
    candidate.compression !== "gzip" ||
    typeof candidate.iterations !== "number" ||
    !Number.isSafeInteger(candidate.iterations)
  ) {
    throw new MaskMappingCryptoError("暗号化ファイルの形式に対応していません。");
  }
  assertIterations(candidate.iterations);
  const salt = readEncodedBytes(candidate.salt, SALT_LENGTH);
  const iv = readEncodedBytes(candidate.iv, IV_LENGTH);
  return {
    format: MASK_MAPPING_FORMAT,
    formatVersion: MASK_MAPPING_FORMAT_VERSION,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: candidate.iterations,
    salt: bytesToBase64(salt),
    encryption: "AES-GCM",
    keyLength: AES_KEY_LENGTH,
    iv: bytesToBase64(iv),
    tagLength: GCM_TAG_LENGTH,
    compression: "gzip",
  };
}

function readCiphertext(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MaskMappingCryptoError();
  }
  const ciphertext = (value as Record<string, unknown>).ciphertext;
  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    throw new MaskMappingCryptoError();
  }
  return ciphertext;
}

function assertIterations(iterations: number): void {
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < PBKDF2_MIN_ITERATIONS ||
    iterations > PBKDF2_MAX_ITERATIONS
  ) {
    throw new MaskMappingCryptoError("暗号化ファイルの反復回数が許容範囲外です。");
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    asBufferSource(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: asBufferSource(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

async function gzipEncode(value: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new MaskMappingCryptoError("このブラウザはgzip圧縮に対応していません。");
  }
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const output = new Response(stream.readable).arrayBuffer();
  await writer.write(toArrayBufferBytes(value));
  await writer.close();
  return new Uint8Array(await output);
}

async function gzipDecode(value: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new MaskMappingCryptoError("このブラウザはgzip展開に対応していません。");
  }
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const output = new Response(stream.readable).arrayBuffer();
  await writer.write(toArrayBufferBytes(value));
  await writer.close();
  return new Uint8Array(await output);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new MaskMappingCryptoError("暗号化ファイルの形式が不正です。");
  }
}

function readEncodedBytes(value: unknown, expectedLength: number): Uint8Array {
  if (typeof value !== "string") {
    throw new MaskMappingCryptoError();
  }
  const bytes = base64ToBytes(value);
  if (bytes.length !== expectedLength) {
    throw new MaskMappingCryptoError("暗号化ファイルのパラメータが不正です。");
  }
  return bytes;
}

function asBufferSource(value: Uint8Array): BufferSource {
  return value as unknown as BufferSource;
}

function toArrayBufferBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}
