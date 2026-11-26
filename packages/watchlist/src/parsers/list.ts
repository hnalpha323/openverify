/**
 * C77.2, C77.4: the driver every XML list parser runs on. It reads the document through the
 * guarded reader, checks the root and its namespace, hands each header element to the format and
 * each entry to its mapper, refuses a publication without a publication time before its first
 * entry, finishes and validates every record, refuses an entry id given twice, and returns the
 * publication time it read, which the sync's monotonicity and future checks use (C76.2).
 */
import type { WatchlistRecord } from '../record/index.js';
import { readXml, type ByteSource, type XmlElement, type XmlGuardLimits } from '../xml/index.js';
import { WatchlistParseError } from './errors.js';
import { finishRecord, type RecordDraft } from './normalise.js';

/** What a parse returns once every entry has been read. */
export interface WatchlistPublication {
  /** C77.4: the publication time the file states, ISO 8601 in UTC. */
  readonly publishedAt: string;
  /** The entries read. */
  readonly entries: number;
  /** The publisher's own file id, where it gives one (the EU's `globalFileId`). */
  readonly fileId?: string;
}

/** A parse: the records in document order, then the publication. */
export type WatchlistParse = AsyncGenerator<WatchlistRecord, WatchlistPublication, undefined>;

export interface ListParseOptions {
  /** The manifest's `max_bytes` (inflated, for a ZIP). */
  readonly maxBytes: number;
  readonly limits?: Partial<XmlGuardLimits>;
}

/** One publisher's XML format, mapped onto the record. */
export interface XmlListFormat<State> {
  /** The format's name, for refusals. */
  readonly label: string;
  /** The root element's local name. */
  readonly root: string;
  /** The root's namespace URI, or `null` for a document without one. */
  readonly namespace: string | null;
  /** Paths of the elements that are entries. */
  readonly entries: readonly string[];
  /** Paths of the header elements read before the entries. */
  readonly headers: readonly string[];
  start(root: XmlElement): State;
  header(state: State, path: string, element: XmlElement): void;
  entry(state: State, element: XmlElement, ordinal: number): RecordDraft;
  publication(state: State): { readonly publishedAt: string | null; readonly fileId?: string };
}

/**
 * Parses a list in `format`.
 * @throws {WatchlistParseError} from the reader's guards, `format` for another root, namespace or
 * a missing publication time, `schema` for a record the schema refuses or an entry id given twice.
 */
export async function* parseXmlList<State>(
  source: ByteSource,
  format: XmlListFormat<State>,
  options: ListParseOptions,
): WatchlistParse {
  const entries = new Set(format.entries);
  const capture = [...format.headers, ...format.entries];
  const ids = new Set<string>();
  let state: State | undefined;
  let ordinal = 0;
  const reader = readXml(source, {
    maxBytes: options.maxBytes,
    capture,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  for await (const event of reader) {
    if (event.kind === 'root') {
      if (event.element.name !== format.root || event.namespace !== format.namespace) {
        throw new WatchlistParseError('format', `the document is not ${format.label}`);
      }
      state = format.start(event.element);
    } else if (state !== undefined && !entries.has(event.path)) {
      format.header(state, event.path, event.element);
    } else if (state !== undefined) {
      if (ordinal === 0) {
        publicationOf(format, state);
      }
      ordinal += 1;
      const record = finishRecord(format.entry(state, event.element, ordinal), ordinal);
      if (ids.has(record.entry_id)) {
        throw new WatchlistParseError('schema', `entry ${String(ordinal)}: its id is given twice`);
      }
      ids.add(record.entry_id);
      yield record;
    }
  }
  if (state === undefined) {
    throw new WatchlistParseError('format', `the document is not ${format.label}`);
  }
  return { ...publicationOf(format, state), entries: ordinal };
}

function publicationOf<State>(
  format: XmlListFormat<State>,
  state: State,
): { readonly publishedAt: string; readonly fileId?: string } {
  const { publishedAt, fileId } = format.publication(state);
  if (publishedAt === null) {
    throw new WatchlistParseError('format', `the ${format.label} states no publication time`);
  }
  return fileId === undefined ? { publishedAt } : { publishedAt, fileId };
}

/**
 * Runs a parse to its end, handing each record to `onRecord` in order, and returns the
 * publication. The sync applies records as they come and rolls back when this throws.
 */
export async function readPublication(
  parse: WatchlistParse,
  onRecord: (record: WatchlistRecord) => void | Promise<void>,
): Promise<WatchlistPublication> {
  for (;;) {
    const step = await parse.next();
    if (step.done === true) {
      return step.value;
    }
    await onRecord(step.value);
  }
}
