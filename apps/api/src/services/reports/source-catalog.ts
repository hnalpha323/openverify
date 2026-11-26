/**
 * C71.2, C76.1, C76.3, C76.7: what the report engine reads about each watchlist source from the
 * committed manifest (`watchlists/sources.json`, owned by `api-watchlists`): its kind (which
 * report types may select it), its refresh and staleness intervals, whether it is sandbox-only,
 * and the lines a result shows (publisher, attribution, list URL, flag code).
 *
 * The manifest is read once, leniently, by the field names C76.1 gives (`id`, `kind`,
 * `publisher`, `urls`, `refresh_interval_hours`, `stale_after_hours`, `sandbox_only`,
 * `attribution`, optionally `flag_code`); a missing file is an empty catalog, so every source is
 * unknown and nothing reads as screened. Tests (and any caller holding the manifest already)
 * install a catalog with {@link useWatchlistSourceCatalog}.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export type WatchlistSourceKind = 'sanctions' | 'pep';

export interface WatchlistSourceDescription {
  id: string;
  kind: WatchlistSourceKind;
  /** The publisher's name, the list's `name` in `matched-lists`. */
  publisher: string;
  /** `null` for a source that is never refreshed (the sandbox lists). */
  refreshIntervalHours: number | null;
  /** `null`: never stale (C76.3, V03). */
  staleAfterHours: number | null;
  sandboxOnly: boolean;
  /** The line shown with every result that used the source (C76.7). */
  attribution: string;
  /** The first https URL of the manifest entry, or `null`. */
  listUrl: string | null;
  /** The publisher's country or union code (`US`, `EU`, `GB`, `UN`; `ZZ` otherwise). */
  flagCode: string;
}

export interface WatchlistSourceCatalog {
  get(id: string): WatchlistSourceDescription | undefined;
  all(): readonly WatchlistSourceDescription[];
}

/** A catalog of the given descriptions. */
export function catalogOf(descriptions: readonly WatchlistSourceDescription[]): WatchlistSourceCatalog {
  const byId = new Map(descriptions.map((description) => [description.id, description]));
  return Object.freeze({ get: (id: string) => byId.get(id), all: () => [...byId.values()] });
}

/** The publisher codes guessed from a source id's first word, when the manifest names none. */
const FLAG_CODES: Readonly<Record<string, string>> = { ofac: 'US', eu: 'EU', uk: 'GB', un: 'UN' };

const hours = z.number().positive().nullable().optional();

/** One manifest entry as the engine reads it; the other members are `api-watchlists'`. */
const entrySchema = z.object({
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(64),
  kind: z.enum(['sanctions', 'pep']),
  publisher: z.string().min(1).max(200).optional(),
  urls: z.array(z.string()).optional(),
  refresh_interval_hours: hours,
  stale_after_hours: hours,
  sandbox_only: z.boolean().optional(),
  attribution: z.string().min(1).max(500).optional(),
  flag_code: z.string().regex(/^[A-Z]{2}$/).optional(),
});

/** The sources of a manifest (`[...]` or `{ sources: [...] }`); an entry it cannot read is left out. */
export function parseWatchlistManifest(manifest: unknown): WatchlistSourceDescription[] {
  const entries: unknown[] = Array.isArray(manifest)
    ? manifest
    : Array.isArray((manifest as { sources?: unknown } | null)?.sources)
      ? (manifest as { sources: unknown[] }).sources
      : [];
  return entries.flatMap((entry) => {
    const parsed = entrySchema.safeParse(entry);
    if (!parsed.success) {
      return [];
    }
    const source = parsed.data;
    return [
      {
        id: source.id,
        kind: source.kind,
        publisher: source.publisher ?? source.id,
        refreshIntervalHours: source.refresh_interval_hours ?? null,
        staleAfterHours: source.stale_after_hours ?? null,
        sandboxOnly: source.sandbox_only ?? false,
        attribution: source.attribution ?? source.publisher ?? source.id,
        listUrl: source.urls?.find((url) => url.startsWith('https://')) ?? null,
        flagCode: source.flag_code ?? FLAG_CODES[source.id.split('-')[0] ?? ''] ?? 'ZZ',
      },
    ];
  });
}

/** `watchlists/sources.json` at the repository (or image) root, from `src` or `dist`. */
export function defaultWatchlistManifestPath(): string {
  return join(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..'),
    'watchlists',
    'sources.json',
  );
}

/** The catalog of the manifest at `path`; empty when the file is missing or unreadable. */
export function loadWatchlistSourceCatalog(
  path: string = defaultWatchlistManifestPath(),
): WatchlistSourceCatalog {
  try {
    return catalogOf(parseWatchlistManifest(JSON.parse(readFileSync(path, 'utf8'))));
  } catch {
    return catalogOf([]);
  }
}

let installed: WatchlistSourceCatalog | null = null;
let loaded: WatchlistSourceCatalog | null = null;

/** The catalog in force: the installed one, else the manifest's (read once). */
export function watchlistSourceCatalog(): WatchlistSourceCatalog {
  if (installed !== null) {
    return installed;
  }
  loaded ??= loadWatchlistSourceCatalog();
  return loaded;
}

/** Installs `catalog` (or clears it with `null`); returns a function that restores the previous one. */
export function useWatchlistSourceCatalog(catalog: WatchlistSourceCatalog | null): () => void {
  const previous = installed;
  installed = catalog;
  return () => {
    installed = previous;
  };
}
