import type { NormalizationLockReason } from "./reducer";

export type NormalizationAvailability =
  | { state: "enabled" }
  | {
      state: "disabled";
      reason: "empty_source" | "detecting" | "normalizing" | "locked";
    };

export function getNormalizationAvailability(input: {
  originalText: string;
  normalizationLockReason?: NormalizationLockReason;
  isDetecting: boolean;
  isNormalizing: boolean;
}): NormalizationAvailability {
  if (input.originalText.trim().length === 0) {
    return { state: "disabled", reason: "empty_source" };
  }
  if (input.normalizationLockReason !== undefined) {
    return { state: "disabled", reason: "locked" };
  }
  if (input.isDetecting) {
    return { state: "disabled", reason: "detecting" };
  }
  if (input.isNormalizing) {
    return { state: "disabled", reason: "normalizing" };
  }
  return { state: "enabled" };
}

export function getNormalizationTooltipMessage(
  availability: NormalizationAvailability,
): string {
  if (availability.state === "enabled") {
    return "空白・改行・表記を整えます。";
  }
  switch (availability.reason) {
    case "empty_source":
      return "原文を入力してください。";
    case "detecting":
      return "自動検出中は正規化できません。";
    case "normalizing":
      return "正規化中です。";
    case "locked":
      return "検出後は正規化できません。全消去してやり直してください。";
  }
}
