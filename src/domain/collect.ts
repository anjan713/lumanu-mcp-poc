/**
 * Reading a whole collection when a total is what the question needs.
 *
 * Lumanu pages every list at 25 by default, so a summary built from one page is
 * wrong the moment a Workspace holds a twenty-sixth Payable — and wrong
 * quietly, which is worse. Anything that adds up amounts or counts statuses
 * goes through here.
 */

import { LIST_DEFAULTS, type ListQuery } from '@/providers';

/** One page of a Lumanu list, as every list method returns it. */
type Page<Item> = { data?: Item[]; total?: number };

/**
 * A loop over a remote list needs a stop condition that does not depend on the
 * remote end being correct. Without this, a provider reporting a total larger
 * than it serves would spin forever — in Lambda, until the 30-second timeout,
 * with no indication of why.
 */
const MAX_PAGES = 200;

const PAGE_SIZE = LIST_DEFAULTS.limit;

export async function collectAll<Item>(
  fetchPage: (query: ListQuery) => Promise<Page<Item>>,
): Promise<Item[]> {
  const collected: Item[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    const items = result.data ?? [];
    collected.push(...items);

    if (items.length < PAGE_SIZE || collected.length >= (result.total ?? collected.length)) {
      return collected;
    }
  }

  throw new Error(
    `Stopped after ${MAX_PAGES} pages. The provider reported a total it did not serve.`,
  );
}
