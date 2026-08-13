import type { MaskEntry } from "../types";

export type TokenInspection = {
  knownPresent: string[];
  absent: string[];
  unknown: string[];
  naturalCandidates?: string[];
};

// Do not allow a nested opening bracket so Markdown links such as
// `[[メール_1]](mailto:[メール_1])` are inspected as one known token.
const TOKEN_PATTERN = /\[(?!\[)[^\]\s]+_\d+\]/g;

export function inspectTokens(
  response: string,
  entries: Pick<MaskEntry, "token">[],
  referenceText?: string,
): TokenInspection {
  const knownTokenList = [...new Set(entries.map((entry) => entry.token))];
  const knownTokens = new Set(knownTokenList);
  const responseTokens = new Set(response.match(TOKEN_PATTERN) ?? []);

  const knownPresent = knownTokenList
    .filter((token) => responseTokens.has(token));
  const absent = knownTokenList
    .filter((token) => !responseTokens.has(token));
  const unknown = [...responseTokens].filter((token) => !knownTokens.has(token));

  return {
    knownPresent,
    absent,
    unknown,
    ...(referenceText === undefined
      ? {}
      : {
          naturalCandidates: knownTokenList.filter(
            (token) => countToken(response, token) > countToken(referenceText, token),
          ),
        }),
  };
}

function countToken(text: string, token: string): number {
  return text.split(token).length - 1;
}
