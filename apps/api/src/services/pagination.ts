/** Cursor pagination (C1): `page[after]=<id>`, `page[size]` (1-100), `links.next`. */
import { DEFAULT_PAGE_SIZE } from '@openverify/contracts';
import { InvalidCursorError, type Page, type PageRequest } from '@openverify/db';
import { BadRequestError } from '../errors.js';

export interface PageQuery {
  'page[after]'?: string | undefined;
  'page[size]'?: number | undefined;
}

/** The repository page request; the contract's default size applies when none is given. */
export function pageRequest(query: PageQuery): PageRequest {
  return { after: query['page[after]'], size: query['page[size]'] ?? DEFAULT_PAGE_SIZE };
}

/** Runs a list query; a cursor that names no record of this list becomes a 400. */
export async function withCursor<T>(list: () => Promise<Page<T>>): Promise<Page<T>> {
  try {
    return await list();
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw new BadRequestError('page[after] does not name a record in this list.');
    }
    throw error;
  }
}

/**
 * `links.next`: the same request for the next page (filters, then `page[after]`, then the
 * requested `page[size]`), or `null` on the last page. Values are percent-encoded.
 */
export function nextLink(
  path: string,
  filters: Readonly<Record<string, string | undefined>>,
  query: PageQuery,
  next: string | null,
): string | null {
  if (next === null) {
    return null;
  }
  const params: [string, string | undefined][] = [
    ...Object.entries(filters),
    ['page[after]', next],
    ['page[size]', query['page[size]']?.toString()],
  ];
  const encoded = params
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return `${path}?${encoded.join('&')}`;
}
