/**
 * The sandbox network data of C93.6, written as the `openverify-sandbox-network` bundle that
 * `seed:dev` imports with `network:sync --import` (C111.2). Every address is from the
 * documentation ranges, every AS number from the documentation ASNs, every point fictional
 * (open ocean in the South Pacific).
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../network/canonical.js';
import { writeMmdb, type MmdbEntry } from './mmdb-writer.js';

/** C93.6: the sandbox addresses and what each answers. */
export const SANDBOX_NETWORK = Object.freeze({
  publishedAt: '2026-01-01T00:00:00.000Z',
  torExit: '192.0.2.10',
  providerRange: '192.0.2.20',
  provider: 'example-cloud',
  vpnAsnAddress: '192.0.2.30',
  vpnAsn: 64500,
  proxy: '192.0.2.40',
  hostingAsnAddress: '192.0.2.50',
  hostingAsn: 64503,
  residentialNetwork: '198.51.100.0/24',
  residentialAsn: 64501,
  residentialOrganization: 'Example Residential',
  cityNetwork: '203.0.113.0/24',
  cityAsn: 64502,
  /** Two fictional points, so two sessions from the range can be apart. */
  cityPoints: Object.freeze([
    Object.freeze({
      network: '203.0.113.0/25',
      latitude: -30,
      longitude: -140,
      city: 'Example City',
    }),
    Object.freeze({
      network: '203.0.113.128/25',
      latitude: -30.5,
      longitude: -140.5,
      city: 'Example Harbour',
    }),
  ]),
  ipv6Network: '2001:db8::/48',
  country: 'ZZ',
  countryName: 'Example Land',
});

/** The rest of 192.0.2.0/24: one fictional network, so every sandbox address has an AS. */
const SANDBOX_ASN = { asn: 64504, organization: 'Example Sandbox Network' };
const REGION = { iso_code: 'ZZ-01', names: { en: 'Example Region' } };

function tdnselTime(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

/** The bundle, deterministic: the same bytes on every call. */
export function sandboxNetworkBundle(): Buffer {
  const published = new Date(SANDBOX_NETWORK.publishedAt);
  const fingerprint = createHash('sha256')
    .update('openverify-sandbox-network/tor-exit')
    .digest('hex')
    .slice(0, 40)
    .toUpperCase();
  const tor = [
    `ExitNode ${fingerprint}`,
    `Published ${tdnselTime(published)}`,
    `LastStatus ${tdnselTime(published)}`,
    `ExitAddress ${SANDBOX_NETWORK.torExit} ${tdnselTime(published)}`,
    '',
  ].join('\n');
  const country = {
    country: { iso_code: SANDBOX_NETWORK.country, names: { en: SANDBOX_NETWORK.countryName } },
  };
  const write = (databaseType: string, entries: readonly MmdbEntry[]) =>
    writeMmdb({ databaseType, buildEpoch: published, entries }).toString('base64');
  const asn = (number: number, organization: string) => ({
    autonomous_system_number: number,
    autonomous_system_organization: organization,
  });
  return Buffer.from(
    canonicalJson({
      format: 'openverify-sandbox-network',
      version: 1,
      'published-at': SANDBOX_NETWORK.publishedAt,
      'tor-exit-addresses': tor,
      'provider-ranges': [
        {
          network: `${SANDBOX_NETWORK.providerRange}/32`,
          provider: SANDBOX_NETWORK.provider,
          service: 'EXAMPLE_COMPUTE',
          region: 'example-1',
        },
      ],
      'relay-ranges': [],
      'hosting-asns': [SANDBOX_NETWORK.hostingAsn],
      'vpn-asns': [SANDBOX_NETWORK.vpnAsn],
      proxies: [{ network: `${SANDBOX_NETWORK.proxy}/32`, 'proxy-type': 'public_proxy' }],
      mmdb: {
        country: write(
          'OpenVerify-Sandbox-Country',
          [
            '192.0.2.0/24',
            SANDBOX_NETWORK.residentialNetwork,
            SANDBOX_NETWORK.cityNetwork,
            SANDBOX_NETWORK.ipv6Network,
          ].map((network) => ({ network, data: country })),
        ),
        asn: write('OpenVerify-Sandbox-ASN', [
          { network: '192.0.2.0/24', data: asn(SANDBOX_ASN.asn, SANDBOX_ASN.organization) },
          {
            network: `${SANDBOX_NETWORK.vpnAsnAddress}/32`,
            data: asn(SANDBOX_NETWORK.vpnAsn, 'Example VPN'),
          },
          {
            network: `${SANDBOX_NETWORK.hostingAsnAddress}/32`,
            data: asn(SANDBOX_NETWORK.hostingAsn, 'Example Hosting'),
          },
          {
            network: SANDBOX_NETWORK.residentialNetwork,
            data: asn(SANDBOX_NETWORK.residentialAsn, SANDBOX_NETWORK.residentialOrganization),
          },
          {
            network: SANDBOX_NETWORK.cityNetwork,
            data: asn(SANDBOX_NETWORK.cityAsn, 'Example Metro'),
          },
          {
            network: SANDBOX_NETWORK.ipv6Network,
            data: asn(SANDBOX_NETWORK.residentialAsn, SANDBOX_NETWORK.residentialOrganization),
          },
        ]),
        city: write(
          'OpenVerify-Sandbox-City',
          SANDBOX_NETWORK.cityPoints.map((point) => ({
            network: point.network,
            data: {
              ...country,
              city: { names: { en: point.city } },
              location: { latitude: point.latitude, longitude: point.longitude },
              subdivisions: [REGION],
            },
          })),
        ),
      },
    }),
  );
}
