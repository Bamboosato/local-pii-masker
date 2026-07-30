import { describe, expect, it } from "vitest";
import {
  getNormalizationAvailability,
  getNormalizationTooltipMessage,
} from "./normalizationAvailability";

describe("getNormalizationAvailability", () => {
  it("enables normalization before detection", () => {
    expect(
      getNormalizationAvailability({
        originalText: "氏名",
        isDetecting: false,
        isNormalizing: false,
      }),
    ).toEqual({ state: "enabled" });
  });

  it("disables normalization for empty, detecting, and locked states", () => {
    expect(
      getNormalizationAvailability({
        originalText: "",
        isDetecting: false,
        isNormalizing: false,
      }),
    ).toEqual({ state: "disabled", reason: "empty_source" });
    expect(
      getNormalizationAvailability({
        originalText: "氏名",
        isDetecting: true,
        isNormalizing: false,
      }),
    ).toEqual({ state: "disabled", reason: "detecting" });
    expect(
      getNormalizationAvailability({
        originalText: "氏名",
        normalizationLockReason: "detection_completed",
        isDetecting: false,
        isNormalizing: false,
      }),
    ).toEqual({ state: "disabled", reason: "locked" });
  });

  it("returns concise tooltip copy for every availability state", () => {
    expect(getNormalizationTooltipMessage({ state: "enabled" })).toBe(
      "空白・改行・表記を整えます。",
    );
    expect(
      getNormalizationTooltipMessage({ state: "disabled", reason: "empty_source" }),
    ).toBe("原文を入力してください。");
    expect(
      getNormalizationTooltipMessage({ state: "disabled", reason: "detecting" }),
    ).toBe("自動検出中は正規化できません。");
    expect(
      getNormalizationTooltipMessage({ state: "disabled", reason: "normalizing" }),
    ).toBe("正規化中です。");
    expect(
      getNormalizationTooltipMessage({ state: "disabled", reason: "locked" }),
    ).toBe("検出後は正規化できません。全消去してやり直してください。");
  });
});
