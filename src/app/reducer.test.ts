import { describe, expect, it } from "vitest";
import { appReducer, initialAppState } from "./reducer";
import {
  selectMaskedText,
  selectSessionCounts,
  selectVisibleEntries,
} from "./selectors";

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

  it("過去状態の除外項目も有効化すると通常の有効項目へ戻る", () => {
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
    const legacyExcluded = appReducer(state, {
      type: "setEntryReviewStatus",
      id: "entry-1",
      reviewStatus: "excluded",
      enabled: false,
    });

    const restored = appReducer(legacyExcluded, {
      type: "toggleEntryEnabled",
      id: "entry-1",
    });

    expect(restored.entries[0]).toMatchObject({
      enabled: true,
      reviewStatus: "approved",
    });
    expect(selectMaskedText(restored)).toBe("[人名_1]さん");
  });

  it("手動追加した項目は直近追加がマスク対象一覧の先頭に表示される", () => {
    const withText = appReducer(
      appReducer(initialAppState, {
        type: "setOriginalText",
        value: "佐藤さんと山田さん",
      }),
      { type: "setEntryFilter", value: "disabled" },
    );
    const first = appReducer(withText, {
      type: "addManualEntry",
      value: {
        id: "entry-1",
        selectedText: "佐藤",
        category: "PERSON",
      },
    });
    const second = appReducer(first, {
      type: "addManualEntry",
      value: {
        id: "entry-2",
        selectedText: "山田",
        category: "PERSON",
      },
    });

    expect(selectVisibleEntries(second).map((entry) => entry.originalText)).toEqual([
      "山田",
      "佐藤",
    ]);
    expect(second.entryFilter).toBe("all");
  });

  it("形式検出した対象を有効なマスク対象として統合する", () => {
    const state = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "連絡先は yamada@example.com です。",
    });
    const detected = appReducer(state, {
      type: "mergeDetectedCandidates",
      candidates: [
        {
          originalText: "yamada@example.com",
          category: "EMAIL",
          source: "regex",
        },
      ],
      createId: () => "entry-1",
    });

    expect(detected.entries).toHaveLength(1);
    expect(detected.entries[0]).toMatchObject({
      category: "EMAIL",
      sources: ["regex"],
      enabled: true,
      reviewStatus: "approved",
      occurrenceCount: 1,
    });
    expect(selectMaskedText(detected)).toBe("連絡先は [メール_1] です。");
  });

  it("形式検出の再実行では重複作成せず、手動項目の設定を維持して検出元だけ追加する", () => {
    const manual = appReducer(
      appReducer(initialAppState, {
        type: "setOriginalText",
        value: "電話は090-1234-5678です。",
      }),
      {
        type: "addManualEntry",
        value: {
          id: "entry-1",
          selectedText: "090-1234-5678",
          category: "OTHER",
        },
      },
    );
    const detected = appReducer(manual, {
      type: "mergeDetectedCandidates",
      candidates: [
        {
          originalText: "090-1234-5678",
          category: "PHONE",
          source: "regex",
        },
        {
          originalText: "090-1234-5678",
          category: "PHONE",
          source: "regex",
        },
      ],
      createId: () => "entry-2",
    });

    expect(detected.entries).toHaveLength(1);
    expect(detected.entries[0]).toMatchObject({
      category: "OTHER",
      enabled: true,
      reviewStatus: "approved",
      token: "[その他_1]",
      sources: ["manual", "regex"],
    });
  });

  it("形式検出だけの候補は原文内で最初に出現する順に表示される", () => {
    const state = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "電話は090-1234-5678です。メールはyamada@example.comです。",
    });
    const detected = appReducer(state, {
      type: "mergeDetectedCandidates",
      candidates: [
        {
          originalText: "yamada@example.com",
          category: "EMAIL",
          source: "regex",
        },
        {
          originalText: "090-1234-5678",
          category: "PHONE",
          source: "regex",
        },
      ],
      createId: createSequentialId(),
    });

    expect(selectVisibleEntries(detected).map((entry) => entry.originalText)).toEqual([
      "090-1234-5678",
      "yamada@example.com",
    ]);
  });

  it("並び順メタ情報がない既存セッションでも手動項目を形式候補より上に表示する", () => {
    const state = {
      ...initialAppState,
      originalText:
        "佐藤さんの電話は052-351-5006です。山田太郎さんも参加します。",
      entries: [
        {
          id: "manual-1",
          originalText: "佐藤",
          normalizedText: "佐藤",
          token: "[人名_1]",
          category: "PERSON",
          sources: ["manual"],
          enabled: true,
          occurrenceCount: 1,
          reviewStatus: "approved",
        },
        {
          id: "regex-1",
          originalText: "052-351-5006",
          normalizedText: "052-351-5006",
          token: "[電話番号_1]",
          category: "PHONE",
          sources: ["regex"],
          enabled: false,
          occurrenceCount: 1,
          reviewStatus: "unreviewed",
        },
        {
          id: "manual-2",
          originalText: "山田太郎",
          normalizedText: "山田太郎",
          token: "[人名_2]",
          category: "PERSON",
          sources: ["manual"],
          enabled: true,
          occurrenceCount: 1,
          reviewStatus: "approved",
        },
      ],
    } as typeof initialAppState;

    expect(selectVisibleEntries(state).map((entry) => entry.originalText)).toEqual([
      "佐藤",
      "山田太郎",
      "052-351-5006",
    ]);
  });

  it("全消去でセッションデータを初期化する", () => {
    const state = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "山田",
    });

    expect(appReducer(state, { type: "clearSession" })).toEqual(initialAppState);
  });

  it("正規化適用時は新しい原文を正本にして検出前状態を維持する", () => {
    const state = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "氏名：\n山田 太郎",
    });

    const normalized = appReducer(state, {
      type: "applyNormalizedOriginal",
      value: "氏名:山田 太郎",
      expectedRevision: state.originalRevision,
    });

    expect(normalized).toMatchObject({
      originalText: "氏名:山田 太郎",
      entries: [],
      activeTextView: "original",
    });
    expect(normalized.normalizationLockReason).toBeUndefined();
    expect(normalized.originalRevision).toBe(state.originalRevision + 1);
  });

  it("正規化適用は古い原文リビジョンを受け付けない", () => {
    const state = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "山田",
    });

    const stale = appReducer(state, {
      type: "applyNormalizedOriginal",
      value: "佐藤",
      expectedRevision: state.originalRevision - 1,
    });

    expect(stale).toBe(state);
  });

  it("自動検出の候補0件完了でも正規化をロックする", () => {
    const state = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "候補なし",
    });

    const completed = appReducer(state, {
      type: "completeDetection",
      candidates: [],
      createId: () => "unused",
      outcome: "success",
    });

    expect(completed.normalizationLockReason).toBe("detection_completed");
  });

  it("候補なしの検出失敗・中止では正規化ロックを作らない", () => {
    const state = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "候補なし",
    });

    expect(
      appReducer(state, {
        type: "completeDetection",
        candidates: [],
        createId: () => "unused",
        outcome: "failed",
      }).normalizationLockReason,
    ).toBeUndefined();
  });

  it("手動追加後は対象を削除しても正規化ロックを維持する", () => {
    const withEntry = appReducer(
      appReducer(initialAppState, { type: "setOriginalText", value: "山田" }),
      {
        type: "addManualEntry",
        value: { id: "entry-1", selectedText: "山田", category: "PERSON" },
      },
    );
    const deleted = appReducer(withEntry, { type: "deleteEntry", id: "entry-1" });

    expect(deleted.entries).toHaveLength(0);
    expect(deleted.normalizationLockReason).toBe("candidate_registered");
  });
});

function createSequentialId(): () => string {
  let index = 0;
  return () => `entry-${(index += 1)}`;
}
