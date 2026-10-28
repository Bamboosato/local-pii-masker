import { PROMPT_CONFIG } from "./config";
import { AdditionalDetectionError } from "./validation";
export type PromptChunk = { text: string; start: number };
/** Crop only outer whitespace, retaining the original UTF-16 offset and all inner text. */
export function trimPromptChunks(chunks: readonly PromptChunk[]): PromptChunk[] {
  return chunks.flatMap((chunk) => {
    const text = chunk.text.trim();
    return text ? [{ text, start: chunk.start + chunk.text.length - chunk.text.trimStart().length }] : [];
  });
}
function safeBoundary(text: string, end: number): number {
  return end > 0 && /[\uD800-\uDBFF]/u.test(text[end - 1]) ? end - 1 : end;
}
export function splitPromptText(text: string, length: number = PROMPT_CONFIG.chunkLength, overlap: number = PROMPT_CONFIG.overlap): PromptChunk[] {
  if (text.length > PROMPT_CONFIG.maxInputLength || !Number.isInteger(length) || !Number.isInteger(overlap) || length < 4 || overlap < 0 || overlap >= length - 2) throw new AdditionalDetectionError();
  const chunks: PromptChunk[] = [];
  for (let start = 0; start < text.length;) {
    let end = safeBoundary(text, Math.min(text.length, start + length));
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf("\n", end - 1), text.lastIndexOf("。", end - 1));
      if (boundary >= start + length / 2) end = safeBoundary(text, boundary + 1);
    }
    chunks.push({ start, text: text.slice(start, end) });
    if (end === text.length) break;
    start = Math.max(start + 1, safeBoundary(text, end - overlap));
  }
  return chunks;
}
