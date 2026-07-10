import type { MaskEntry } from "../types";

export type TokenInspection = {
  knownPresent: string[];
  absent: string[];
  unknown: string[];
};

const TOKEN_PATTERN = /\[[^\]\s]+_\d+\]/g;

export function inspectTokens(
  response: string,
  entries: Pick<MaskEntry, "token">[],
): TokenInspection {
  const knownTokens = new Set(entries.map((entry) => entry.token));
  const responseTokens = new Set(response.match(TOKEN_PATTERN) ?? []);

  const knownPresent = entries
    .map((entry) => entry.token)
    .filter((token) => responseTokens.has(token));
  const absent = entries
    .map((entry) => entry.token)
    .filter((token) => !responseTokens.has(token));
  const unknown = [...responseTokens].filter((token) => !knownTokens.has(token));

  return {
    knownPresent,
    absent,
    unknown,
  };
}
