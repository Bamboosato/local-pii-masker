import type { MaskEntry } from "../types";

export function restoreText(
  response: string,
  entries: Pick<MaskEntry, "token" | "restorationText">[],
): string {
  return [...entries]
    .sort((a, b) => b.token.length - a.token.length || a.token.localeCompare(b.token, "ja"))
    .reduce(
    (result, entry) => result.split(entry.token).join(entry.restorationText),
    response,
    );
}
