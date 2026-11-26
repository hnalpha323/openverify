/**
 * The normalised JSON import format (C77.5): `{ source, published_at, entries }`, which
 * `watchlists:sync --import <file> --source <id>` accepts for the sandbox sources, or for any
 * source with `--allow-normalised` (C76.2, P08). Every file built here is validated against the
 * frozen `watchlistImportSchema` before it is returned, so a fixture can never be refused for its
 * shape.
 */
import {
  watchlistImportSchema,
  type WatchlistImport,
  type WatchlistRecord,
} from '../record/index.js';

/** A validated import file for `source`, published at `publishedAt`. */
export function normalisedImport(
  source: string,
  publishedAt: string | Date,
  entries: readonly WatchlistRecord[],
): WatchlistImport {
  return watchlistImportSchema.parse({
    source,
    published_at: typeof publishedAt === 'string' ? publishedAt : publishedAt.toISOString(),
    entries,
  });
}

/** The file's text: two-space JSON with a final newline, as the committed fixtures are written. */
export function normalisedImportText(file: WatchlistImport): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
