import type { MaskEntry } from "../types";

export function restoreText(
  response: string,
  entries: Pick<MaskEntry, "token" | "restorationText">[],
): string {
  return entries.reduce(
    (result, entry) => result.split(entry.token).join(entry.restorationText),
    response,
  );
}
