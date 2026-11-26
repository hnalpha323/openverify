import Link from 'next/link';
import { listHref, type ListQueryValue } from '../lib/list-query';
import { LINK_CLASS } from './link-styles';

export interface PaginationProps {
  /** The list page, such as `/accounts`. */
  readonly path: string;
  /** The list's filters, kept in the URL (C23). */
  readonly query: Readonly<Record<string, ListQueryValue>>;
  /** The cursor this page started after, or undefined on the first page. */
  readonly after?: string | undefined;
  /** The cursor of the next page (`cursorFromNextLink`), or `null` on the last page. */
  readonly nextCursor: string | null;
  /** The URL parameter of the cursor, for a page with several lists; `after` by default. */
  readonly param?: string;
  /** The landmark's name, for a page with several lists; "Pagination" by default. */
  readonly label?: string;
}

/**
 * C1 cursor pagination moves forward only, so it offers the next page and a way back to the
 * first, with the same filters. The cursor travels as `after` in the page URL, or as `param` on a
 * page with several lists.
 */
export function Pagination({
  path,
  query,
  after,
  nextCursor,
  param = 'after',
  label = 'Pagination',
}: PaginationProps) {
  const onFirstPage = after === undefined;
  if (onFirstPage && nextCursor === null) {
    return null;
  }
  return (
    <nav aria-label={label} className="flex items-center gap-6 text-sm">
      {!onFirstPage && (
        <Link href={listHref(path, query)} className={LINK_CLASS}>
          First page
        </Link>
      )}
      {nextCursor !== null && (
        <Link
          href={listHref(path, { ...query, [param]: nextCursor })}
          rel="next"
          className={`ms-auto ${LINK_CLASS}`}
        >
          Next page
        </Link>
      )}
    </nav>
  );
}
