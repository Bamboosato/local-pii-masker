import { describe, expect, it } from "vitest";
import {
  getNormalizationAvailability,
  getNormalizationAvailabilityMessage,
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

  it("explains the locked state", () => {
    expect(
      getNormalizationAvailabilityMessage({ state: "disabled", reason: "locked" }),
    ).toContain("作業内容を消去");
  });
});
