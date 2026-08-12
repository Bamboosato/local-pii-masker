import { describe, expect, it } from "vitest";
import {
  getNextRelatedGroupNumber,
  getRelatedGroupLabels,
} from "./relatedGroupLabels";

describe("getRelatedGroupLabels", () => {
  it("同じグループには同じ番号、別グループには別の番号を付ける", () => {
    const labels = getRelatedGroupLabels([
      { relatedGroupId: "related-2-token" },
      { relatedGroupId: "related-1-token" },
      { relatedGroupId: "related-2-token" },
      { relatedGroupId: undefined },
    ]);

    expect(labels.get("related-1-token")).toBe("関連付け1");
    expect(labels.get("related-2-token")).toBe("関連付け2");
    expect(labels).toHaveProperty("size", 2);
  });

  it("既存の関連付け番号を使い切った次の番号を返す", () => {
    expect(
      getNextRelatedGroupNumber([
        { relatedGroupId: "related-1-token" },
        { relatedGroupId: "related-3-token" },
        { relatedGroupId: "related-1-token" },
      ]),
    ).toBe(4);
  });
});
