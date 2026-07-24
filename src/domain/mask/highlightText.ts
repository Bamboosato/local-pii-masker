import type {
  MaskEntry,
  OccurrenceMaskingMode,
  ReviewStatus,
} from "../types";
import { normalizeText } from "../normalization/normalizeText";
import { shouldMaskOccurrence } from "./contextualMasking";

type HighlightEntry = Pick<
  MaskEntry,
  "enabled" | "id" | "normalizedText" | "reviewStatus"
  | "category" | "originalText" | "sources"
>;

export type HighlightSegment =
  | { end: number; start: number; type: "text"; value: string }
  | {
      enabled: boolean;
      end: number;
      entryId: string;
      reviewStatus: ReviewStatus;
      start: number;
      type: "highlight";
      value: string;
    };

export function buildHighlightSegments(
  text: string,
  entries: HighlightEntry[],
  mode: OccurrenceMaskingMode = "global",
): HighlightSegment[] {
  const normalizedText = normalizeText(text);
  const sortedEntries = [...entries]
    .filter((entry) => entry.normalizedText.length > 0)
    .sort((a, b) => {
      const lengthDiff = b.normalizedText.length - a.normalizedText.length;

      if (lengthDiff !== 0) {
        return lengthDiff;
      }

      return a.id.localeCompare(b.id, "ja");
    });
  const segments: HighlightSegment[] = [];
  let position = 0;

  while (position < normalizedText.length) {
    const matched = sortedEntries.find((entry) =>
      normalizedText.startsWith(entry.normalizedText, position) &&
      shouldMaskOccurrence({
        text: normalizedText,
        entry,
        start: position,
        end: position + entry.normalizedText.length,
        mode,
      }),
    );

    if (matched) {
      const end = position + matched.normalizedText.length;
      segments.push({
        enabled: matched.enabled,
        end,
        entryId: matched.id,
        reviewStatus: matched.reviewStatus,
        start: position,
        type: "highlight",
        value: normalizedText.slice(position, end),
      });
      position = end;
      continue;
    }

    const codePoint = normalizedText.codePointAt(position);

    if (codePoint === undefined) {
      break;
    }

    const char = String.fromCodePoint(codePoint);
    segments.push({
      end: position + char.length,
      start: position,
      type: "text",
      value: char,
    });
    position += char.length;
  }

  return coalesceTextSegments(segments);
}

function coalesceTextSegments(segments: HighlightSegment[]): HighlightSegment[] {
  return segments.reduce<HighlightSegment[]>((result, segment) => {
    const previous = result.at(-1);

    if (segment.type === "text" && previous?.type === "text") {
      previous.value += segment.value;
      previous.end = segment.end;
      return result;
    }

    result.push({ ...segment });
    return result;
  }, []);
}
