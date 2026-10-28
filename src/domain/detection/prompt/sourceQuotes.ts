const QUOTE_LENGTH = 112;
const QUOTE_STEP = 48;
const MAX_QUOTES = 64;

/** Literal source windows only. The whole chunk keeps every possible target representable. */
export function sourceQuoteChoices(text: string, style: "windows" | "sentences" | "sentences-only" = "windows"): string[] {
  if (!text.length) return [];
  const quotes = new Set<string>([text]);
  if (style !== "windows") {
    // Short complete sentences/lines avoid forcing a long repeated quote. Never
    // synthesize a quote or drop the whole-chunk fallback for a spanning target.
    for (const match of text.matchAll(/[^。！？\n]+[。！？\n]*/gu)) {
      if (quotes.size >= MAX_QUOTES) break;
      if (match[0].trim()) quotes.add(match[0]);
    }
    if (style === "sentences-only") return [...quotes].sort((a, b) => a.length - b.length);
  }
  for (let offset = 0; offset < text.length && quotes.size < MAX_QUOTES; offset += QUOTE_STEP) {
    const start = offset > 0 && /[\uDC00-\uDFFF]/u.test(text[offset]) ? offset - 1 : offset;
    let end = Math.min(text.length, start + QUOTE_LENGTH);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    quotes.add(text.slice(start, end));
  }
  return [...quotes].sort((a, b) => a.length - b.length);
}
