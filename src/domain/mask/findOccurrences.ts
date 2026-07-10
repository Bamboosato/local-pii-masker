import { normalizeText } from "../normalization/normalizeText";

export type TextOccurrence = {
  start: number;
  end: number;
};

export function findOccurrences(text: string, target: string): TextOccurrence[] {
  const normalizedText = normalizeText(text);
  const normalizedTarget = normalizeText(target);

  if (normalizedTarget.length === 0) {
    return [];
  }

  const occurrences: TextOccurrence[] = [];
  let position = 0;

  while (position <= normalizedText.length) {
    const index = normalizedText.indexOf(normalizedTarget, position);

    if (index === -1) {
      break;
    }

    occurrences.push({
      start: index,
      end: index + normalizedTarget.length,
    });
    position = index + normalizedTarget.length;
  }

  return occurrences;
}

export function countOccurrences(text: string, target: string): number {
  return findOccurrences(text, target).length;
}
