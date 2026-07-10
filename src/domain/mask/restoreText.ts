import type { MaskEntry } from "../types";

export function restoreText(response: string, entries: Pick<MaskEntry, "token" | "originalText">[]): string {
  return entries.reduce(
    (result, entry) => result.split(entry.token).join(entry.originalText),
    response,
  );
}
