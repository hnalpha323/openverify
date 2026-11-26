/**
 * C92.6: the pinned ASN seeds and the committed overrides. The seeds here are synthetic, written
 * by `@openverify/signals/testing` with documentation ASNs only, into a temporary `data/`.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticBadAsnList, syntheticX4bnetAsnList } from '@openverify/signals/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ASN_OVERRIDES_FORMAT,
  defaultAsnDataPaths,
  loadAsnData,
  parseAsnOverrides,
} from './asn-data.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** A data directory with the three seeds and a manifest naming their digests. */
function dataDirectory(options: { omit?: string; tamper?: string; overrides?: unknown } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openverify-asn-'));
  directories.push(root);
  const files: Record<string, { name: string; text: string }> = {
    'x4bnet-datacenter-ASN.txt': {
      name: 'x4bnet_datacenter_asns',
      text: 'AS64500 # Example Hosting\nAS64503\nAS64500 # again\n',
    },
    'x4bnet-vpn-ASN.txt': {
      name: 'x4bnet_vpn_asns',
      text: syntheticX4bnetAsnList({ seed: 'vpn' }),
    },
    'bad-asn-list.csv': {
      name: 'bad_asn_list',
      text: syntheticBadAsnList({ seed: 'bad' }),
    },
  };
  const data = Object.entries(files).map(([filename, { name, text }]) => ({
    name,
    filename,
    sha256: sha256(text),
    size: Buffer.byteLength(text),
  }));
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ schema_version: 1, data }));
  for (const [filename, { text }] of Object.entries(files)) {
    if (filename !== options.omit) {
      writeFileSync(join(root, filename), filename === options.tamper ? `${text}AS64510\n` : text);
    }
  }
  const overridesPath = join(root, 'asn-overrides.json');
  writeFileSync(
    overridesPath,
    JSON.stringify(options.overrides ?? { format: ASN_OVERRIDES_FORMAT, overrides: [] }),
  );
  return { dataDirectory: root, overridesPath };
}

describe('loadAsnData', () => {
  it('loads the hosting and VPN sets from the verified seeds, applying the overrides', () => {
    const paths = dataDirectory({
      overrides: {
        format: ASN_OVERRIDES_FORMAT,
        overrides: [
          {
            asn: 64503,
            list: 'hosting',
            action: 'remove',
            evidence: 'synthetic: a residential AS',
          },
          { asn: 64511, list: 'vpn', action: 'add', evidence: 'synthetic: a VPN operator' },
        ],
      },
    });
    const data = loadAsnData(paths);
    expect(data.status).toBe('loaded');
    if (data.status !== 'loaded') {
      return;
    }
    expect(data.sets.hosting.has(64500)).toBe(true);
    expect(data.sets.hosting.has(64503)).toBe(false);
    expect(data.sets.vpn.has(64511)).toBe(true);
    expect(data.counts).toEqual({ hosting: data.sets.hosting.size, vpn: data.sets.vpn.size });
  });

  it('answers missing, naming the file, when a seed was not fetched', () => {
    const data = loadAsnData(dataDirectory({ omit: 'x4bnet-vpn-ASN.txt' }));
    expect(data).toEqual({ status: 'missing', files: ['x4bnet-vpn-ASN.txt'] });
  });

  it('answers unexpected when a seed does not match its pinned SHA-256', () => {
    const data = loadAsnData(dataDirectory({ tamper: 'bad-asn-list.csv' }));
    expect(data).toEqual({ status: 'unexpected', files: ['bad-asn-list.csv'] });
  });

  it('reads the repository data directory and the committed overrides by default', () => {
    const paths = defaultAsnDataPaths();
    expect(paths.dataDirectory).toMatch(/[/\\]data$/);
    expect(paths.overridesPath).toMatch(/[/\\]network[/\\]asn-overrides\.json$/);
    expect(['loaded', 'missing']).toContain(loadAsnData().status);
  });
});

describe('parseAsnOverrides', () => {
  it('parses the committed file, which starts empty', () => {
    expect(loadAsnData(defaultAsnDataPaths()).status).not.toBe('unexpected');
    expect(parseAsnOverrides({ format: ASN_OVERRIDES_FORMAT, overrides: [] }).overrides).toEqual(
      [],
    );
  });

  it('refuses a row without evidence, an unknown list, a bad ASN or a repeated row', () => {
    const row = { asn: 64500, list: 'hosting', action: 'add', evidence: 'synthetic' };
    const parse = (overrides: unknown[]) =>
      parseAsnOverrides({ format: ASN_OVERRIDES_FORMAT, overrides });
    expect(parse([row]).overrides).toEqual([row]);
    expect(() => parse([{ ...row, evidence: '' }])).toThrow();
    expect(() => parse([{ ...row, list: 'proxy' }])).toThrow();
    expect(() => parse([{ ...row, asn: 0 }])).toThrow();
    expect(() => parse([{ ...row, asn: 2 ** 32 }])).toThrow();
    expect(() => parse([row, { ...row, action: 'remove' }])).toThrow();
    expect(() => parse([{ ...row, note: 'extra' }])).toThrow();
  });
});
