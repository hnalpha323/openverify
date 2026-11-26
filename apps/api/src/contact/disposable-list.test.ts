/**
 * C56: the disposable-email list is the `data/manifest.json` file, checked against its pinned
 * SHA-256 before use and recorded as provenance; a missing or changed file gives no list (the check
 * then answers `list_unavailable`). Lists here are synthetic files under their own digests.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DISPOSABLE_LIST_PIN,
  defaultDisposableListPath,
  disposableDomainList,
  loadDisposableDomainList,
} from './disposable-list.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const LIST = '# synthetic\ntrash.example\nSpam.Example\n\n';
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

let folder: string;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'openverify-disposable-'));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('the disposable list (C56)', () => {
  it('is pinned as data/manifest.json pins it', async () => {
    const manifest = JSON.parse(await readFile(join(REPO, 'data', 'manifest.json'), 'utf8')) as {
      data: { name: string; filename: string; sha256: string; commit: string }[];
    };
    const entry = manifest.data.find((candidate) => candidate.name === DISPOSABLE_LIST_PIN.name);

    expect(entry?.filename).toBe(DISPOSABLE_LIST_PIN.filename);
    expect(entry?.sha256).toBe(DISPOSABLE_LIST_PIN.sha256);
    expect(DISPOSABLE_LIST_PIN.id).toBe(
      `disposable-email-domains@${entry?.commit.slice(0, 7) ?? ''}`,
    );
  });

  it('is read from data/ at the root of the repository or image', () => {
    expect(defaultDisposableListPath()).toBe(join(REPO, 'data', DISPOSABLE_LIST_PIN.filename));
  });

  it('loads a file of the pinned digest, its domains lower-cased, its provenance recorded', async () => {
    const path = join(folder, 'list.conf');
    await writeFile(path, LIST, 'utf8');
    const pin = { id: 'synthetic-list@0000000', sha256: digest(LIST) };

    const list = await loadDisposableDomainList(path, pin);

    expect([...(list?.domains ?? [])].sort()).toEqual(['spam.example', 'trash.example']);
    expect(list?.source).toEqual(pin);
  });

  it('gives no list for a file that is not the pinned one, or none at all', async () => {
    const path = join(folder, 'changed.conf');
    await writeFile(path, `${LIST}added.example\n`, 'utf8');

    expect(
      await loadDisposableDomainList(path, { id: 'synthetic-list@0000000', sha256: digest(LIST) }),
    ).toBeNull();
    expect(await loadDisposableDomainList(join(folder, 'missing.conf'))).toBeNull();
  });

  it('is loaded once per process', () => {
    expect(disposableDomainList()).toBe(disposableDomainList());
  });
});
