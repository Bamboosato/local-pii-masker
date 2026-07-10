import type { MaskEntry } from "../types";
import { normalizeText } from "../normalization/normalizeText";

type ActiveMask = Pick<
  MaskEntry,
  "id" | "originalText" | "normalizedText" | "token" | "enabled" | "reviewStatus"
>;

export type MaskSegment =
  | { type: "text"; value: string }
  | { type: "token"; value: string; entryId: string };

function getActiveMasks(entries: ActiveMask[]): ActiveMask[] {
  return entries
    .filter(
      (entry) =>
        entry.enabled &&
        entry.reviewStatus === "approved" &&
        entry.normalizedText.length > 0,
    )
    .sort((a, b) => {
      const lengthDiff = b.normalizedText.length - a.normalizedText.length;

      if (lengthDiff !== 0) {
        return lengthDiff;
      }

      return a.token.localeCompare(b.token, "ja");
    });
}

export function buildMaskSegments(
  text: string,
  entries: ActiveMask[],
): MaskSegment[] {
  const normalizedText = normalizeText(text);
  const sortedEntries = getActiveMasks(entries);
  const segments: MaskSegment[] = [];
  let position = 0;

  while (position < normalizedText.length) {
    const matched = sortedEntries.find((entry) =>
      normalizedText.startsWith(entry.normalizedText, position),
    );

    if (matched) {
      segments.push({
        type: "token",
        value: matched.token,
        entryId: matched.id,
      });
      position += matched.normalizedText.length;
      continue;
    }

    const codePoint = normalizedText.codePointAt(position);

    if (codePoint === undefined) {
      break;
    }

    const char = String.fromCodePoint(codePoint);
    segments.push({ type: "text", value: char });
    position += char.length;
  }

  return coalesceTextSegments(segments);
}

export function maskText(text: string, entries: ActiveMask[]): string {
  return buildMaskSegments(text, entries)
    .map((segment) => segment.value)
    .join("");
}

function coalesceTextSegments(segments: MaskSegment[]): MaskSegment[] {
  return segments.reduce<MaskSegment[]>((result, segment) => {
    const previous = result.at(-1);

    if (segment.type === "text" && previous?.type === "text") {
      previous.value += segment.value;
      return result;
    }

    result.push({ ...segment });
    return result;
  }, []);
}
