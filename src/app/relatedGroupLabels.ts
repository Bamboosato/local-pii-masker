import type { MaskEntry } from "../domain/types";

export function getRelatedGroupLabels(
  entries: ReadonlyArray<Pick<MaskEntry, "relatedGroupId">>,
): Map<string, string> {
  const groupIds = [...new Set(
    entries.flatMap((entry) =>
      entry.relatedGroupId ? [entry.relatedGroupId] : [],
    ),
  )];
  const explicitOrders = new Map<string, number>();
  let maxExplicitOrder = 0;

  for (const groupId of groupIds) {
    const order = parseRelatedGroupOrder(groupId);
    if (order !== undefined) {
      explicitOrders.set(groupId, order);
      maxExplicitOrder = Math.max(maxExplicitOrder, order);
    }
  }

  let nextFallbackOrder = maxExplicitOrder + 1;
  const groupOrders = new Map<string, number>();

  for (const groupId of groupIds) {
    const explicitOrder = explicitOrders.get(groupId);
    if (explicitOrder !== undefined) {
      groupOrders.set(groupId, explicitOrder);
    } else {
      groupOrders.set(groupId, nextFallbackOrder);
      nextFallbackOrder += 1;
    }
  }

  return new Map(
    groupIds.map((groupId) => [
      groupId,
      `関連付け${groupOrders.get(groupId)}`,
    ]),
  );
}

export function getNextRelatedGroupNumber(
  entries: ReadonlyArray<Pick<MaskEntry, "relatedGroupId">>,
): number {
  const groupIds = new Set(
    entries.flatMap((entry) =>
      entry.relatedGroupId ? [entry.relatedGroupId] : [],
    ),
  );
  const maxExplicitOrder = [...groupIds].reduce(
    (maxOrder, groupId) =>
      Math.max(maxOrder, parseRelatedGroupOrder(groupId) ?? 0),
    0,
  );

  return Math.max(maxExplicitOrder, groupIds.size) + 1;
}

function parseRelatedGroupOrder(groupId: string): number | undefined {
  const match = /^related-(\d+)(?:-|$)/.exec(groupId);
  if (!match) {
    return undefined;
  }

  return Number(match[1]);
}
