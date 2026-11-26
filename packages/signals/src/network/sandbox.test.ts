import { describe, expect, it } from 'vitest';
import { SANDBOX_NETWORK, sandboxNetworkBundle } from '../testing/sandbox-network.js';
import { parseAddress, type ParsedAddress } from './address.js';
import { SPECIAL_BLOCKS } from './address-class.js';
import { NetworkParseError } from './errors.js';
import { lookupAsn, lookupCity, lookupCountry } from './mmdb.js';
import { DOCUMENTATION_ASN_RANGES, SandboxNetwork, isDocumentationAsn } from './sandbox.js';

function at(text: string): ParsedAddress {
  const parsed = parseAddress(text);
  if (parsed === null) {
    throw new Error('test address does not parse');
  }
  return parsed;
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof NetworkParseError) {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

function bundleWith(change: (bundle: Record<string, unknown>) => void): Buffer {
  const bundle = JSON.parse(sandboxNetworkBundle().toString('utf8')) as Record<string, unknown>;
  change(bundle);
  return Buffer.from(JSON.stringify(bundle));
}

describe('sandboxNetworkBundle and SandboxNetwork.parse (C93.6)', () => {
  const sandbox = SandboxNetwork.parse(sandboxNetworkBundle());

  it('is deterministic and never stale-dated', () => {
    expect(sandboxNetworkBundle().equals(sandboxNetworkBundle())).toBe(true);
    expect(sandbox.kind).toBe('sandbox');
    expect(sandbox.publishedAt.toISOString()).toBe(SANDBOX_NETWORK.publishedAt);
  });

  it('answers the table of C93.6', () => {
    expect(sandbox.tor.listed(at(SANDBOX_NETWORK.torExit).key, 24)).toBe(true);
    expect(sandbox.tor.listed(at('198.51.100.7').key, 24)).toBe(false);
    expect(sandbox.providerRanges.lookup(at(SANDBOX_NETWORK.providerRange).key)[0]?.provider).toBe(
      'example-cloud',
    );
    expect(sandbox.providerRanges.has(at(SANDBOX_NETWORK.vpnAsnAddress).key)).toBe(false);
    expect(lookupAsn(sandbox.asn, at(SANDBOX_NETWORK.vpnAsnAddress))?.asn).toBe(64500);
    expect(sandbox.asnSets.vpn.has(64500)).toBe(true);
    expect(lookupAsn(sandbox.asn, at(SANDBOX_NETWORK.hostingAsnAddress))?.asn).toBe(64503);
    expect(sandbox.asnSets.hosting.has(64503)).toBe(true);
    expect(sandbox.asnSets.hosting.has(64500)).toBe(false);
    expect(lookupAsn(sandbox.asn, at('198.51.100.7'))).toEqual({
      asn: 64501,
      organization: 'Example Residential',
    });
    expect(lookupCountry(sandbox.country, at('198.51.100.7'))).toEqual({
      code: 'ZZ',
      name: 'Example Land',
    });
    expect(lookupAsn(sandbox.asn, at('203.0.113.9'))?.asn).toBe(64502);
    expect(lookupCity(sandbox.city, at('203.0.113.9'))).toMatchObject({
      latitude: -30,
      longitude: -140,
    });
    expect(lookupCity(sandbox.city, at('203.0.113.200'))).toMatchObject({
      latitude: -30.5,
      longitude: -140.5,
    });
    expect(lookupCountry(sandbox.country, at('2001:db8::1'))?.code).toBe('ZZ');
    expect(sandbox.relayRanges.size).toBe(0);
  });

  it('answers the sandbox ipReputation: a proxy for 192.0.2.40, null elsewhere, never false', () => {
    expect(sandbox.ipReputation(at(SANDBOX_NETWORK.proxy))).toEqual({
      value: true,
      proxyType: 'public_proxy',
    });
    expect(sandbox.ipReputation(at('198.51.100.7'))).toEqual({ value: null, proxyType: null });
  });

  it('refuses data outside the documentation ranges and ASNs', () => {
    const outside = SPECIAL_BLOCKS.find((block) => block.class === 'not_public')?.network ?? '';
    expect(outside).not.toBe('');
    const pastDocumentation = (DOCUMENTATION_ASN_RANGES[0]?.[1] ?? 0) + 1;
    const cases: Buffer[] = [
      bundleWith((bundle) => {
        bundle['provider-ranges'] = [
          { network: outside, provider: 'example-cloud', service: null, region: null },
        ];
      }),
      bundleWith((bundle) => {
        bundle.proxies = [{ network: outside, 'proxy-type': 'public_proxy' }];
      }),
      bundleWith((bundle) => {
        bundle['vpn-asns'] = [pastDocumentation];
      }),
    ];
    for (const bytes of cases) {
      expect(codeOf(() => SandboxNetwork.parse(bytes))).toBe('sandbox');
    }
    expect(codeOf(() => SandboxNetwork.parse(bundleWith((bundle) => (bundle.version = 2))))).toBe(
      'format',
    );
    expect(codeOf(() => SandboxNetwork.parse(bundleWith((bundle) => (bundle.mmdb = {}))))).toBe(
      'format',
    );
    expect(codeOf(() => SandboxNetwork.parse('{'))).toBe('malformed');
  });

  it('knows the documentation ASNs (RFC 5398)', () => {
    expect(isDocumentationAsn(64496)).toBe(true);
    expect(isDocumentationAsn(64511)).toBe(true);
    expect(isDocumentationAsn(65536)).toBe(true);
    expect(isDocumentationAsn(65551)).toBe(true);
    expect(isDocumentationAsn(64496 - 1)).toBe(false);
    expect(isDocumentationAsn(65551 + 1)).toBe(false);
  });
});
