import { describe, expect, it } from "vitest";
import { appReducer, initialAppState, type AppState } from "./reducer";
import {
  selectMaskedText,
  selectRestoredResponse,
  selectSessionCounts,
  selectVisibleEntries,
} from "./selectors";
import { createMaskMappingSnapshot } from "../domain/mapping/snapshot";

describe("appReducer", () => {
  it("対応表の読込時は原文・外部回答を保持して復元欄を閉じる", () => {
    const state = appReducer({ ...initialAppState, restoreExpanded: true, externalResponse: "合成回答", originalText: "検証太郎" }, {
      type: "addManualEntry", value: { id: "entry-1", selectedText: "検証太郎", category: "PERSON" },
    });
    const mapping = createMaskMappingSnapshot({ mappingId: "mapping-1", name: "合成検証", createdAt: 1, updatedAt: 2, revision: 1, occurrenceMaskingMode: "contextual_ambiguous_surnames", entries: state.entries });
    const loaded = appReducer(state, { type: "loadMaskMapping", mapping });
    expect(loaded.restoreExpanded).toBe(false);
    expect(loaded.originalText).toBe("検証太郎");
    expect(loaded.externalResponse).toBe("合成回答");
    expect(selectRestoredResponse({ ...loaded, externalResponse: loaded.entries[0].token })).toBe("検証太郎");
  });
  it("関連付け前の情報が欠落した状態で解除・推測補正を行わない", () => {
    const state = appReducer({ ...initialAppState, originalText: "検証太郎" }, { type: "addManualEntry", value: { id: "entry-1", selectedText: "検証太郎", category: "PERSON" } });
    state.entries[0] = { ...state.entries[0], relatedGroupId: "legacy" };
    const next = appReducer(state, { type: "unlinkRelatedEntry", id: "entry-1" });
    expect(next.entries).toEqual(state.entries);
    expect(next.notice).toContain("解除できません");
  });
  it("関連付けの保存を拒否し、解除→保存→再読込→復元で各表記を維持する", () => {
    let state = { ...initialAppState, originalText: "検証太郎と検証" };
    for (const [id, selectedText] of [["entry-1", "検証太郎"], ["entry-2", "検証"]]) {
      state = appReducer(state, { type: "addManualEntry", value: { id, selectedText, category: "PERSON" } });
    }
    state = appReducer(state, { type: "relateEntries", ids: ["entry-1", "entry-2"], groupId: "related-1", mode: "new", restorationText: "検証太郎" });
    const snapshot = () => createMaskMappingSnapshot({ mappingId: "mapping-1", name: "合成検証", createdAt: 1, updatedAt: 2, revision: 1, occurrenceMaskingMode: "contextual_ambiguous_surnames", entries: state.entries });
    expect(snapshot).toThrow("関連付け");
    state = appReducer(state, { type: "unlinkRelatedGroup", id: "entry-1" });
    const loaded = appReducer({ ...initialAppState, originalText: state.originalText }, { type: "loadMaskMapping", mapping: JSON.parse(JSON.stringify(snapshot())) });
    expect(new Set(loaded.entries.map((entry) => entry.token)).size).toBe(2);
    expect(selectRestoredResponse({ ...loaded, externalResponse: selectMaskedText(loaded) })).toBe("検証太郎と検証");
  });
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

  it("選択した人名を同一トークンへ関連付け、代表表記へ復元する", () => {
    const withText = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "山田さんと山田太郎さん",
    });
    const withSurname = appReducer(withText, {
      type: "addManualEntry",
      value: {
        id: "entry-1",
        selectedText: "山田",
        category: "PERSON",
      },
    });
    const withFullName = appReducer(withSurname, {
      type: "addManualEntry",
      value: {
        id: "entry-2",
        selectedText: "山田太郎",
        category: "PERSON",
      },
    });
    const related = appReducer(withFullName, {
      type: "relateEntries",
      ids: ["entry-1", "entry-2"],
      groupId: "related-1",
      mode: "new",
      restorationText: "山田太郎",
    });

    expect(related.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entry-1",
          originalText: "山田",
          relatedGroupId: "related-1",
          restorationText: "山田太郎",
          token: "[人名_1]",
        }),
        expect.objectContaining({
          id: "entry-2",
          originalText: "山田太郎",
          relatedGroupId: "related-1",
          restorationText: "山田太郎",
          token: "[人名_1]",
        }),
      ]),
    );
    expect(selectMaskedText(related)).toBe("[人名_1]さんと[人名_1]さん");

    const withResponse = appReducer(related, {
      type: "setExternalResponse",
      value: "[人名_1]さんと[人名_1]さん",
    });

    expect(selectRestoredResponse(withResponse)).toBe(
      "山田太郎さんと山田太郎さん",
    );

    const redetected = appReducer(related, {
      type: "mergeDetectedCandidates",
      candidates: [
        { originalText: "山田", category: "PERSON", source: "ner" },
        { originalText: "山田太郎", category: "PERSON", source: "ner" },
      ],
      createId: () => "unexpected-new-entry",
    });

    expect(redetected.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalText: "山田",
          relatedGroupId: "related-1",
          token: "[人名_1]",
          sources: ["manual", "ner"],
        }),
        expect.objectContaining({
          originalText: "山田太郎",
          relatedGroupId: "related-1",
          token: "[人名_1]",
          sources: ["manual", "ner"],
        }),
      ]),
    );

    const unlinked = appReducer(related, {
      type: "unlinkRelatedEntry",
      id: "entry-2",
    });

    expect(unlinked.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entry-1",
          relatedGroupId: undefined,
          restorationText: "山田",
          token: "[人名_1]",
        }),
        expect.objectContaining({
          id: "entry-2",
          relatedGroupId: undefined,
          restorationText: "山田太郎",
          token: "[人名_2]",
        }),
      ]),
    );

    const disabledGroup = appReducer(related, {
      type: "toggleEntryEnabled",
      id: "entry-1",
    });

    expect(disabledGroup.entries.every((entry) => !entry.enabled)).toBe(true);
  });

  it("3件以上の関連付けでは選択したマスクだけを解除する", () => {
    const withText = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "山田さんと山田太郎さんと田中さん",
    });
    const withSurname = appReducer(withText, {
      type: "addManualEntry",
      value: { id: "entry-1", selectedText: "山田", category: "PERSON" },
    });
    const withFullName = appReducer(withSurname, {
      type: "addManualEntry",
      value: {
        id: "entry-2",
        selectedText: "山田太郎",
        category: "PERSON",
      },
    });
    const withThirdPerson = appReducer(withFullName, {
      type: "addManualEntry",
      value: { id: "entry-3", selectedText: "田中", category: "PERSON" },
    });
    const related = appReducer(withThirdPerson, {
      type: "relateEntries",
      ids: ["entry-1", "entry-2", "entry-3"],
      groupId: "related-1",
      mode: "new",
      restorationText: "山田太郎",
    });

    const unlinked = appReducer(related, {
      type: "unlinkRelatedEntry",
      id: "entry-2",
    });

    expect(unlinked.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entry-1",
          relatedGroupId: "related-1",
          restorationText: "山田太郎",
        }),
        expect.objectContaining({
          id: "entry-2",
          relatedGroupId: undefined,
          restorationText: "山田太郎",
          token: "[人名_2]",
        }),
        expect.objectContaining({
          id: "entry-3",
          relatedGroupId: "related-1",
          restorationText: "山田太郎",
        }),
      ]),
    );
    expect(unlinked.notice).toBe("同一人物の関連付けを解除しました。");
  });

  it("3件以上の関連付けをすべて解除すると各マスクを元に戻す", () => {
    const withText = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "山田さんと山田太郎さんと田中さん",
    });
    const withSurname = appReducer(withText, {
      type: "addManualEntry",
      value: { id: "entry-1", selectedText: "山田", category: "PERSON" },
    });
    const withFullName = appReducer(withSurname, {
      type: "addManualEntry",
      value: {
        id: "entry-2",
        selectedText: "山田太郎",
        category: "PERSON",
      },
    });
    const withThirdPerson = appReducer(withFullName, {
      type: "addManualEntry",
      value: { id: "entry-3", selectedText: "田中", category: "PERSON" },
    });
    const related = appReducer(withThirdPerson, {
      type: "relateEntries",
      ids: ["entry-1", "entry-2", "entry-3"],
      groupId: "related-1",
      mode: "new",
      restorationText: "山田太郎",
    });

    const unlinked = appReducer(related, {
      type: "unlinkRelatedGroup",
      id: "entry-2",
    });

    expect(unlinked.entries.every((entry) => entry.relatedGroupId === undefined)).toBe(
      true,
    );
    expect(unlinked.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entry-1",
          originalText: "山田",
          restorationText: "山田",
        }),
        expect.objectContaining({
          id: "entry-2",
          originalText: "山田太郎",
          restorationText: "山田太郎",
        }),
        expect.objectContaining({
          id: "entry-3",
          originalText: "田中",
          restorationText: "田中",
        }),
      ]),
    );
    expect(new Set(unlinked.entries.map((entry) => entry.token)).size).toBe(3);
    expect(unlinked.notice).toBe("同一人物の関連付けをすべて解除しました。");
  });

  it("1件の人名を既存の関連付けへ追加し、既存のトークンと復元表記を引き継ぐ", () => {
    const withText = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "山田さんと山田太郎さんと田中さん",
    });
    const withSurname = appReducer(withText, {
      type: "addManualEntry",
      value: {
        id: "entry-1",
        selectedText: "山田",
        category: "PERSON",
      },
    });
    const withFullName = appReducer(withSurname, {
      type: "addManualEntry",
      value: {
        id: "entry-2",
        selectedText: "山田太郎",
        category: "PERSON",
      },
    });
    const related = appReducer(withFullName, {
      type: "relateEntries",
      ids: ["entry-1", "entry-2"],
      groupId: "related-1",
      mode: "new",
      restorationText: "山田太郎",
    });
    const withNewPerson = appReducer(related, {
      type: "addManualEntry",
      value: {
        id: "entry-3",
        selectedText: "田中",
        category: "PERSON",
      },
    });

    const next = appReducer(withNewPerson, {
      type: "relateEntries",
      ids: ["entry-3"],
      groupId: "related-1",
      mode: "existing",
    });

    expect(next.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entry-3",
          relatedGroupId: "related-1",
          restorationText: "山田太郎",
          token: "[人名_1]",
          relatedOriginalRestorationText: "田中",
        }),
      ]),
    );
  });

  it("1件の人名を新規の関連付けとして登録しない", () => {
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

    const next = appReducer(state, {
      type: "relateEntries",
      ids: ["entry-1"],
      groupId: "related-1",
      mode: "new",
      restorationText: "山田",
    });

    expect(next.entries).toEqual(state.entries);
    expect(next.notice).toBe("新しい関連付けには2件以上選択してください。");
  });

  it("人名以外や無効な項目は同一人物として関連付けない", () => {
    const state: AppState = {
      ...initialAppState,
      entries: [
        {
          id: "person-1",
          originalText: "山田",
          normalizedText: "山田",
          restorationText: "山田",
          token: "[人名_1]",
          category: "PERSON" as const,
          sources: ["manual"],
          enabled: true,
          occurrenceCount: 1,
          reviewStatus: "approved" as const,
          displayOrder: 0,
        },
        {
          id: "email-1",
          originalText: "yamada@example.com",
          normalizedText: "yamada@example.com",
          restorationText: "yamada@example.com",
          token: "[メール_1]",
          category: "EMAIL" as const,
          sources: ["manual"],
          enabled: true,
          occurrenceCount: 1,
          reviewStatus: "approved" as const,
          displayOrder: 1,
        },
      ],
    };

    const next = appReducer(state, {
      type: "relateEntries",
      ids: ["person-1", "email-1"],
      groupId: "related-1",
      mode: "new",
      restorationText: "山田",
    });

    expect(next.entries).toEqual(state.entries);
    expect(next.notice).toBe("有効な人名のマスク対象だけを関連付けできます。");
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
    expect(second.entryFilter).toBe("enabled");
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

  it("文脈付き出現箇所マスクを固定し、全消去でも維持する", () => {
    const state = appReducer(initialAppState, {
      type: "setOriginalText",
      value: "森さん。森林。",
    });
    const detected = appReducer(state, {
      type: "mergeDetectedCandidates",
      candidates: [
        { originalText: "森", category: "PERSON", source: "regex" },
      ],
      createId: () => "entry-1",
    });

    expect(detected.occurrenceMaskingMode).toBe("contextual_ambiguous_surnames");
    expect(selectMaskedText(detected)).toBe("[人名_1]さん。森林。");
    expect(selectSessionCounts(detected).replacements).toBe(1);
    expect(
      appReducer(detected, { type: "clearSession" }).occurrenceMaskingMode,
    ).toBe("contextual_ambiguous_surnames");
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

  it("保存済み対応表を削除した後は現在の作業を残して新規保存扱いにする", () => {
    const state: AppState = {
      ...initialAppState,
      originalText: "山田",
      mapping: {
        mappingId: "mapping-1",
        name: "既存の対応表",
        createdAt: 1,
        updatedAt: 2,
        revision: 1,
        fingerprint: "fingerprint-1",
      },
    };

    const next = appReducer(state, { type: "clearMaskMappingReference" });

    expect(next.originalText).toBe(state.originalText);
    expect(next.mapping).toBeUndefined();
  });
});

function createSequentialId(): () => string {
  let index = 0;
  return () => `entry-${(index += 1)}`;
}
