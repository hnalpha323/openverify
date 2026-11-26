/**
 * C93.5 (decision 8): the `ipReputation` adapters. The file adapter reads an operator-licensed
 * anonymous-IP MMDB; here a synthetic one written by our own test writer over documentation
 * addresses. It answers locally and sends nothing. The sandbox adapter answers the C93.6 values.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxNetwork, parseAddress } from '@openverify/signals/network';
import { sandboxNetworkBundle, writeMmdb } from '@openverify/signals/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { IP_REPUTATION_PROVIDER_NAMES, createIpReputationProvider } from './index.js';

const directory = mkdtempSync(join(tmpdir(), 'openverify-ip-reputation-'));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function anonymousIpFile(): string {
  const path = join(directory, 'anonymous-ip.mmdb');
  writeFileSync(
    path,
    writeMmdb({
      databaseType: 'Example-Anonymous-IP',
      buildEpoch: new Date('2026-10-01T00:00:00Z'),
      entries: [
        { network: '198.51.100.0/28', data: { is_anonymous: true, is_public_proxy: true } },
        {
          network: '198.51.100.16/28',
          data: {
            is_anonymous: false,
            is_anonymous_vpn: false,
            is_public_proxy: false,
            is_residential_proxy: false,
            is_tor_exit_node: false,
          },
        },
        { network: '198.51.100.32/28', data: { is_hosting_provider: true } },
      ],
    }),
  );
  return path;
}

describe('the mmdb-file adapter', () => {
  const provider = createIpReputationProvider('mmdb-file', { mmdbPath: anonymousIpFile() });

  it('names itself, not a sandbox', () => {
    expect([provider.id, provider.sandbox]).toEqual(['mmdb-file', false]);
    expect(IP_REPUTATION_PROVIDER_NAMES).toEqual(['mmdb-file', 'sandbox']);
  });

  it('answers true for a flagged address, with its kind of anonymiser', () => {
    expect(provider.lookup('198.51.100.5')).toEqual({
      value: true,
      proxyType: 'public_proxy',
      connectionType: null,
    });
  });

  it('answers false only where the file records a negative, and null elsewhere', () => {
    expect(provider.lookup('198.51.100.20').value).toBe(false);
    // A hosting flag alone says nothing about a proxy.
    expect(provider.lookup('198.51.100.40').value).toBeNull();
    expect(provider.lookup('203.0.113.9')).toEqual({
      value: null,
      proxyType: null,
      connectionType: null,
    });
    expect(provider.lookup('::ffff:198.51.100.5').value).toBe(true);
  });

  it('answers null for an address it cannot read', () => {
    expect(provider.lookup('not an address').value).toBeNull();
  });

  it('fails a lookup, never answering, when the file cannot be opened', () => {
    const missing = createIpReputationProvider('mmdb-file', {
      mmdbPath: join(directory, 'missing.mmdb'),
    });
    expect(() => missing.lookup('198.51.100.5')).toThrow(/ipReputation file/);
    expect(() => missing.lookup('198.51.100.5')).not.toThrow(/198\.51/);
  });

  it('needs its path', () => {
    expect(() => createIpReputationProvider('mmdb-file', { mmdbPath: null })).toThrow(
      /OPENVERIFY_IP_REPUTATION_MMDB_PATH/,
    );
  });
});

describe('the sandbox adapter (C93.6)', () => {
  const provider = createIpReputationProvider('sandbox', { mmdbPath: null });
  const bundle = SandboxNetwork.parse(sandboxNetworkBundle());

  it('names itself a sandbox', () => {
    expect([provider.id, provider.sandbox]).toEqual(['sandbox', true]);
  });

  it('answers the sandbox bundle’s proxies, and null for every other address, never false', () => {
    for (let last = 0; last < 256; last += 1) {
      for (const block of ['192.0.2', '198.51.100', '203.0.113']) {
        const address = `${block}.${String(last)}`;
        const parsed = parseAddress(address);
        if (parsed === null) {
          throw new Error('unparsable');
        }
        expect(provider.lookup(address)).toEqual({
          ...bundle.ipReputation(parsed),
          connectionType: null,
        });
      }
    }
    expect(provider.lookup('192.0.2.40')).toMatchObject({ value: true, proxyType: 'public_proxy' });
    expect(provider.lookup('2001:db8::40').value).toBeNull();
  });
});
