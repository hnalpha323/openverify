/**
 * Lists keep their filters and cursor in the URL query (C23), so a filtered page can be
 * bookmarked, shared and reloaded, and filter forms work as plain GET forms.
 */
import { idSchema, type IdPrefix } from '@openverify/contracts';

export type ListQueryValue = string | readonly string[] | undefined;

/** `path` with its query; empty values are left out, several values repeat the key. */
export function listHref(path: string, query: Readonly<Record<string, ListQueryValue>>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    for (const item of typeof value === 'string' ? [value] : (value ?? [])) {
      if (item !== '') {
        params.append(name, item);
      }
    }
  }
  const search = params.toString();
  return search === '' ? path : `${path}?${search}`;
}

/** A page cursor from the URL: a well-formed ID of the list's resource, else `undefined`. */
export function parseCursor(value: unknown, prefix: IdPrefix): string | undefined {
  return typeof value === 'string' && idSchema(prefix).safeParse(value).success ? value : undefined;
}

/** The `page[after]` cursor in the API's `links.next`, or `null` on the last page. */
export function cursorFromNextLink(next: string | null, prefix: IdPrefix): string | null {
  if (next === null) {
    return null;
  }
  const after = new URL(next, 'http://api.invalid').searchParams.get('page[after]');
  return parseCursor(after, prefix) ?? null;
}
