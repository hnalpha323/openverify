/**
 * C76.2 steps 4-5, C77.2: what a sync parses. A file is opened once: its bytes are hashed and
 * parsed from the same file handle. Its own format is chosen by its first bytes and the source's
 * parser: the single-member ZIP of OFAC's SDN list, a publisher's XML, the recorded Wikidata
 * answers (`openverify/wikidata-pep-answers/v1`, an import into `wikidata-pep`), or the
 * normalised JSON of C77.5, which only the sandbox sources take without `--allow-normalised`
 * (P08). Every refusal names a rule, never a value.
 */
import type { FileHandle } from 'node:fs/promises';
import {
  PEP_IMPORT_FORMAT,
  WatchlistParseError,
  buildPepRecords,
  fileSource,
  parseEuFsf,
  parseGuardedJson,
  parseOfacEnhanced,
  parseOfacEnhancedZip,
  parseUkSanctionsList,
  parseUnConsolidated,
  pepImportSource,
  watchlistImportSchema,
  type PepBuildOptions,
  type WatchlistParse,
  type WatchlistPublication,
  type WatchlistRecord,
} from '@openverify/watchlist';
import type { WatchlistManifestSource } from './manifest.js';

/** A sync ended in a refusal (C73.3); the message names the rule only. */
export class WatchlistRefusal extends Error {
  override name = 'WatchlistRefusal';
  readonly outcome:
    | 'refused_schema'
    | 'refused_size'
    | 'refused_rollback'
    | 'refused_future'
    | 'refused_mass_removal';

  constructor(outcome: WatchlistRefusal['outcome'], rule: string) {
    super(`${outcome}: ${rule}`);
    this.outcome = outcome;
  }
}

/** The refusal a parse failure records: `refused_size` past a cap, else `refused_schema`. */
export function refusalOf(error: unknown): WatchlistRefusal | null {
  if (error instanceof WatchlistRefusal) {
    return error;
  }
  if (error instanceof WatchlistParseError) {
    return new WatchlistRefusal(error.refusal, error.code);
  }
  return null;
}

export interface OpenedPublication {
  /** The records in order, then the publication. */
  parse: WatchlistParse;
  /** The normalised format was read for a publisher's source (the `allow-normalised` override). */
  normalisedOverride: boolean;
}

export interface OpenPublicationOptions {
  allowNormalised: boolean;
  /** The PEP rules of a recorded Wikidata answer document (C80.2-C80.4). */
  pep: PepBuildOptions;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** The first character of a text file, past a UTF-8 byte order mark and white space. */
function firstCharacter(head: Uint8Array): string {
  let index = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  while (index < head.length && [0x09, 0x0a, 0x0d, 0x20].includes(head[index] ?? 0)) {
    index += 1;
  }
  return String.fromCharCode(head[index] ?? 0);
}

async function readAll(handle: FileHandle): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** C76.2 step 4: the SHA-256 of the whole file, the sync runner's (C92.2). */
export { hashFile } from '../sync/runner.js';

async function* normalisedRecords(
  entries: readonly WatchlistRecord[],
  publishedAt: string,
): WatchlistParse {
  for (const entry of entries) {
    yield await Promise.resolve(entry);
  }
  return { publishedAt: new Date(publishedAt).toISOString(), entries: entries.length };
}

/** The XML parser of a source's own format, or `null` when the source reads no XML. */
function xmlParser(
  source: WatchlistManifestSource,
): ((input: AsyncIterable<Uint8Array>, options: { maxBytes: number }) => WatchlistParse) | null {
  switch (source.parser) {
    case 'ofac-enhanced-xml':
      return parseOfacEnhanced;
    case 'eu-fsf-xml':
      return parseEuFsf;
    case 'uk-sanctions-list-xml':
      return parseUkSanctionsList;
    case 'un-consolidated-xml':
      return parseUnConsolidated;
    default:
      return null;
  }
}

/**
 * C76.2 step 5: the parse of the file behind `handle` (`size` bytes) for `source`.
 * @throws {WatchlistRefusal} for a file over the source's cap or in a format it does not read.
 */
export async function openPublication(
  source: WatchlistManifestSource,
  handle: FileHandle,
  size: number,
  options: OpenPublicationOptions,
): Promise<OpenedPublication> {
  const caps = source.max_bytes;
  if (size > caps.compressed) {
    throw new WatchlistRefusal('refused_size', 'the file is over the source’s byte cap');
  }
  const head = new Uint8Array(64);
  await handle.read(head, 0, head.length, 0);
  if (ZIP_MAGIC.every((byte, index) => head[index] === byte)) {
    if (source.archive_member === null) {
      throw new WatchlistRefusal('refused_schema', 'a ZIP archive is not this source’s format');
    }
    return {
      parse: parseOfacEnhancedZip(await fileSource(handle), {
        maxBytes: caps.inflated,
        maxCompressedBytes: caps.compressed,
        memberName: source.archive_member,
      }),
      normalisedOverride: false,
    };
  }
  const first = firstCharacter(head);
  if (first === '<') {
    const parser = xmlParser(source);
    if (parser === null) {
      throw new WatchlistRefusal('refused_schema', 'an XML file is not this source’s format');
    }
    return {
      parse: parser(handle.createReadStream({ start: 0, autoClose: false }), {
        maxBytes: caps.inflated,
      }),
      normalisedOverride: false,
    };
  }
  if (first !== '{') {
    throw new WatchlistRefusal('refused_schema', 'the file is in no format this source reads');
  }
  const bytes = await readAll(handle);
  const document = parseGuardedJson(bytes, { maxBytes: caps.inflated }) as {
    format?: unknown;
  } | null;
  if (source.parser === 'wikidata-sparql' && document?.format === PEP_IMPORT_FORMAT) {
    return {
      parse: buildPepRecords(pepImportSource(bytes, { maxBytes: caps.inflated }), options.pep),
      normalisedOverride: false,
    };
  }
  const sandbox = source.parser === 'normalised-json';
  if (!sandbox && !options.allowNormalised) {
    throw new WatchlistRefusal(
      'refused_schema',
      'the normalised format is taken for a publisher’s source only with --allow-normalised',
    );
  }
  const parsed = watchlistImportSchema.safeParse(document);
  if (!parsed.success) {
    throw new WatchlistRefusal('refused_schema', 'the file is not a valid normalised import');
  }
  if (parsed.data.source !== source.id) {
    throw new WatchlistRefusal('refused_schema', 'the file was written for another source');
  }
  return {
    parse: normalisedRecords(parsed.data.entries, parsed.data.published_at),
    normalisedOverride: !sandbox,
  };
}

export type { WatchlistPublication };
