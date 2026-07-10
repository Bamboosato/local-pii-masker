import { CATEGORY_LABELS, type MaskCategory, type MaskEntry } from "../types";

export type TokenContext = {
  originalText: string;
  entries: Pick<MaskEntry, "token">[];
};

export function createMaskToken(
  category: MaskCategory,
  context: TokenContext,
): string {
  const label = CATEGORY_LABELS[category];
  const usedTokens = new Set(context.entries.map((entry) => entry.token));
  let index = 1;

  while (true) {
    const candidate = `[${label}_${index}]`;

    if (!usedTokens.has(candidate) && !context.originalText.includes(candidate)) {
      return candidate;
    }

    index += 1;
  }
}

export function isMaskToken(value: string): boolean {
  return /^\[[^\]\s]+_\d+\]$/.test(value);
}
