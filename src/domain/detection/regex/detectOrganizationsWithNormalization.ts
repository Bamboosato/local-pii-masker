import { normalizeForDetection } from "../../normalization/detection/normalizeForDetection";
import { mapNormalizedRange } from "../../normalization/detection/mapNormalizedRange";
import type { DetectionCandidate } from "../mergeCandidates";

const TRAILING_DEPARTMENT_PATTERN =
  /(?:営業|品質|総務|人事|経理|開発|企画|管理|広報|購買|製造|技術|情報システム|サポート)[一-龥々ぁ-ゖァ-ヶー]{0,4}(?:部|課|室|局)$/u;

export function detectOrganizationsWithNormalization(
  sourceText: string,
): DetectionCandidate[] {
  const normalized = normalizeForDetection(sourceText, [
    "organization_line_break",
  ]);

  return normalized.appliedRules
    .filter((event) => event.rule === "organization_line_break")
    .flatMap((event) => {
      const normalizedCandidate = normalized.text.slice(
        event.normalizedStart,
        event.normalizedEnd,
      );
      const trimmedCandidate = normalizedCandidate.replace(
        TRAILING_DEPARTMENT_PATTERN,
        "",
      );
      const normalizedEnd =
        event.normalizedStart + trimmedCandidate.length;
      const originalRange =
        trimmedCandidate !== normalizedCandidate && trimmedCandidate.length > 4
          ? mapNormalizedRange(normalized, {
              start: event.normalizedStart,
              end: normalizedEnd,
            })
          : {
              start: event.originalStart,
              end: event.originalEnd,
            };

      if (!originalRange) {
        return [];
      }

      return [
        {
          originalText: sourceText.slice(originalRange.start, originalRange.end),
          restorationText: trimmedCandidate,
          category: "ORGANIZATION",
          source: "regex",
          start: originalRange.start,
          end: originalRange.end,
          normalizationRules: [event.rule],
        },
      ];
    });
}
