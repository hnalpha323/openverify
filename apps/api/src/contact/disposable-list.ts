/**
 * C56: the disposable-email list `email_address_disposable_detection` reads, the file
 * `scripts/fetch_data.py` fetches into `data/` (pinned in `data/manifest.json`; gitignored, baked
 * into the API image). It is loaded once per process, checked against its pinned SHA-256 and
 * recorded as the result's provenance; a missing or changed file gives no list, so the check
 * answers `list_unavailable` (never a pass).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDisposableDomainList, type DisposableDomainList } from '@openverify/checks';

/** The list's `data/manifest.json` entry, pinned. */
export const DISPOSABLE_LIST_PIN = Object.freeze({
  name: 'disposable_email_domains',
  filename: 'disposable_email_blocklist.conf',
  /** The provenance id the result records: the source and its commit. */
  id: 'disposable-email-domains@6fcca80',
  sha256: 'e3bd73552549f2fef7997b4892909835907f0045742a06d961bc9af8d7380f79',
});

/** What the loader checks a file against: its provenance id and SHA-256. */
export interface DisposableListPin {
  id: string;
  sha256: string;
}

/**
 * Where the file is: `data/` at the repository (or image) root, four levels above this module
 * whether it runs from `src/contact` or `dist/contact`.
 */
export function defaultDisposableListPath(): string {
  return join(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'),
    'data',
    DISPOSABLE_LIST_PIN.filename,
  );
}

/** Reads, checks and parses the list at `path`; `null` when it is missing or not the pinned file. */
export async function loadDisposableDomainList(
  path: string = defaultDisposableListPath(),
  pin: DisposableListPin = DISPOSABLE_LIST_PIN,
): Promise<DisposableDomainList | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return null;
  }
  if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) {
    return null;
  }
  return {
    domains: parseDisposableDomainList(bytes.toString('utf8')),
    source: { id: pin.id, sha256: pin.sha256 },
  };
}

let loaded: Promise<DisposableDomainList | null> | undefined;

/** The process's list, loaded once from {@link defaultDisposableListPath}. */
export function disposableDomainList(): Promise<DisposableDomainList | null> {
  loaded ??= loadDisposableDomainList();
  return loaded;
}
