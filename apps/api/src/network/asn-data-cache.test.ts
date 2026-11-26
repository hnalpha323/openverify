/**
 * KP11-91 (7C review R010; threat row B10-D2): a missing or unexpected ASN seed is cached like a
 * loaded one, so a session start does not re-read and re-hash the manifest and the seeds each
 * time; a seed fetched or corrected later, or a manifest naming a new digest, is still picked up
 * on the next call, because the cache is keyed by each file's size and modification time.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticBadAsnList, syntheticX4bnetAsnList } from '@openverify/signals/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASN_OVERRIDES_FORMAT, loadAsnData } from './asn-data.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  vi.mocked(fs.readFileSync).mockClear();
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const SEEDS: Record<string, { name: string; text: string }> = {
  'x4bnet-datacenter-ASN.txt': { name: 'x4bnet_datacenter_asns', text: 'AS64500\nAS64503\n' },
  'x4bnet-vpn-ASN.txt': { name: 'x4bnet_vpn_asns', text: syntheticX4bnetAsnList({ seed: 'vpn' }) },
  'bad-asn-list.csv': { name: 'bad_asn_list', text: syntheticBadAsnList({ seed: 'bad' }) },
};

function writeManifest(root: string, digests: Record<string, string> = {}): void {
  const data = Object.entries(SEEDS).map(([filename, { name, text }]) => ({
    name,
    filename,
    sha256: digests[filename] ?? sha256(text),
    size: Buffer.byteLength(text),
  }));
  fs.writeFileSync(join(root, 'manifest.json'), JSON.stringify({ schema_version: 1, data }));
}

function dataDirectory(options: { omit?: string; tamper?: string }) {
  const root = fs.mkdtempSync(join(tmpdir(), 'openverify-asn-cache-'));
  directories.push(root);
  writeManifest(root);
  for (const [filename, { text }] of Object.entries(SEEDS)) {
    if (filename !== options.omit) {
      fs.writeFileSync(
        join(root, filename),
        filename === options.tamper ? `${text}AS64510\n` : text,
      );
    }
  }
  const overridesPath = join(root, 'asn-overrides.json');
  fs.writeFileSync(overridesPath, JSON.stringify({ format: ASN_OVERRIDES_FORMAT, overrides: [] }));
  return { dataDirectory: root, overridesPath };
}

/** The reads of files under `root` since the last count. */
function readsUnder(root: string): number {
  const reads = vi
    .mocked(fs.readFileSync)
    .mock.calls.filter(([path]) => String(path).startsWith(root)).length;
  vi.mocked(fs.readFileSync).mockClear();
  return reads;
}

describe('loadAsnData caches a missing or unexpected seed (KP11-91)', () => {
  it('reads nothing again across session starts while a seed is missing', () => {
    const paths = dataDirectory({ omit: 'x4bnet-vpn-ASN.txt' });

    expect(loadAsnData(paths).status).toBe('missing');
    expect(readsUnder(paths.dataDirectory)).toBeGreaterThan(0);
    for (let start = 0; start < 5; start += 1) {
      expect(loadAsnData(paths)).toEqual({ status: 'missing', files: ['x4bnet-vpn-ASN.txt'] });
    }
    expect(readsUnder(paths.dataDirectory)).toBe(0);
  });

  it('picks up a seed fetched later on the next call', () => {
    const paths = dataDirectory({ omit: 'x4bnet-vpn-ASN.txt' });
    expect(loadAsnData(paths).status).toBe('missing');

    fs.writeFileSync(
      join(paths.dataDirectory, 'x4bnet-vpn-ASN.txt'),
      SEEDS['x4bnet-vpn-ASN.txt']?.text ?? '',
    );

    expect(loadAsnData(paths).status).toBe('loaded');
  });

  it('reads nothing again while a seed is unexpected, and picks up its corrected bytes', () => {
    const paths = dataDirectory({ tamper: 'bad-asn-list.csv' });
    expect(loadAsnData(paths).status).toBe('unexpected');
    readsUnder(paths.dataDirectory);

    expect(loadAsnData(paths)).toEqual({ status: 'unexpected', files: ['bad-asn-list.csv'] });
    expect(readsUnder(paths.dataDirectory)).toBe(0);

    fs.writeFileSync(
      join(paths.dataDirectory, 'bad-asn-list.csv'),
      SEEDS['bad-asn-list.csv']?.text ?? '',
    );
    expect(loadAsnData(paths).status).toBe('loaded');
  });

  it('picks up a manifest that names the seed it holds', () => {
    const paths = dataDirectory({ tamper: 'x4bnet-datacenter-ASN.txt' });
    expect(loadAsnData(paths).status).toBe('unexpected');

    const held = `${SEEDS['x4bnet-datacenter-ASN.txt']?.text ?? ''}AS64510\n`;
    writeManifest(paths.dataDirectory, { 'x4bnet-datacenter-ASN.txt': sha256(held) });
    expect(loadAsnData(paths).status).toBe('loaded');
  });
});
