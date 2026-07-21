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

export function getNormalizationAvailabilityMessage(
  availability: NormalizationAvailability,
): string | undefined {
  if (availability.state === "enabled") {
    return undefined;
  }
  switch (availability.reason) {
    case "empty_source":
      return "原文を入力してから正規化してください。";
    case "detecting":
      return "自動検出中は正規化できません。検出を完了または中止してください。";
    case "normalizing":
      return "正規化処理中です。";
    case "locked":
      return "マスク対象の検出後は正規化できません。作業内容を消去して原文を貼り付け直してください。";
  }
}
