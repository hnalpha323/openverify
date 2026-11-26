// @ts-check
/**
 * The synthetic list tables of the performance benchmark (evaluation-6, plan C78.7), generated at
 * run time from a seed and never committed.
 *
 * Owner decision 6 after Workflow 6C: the tables have one definition,
 * `src/testing/heavy-headed.ts`, which the C78.7 gate draws too. This module re-exports its
 * profiles, its Zipf law, its pool, its entries and its queries, so the benchmark's tables are the
 * gate's by construction (`benchmark-golden.test.mjs` pins their output), and adds only the writer
 * of the normalised import file, which is not part of a table's definition.
 */
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';

/** @typedef {import('../src/record/index.js').WatchlistRecord} WatchlistRecord */
/** @typedef {import('../src/testing/heavy-headed.js').TableProfile} TableProfile */
/** @typedef {import('../src/testing/heavy-headed.js').PoolItem} PoolItem */
/** @typedef {import('../src/testing/heavy-headed.js').NamePool} NamePool */

export {
  TABLE_PROFILES,
  listedQuery,
  namePool,
  syntheticEntries,
  unlistedQueries,
  zipfSampler,
} from '../src/testing/heavy-headed.js';

/** The text written to the file per chunk. */
const CHUNK_CHARACTERS = 1 << 20;

/**
 * Writes a normalised import file (C77.5) record by record, never holding the whole text.
 * @param {string} path
 * @param {{ source: string, publishedAt: string, records: Iterable<WatchlistRecord> }} input
 * @returns {Promise<{ entries: number, names: number, bytes: number, sha256: string }>}
 */
export async function writeNormalisedImport(path, input) {
  const stream = createWriteStream(path, { mode: 0o600 });
  const hash = createHash('sha256');
  let bytes = 0;
  let entries = 0;
  let names = 0;
  let pending = `{"source":${JSON.stringify(input.source)},"published_at":${JSON.stringify(input.publishedAt)},"entries":[`;
  const flush = async () => {
    const buffer = Buffer.from(pending, 'utf8');
    pending = '';
    hash.update(buffer);
    bytes += buffer.length;
    if (!stream.write(buffer)) {
      await once(stream, 'drain');
    }
  };
  for (const record of input.records) {
    pending += `${entries === 0 ? '' : ','}${JSON.stringify(record)}`;
    entries += 1;
    names += record.names.length;
    if (pending.length >= CHUNK_CHARACTERS) {
      await flush();
    }
  }
  pending += ']}\n';
  await flush();
  stream.end();
  await once(stream, 'finish');
  return { entries, names, bytes, sha256: hash.digest('hex') };
}
