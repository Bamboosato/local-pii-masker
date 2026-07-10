import { describe, expect, it } from "vitest";
import { appReducer, initialAppState } from "./reducer";
import { selectMaskedText, selectSessionCounts } from "./selectors";

describe("appReducer", () => {
  it("手動追加後に同一文字列の全出現を有効なマスク対象にする", () => {
    const withText = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "山田さん、山田です",
    });
    const next = appReducer(withText, {
      type: "addManualEntry",
      value: {
        id: "entry-1",
        selectedText: "山田",
        category: "PERSON",
      },
    });

    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({
      enabled: true,
      occurrenceCount: 2,
      reviewStatus: "approved",
      token: "[人名_1]",
    });
    expect(selectMaskedText(next)).toBe("[人名_1]さん、[人名_1]です");
  });

  it("原文編集後に出現数を再計算し、0件対象も一覧に残す", () => {
    const state = appReducer(
      appReducer(initialAppState, {
        type: "setOriginalText",
        value: "山田さん",
      }),
      {
        type: "addManualEntry",
        value: {
          id: "entry-1",
          selectedText: "山田",
          category: "PERSON",
        },
      },
    );

    const changed = appReducer(state, {
      type: "setOriginalText",
      value: "佐藤さん",
    });

    expect(changed.entries).toHaveLength(1);
    expect(changed.entries[0].occurrenceCount).toBe(0);
    expect(selectSessionCounts(changed).zeroOccurrence).toBe(1);
  });

  it("同一文字列を再追加すると重複作成せず既存項目を更新する", () => {
    const state = appReducer(
      appReducer(initialAppState, {
        type: "setOriginalText",
        value: "山田 山田",
      }),
      {
        type: "addManualEntry",
        value: {
          id: "entry-1",
          selectedText: "山田",
          category: "PERSON",
        },
      },
    );

    const duplicated = appReducer(state, {
      type: "addManualEntry",
      value: {
        id: "entry-2",
        selectedText: "山田",
        category: "ORGANIZATION",
      },
    });

    expect(duplicated.entries).toHaveLength(1);
    expect(duplicated.entries[0].category).toBe("ORGANIZATION");
    expect(duplicated.selectedEntryId).toBe("entry-1");
  });

  it("全消去でセッションデータを初期化する", () => {
    const state = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "山田",
    });

    expect(appReducer(state, { type: "clearSession" })).toEqual(initialAppState);
  });
});
