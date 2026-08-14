/**
 * Counting records by status, which both summaries need and neither owns.
 *
 * The sentinel matters more than it looks. A Partner with no status and a
 * Payable with no status are both legitimate — Lumanu marks the field nullable
 * and a Partner invited but not yet through any check genuinely has none — so
 * the absence is counted under a name rather than dropped. Both callers use the
 * same name for it, because two summaries in one answer that said `none` and
 * `unknown` for the same idea would read as two different findings.
 */

/** The name given to a record whose status is null. */
export const NO_STATUS = 'none';

export interface Group<Item> {
  readonly status: string;
  readonly items: readonly Item[];
}

/**
 * Groups by status, sorted by status name so that a repeated call produces a
 * repeatable answer. Only statuses actually present appear: reporting a zero
 * against every member of Lumanu's enum would put `paid` in front of an agent
 * as though this project produced it.
 */
export function groupByStatus<Item extends { status?: string | null }>(
  items: readonly Item[],
): ReadonlyArray<Group<Item>> {
  const groups = new Map<string, Item[]>();

  for (const item of items) {
    const status = item.status ?? NO_STATUS;
    groups.set(status, [...(groups.get(status) ?? []), item]);
  }

  return [...groups.entries()]
    .map(([status, group]) => ({ status, items: group }))
    .sort((left, right) => left.status.localeCompare(right.status));
}
