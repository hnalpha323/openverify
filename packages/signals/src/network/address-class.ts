/**
 * C93.1: which addresses the network facts may describe. Private, loopback, link-local,
 * carrier-grade NAT and every other address that is not globally reachable gives every fact
 * `null` with `address_not_public`. The documentation ranges answer only in sandbox environments,
 * through the sandbox source (C93.6); in production they are `address_not_public` too.
 */
import { parseNetwork, type ParsedAddress } from './address.js';

export const ADDRESS_CLASSES = ['public', 'documentation', 'not_public'] as const;
export type AddressClass = (typeof ADDRESS_CLASSES)[number];

/** One special-purpose block, with the registry or RFC that names it. */
export interface SpecialBlock {
  readonly network: string;
  readonly class: Exclude<AddressClass, 'public'>;
  readonly source: string;
}

const IANA_V4 = 'IANA IPv4 Special-Purpose Address Registry (RFC 6890)';
const IANA_V6 = 'IANA IPv6 Special-Purpose Address Registry (RFC 6890)';

/**
 * The special-purpose blocks: every IPv4 block the IANA registry marks not globally reachable,
 * the documentation blocks, and the IPv6 blocks inside the global unicast space `2000::/3` that
 * are not globally reachable. An IPv6 address outside `2000::/3` (unspecified, loopback,
 * unique-local, link-local, multicast, NAT64, discard and the reserved space) is never public
 * ({@link classifyAddress}); its main blocks are listed too, for the reader. Where a registry
 * block holds a few globally reachable addresses (`192.0.0.0/24`, `2001::/23`), the whole block
 * is not public: a fact about a protocol relay describes the relay, not a person.
 */
export const SPECIAL_BLOCKS: readonly SpecialBlock[] = Object.freeze(
  (
    [
      ['0.0.0.0/8', 'not_public', `${IANA_V4}: "this network"`],
      ['10.0.0.0/8', 'not_public', `${IANA_V4}: private use (RFC 1918)`],
      [
        '100.64.0.0/10',
        'not_public',
        `${IANA_V4}: shared address space, carrier-grade NAT (RFC 6598)`,
      ],
      ['127.0.0.0/8', 'not_public', `${IANA_V4}: loopback (RFC 1122)`],
      ['169.254.0.0/16', 'not_public', `${IANA_V4}: link local (RFC 3927)`],
      ['172.16.0.0/12', 'not_public', `${IANA_V4}: private use (RFC 1918)`],
      ['192.0.0.0/24', 'not_public', `${IANA_V4}: IETF protocol assignments (RFC 6890)`],
      ['192.0.2.0/24', 'documentation', 'RFC 5737: TEST-NET-1'],
      ['192.88.99.0/24', 'not_public', `${IANA_V4}: deprecated 6to4 relay anycast (RFC 7526)`],
      ['192.168.0.0/16', 'not_public', `${IANA_V4}: private use (RFC 1918)`],
      ['198.18.0.0/15', 'not_public', `${IANA_V4}: benchmarking (RFC 2544)`],
      ['198.51.100.0/24', 'documentation', 'RFC 5737: TEST-NET-2'],
      ['203.0.113.0/24', 'documentation', 'RFC 5737: TEST-NET-3'],
      ['224.0.0.0/4', 'not_public', 'RFC 5771: multicast'],
      [
        '240.0.0.0/4',
        'not_public',
        `${IANA_V4}: reserved, and the limited broadcast address (RFC 1112, RFC 919)`,
      ],
      ['::/128', 'not_public', `${IANA_V6}: unspecified (RFC 4291)`],
      ['::1/128', 'not_public', `${IANA_V6}: loopback (RFC 4291)`],
      [
        '64:ff9b::/96',
        'not_public',
        `${IANA_V6}: IPv4-IPv6 translation (RFC 6052); the address is the translator's`,
      ],
      ['64:ff9b:1::/48', 'not_public', `${IANA_V6}: local-use IPv4-IPv6 translation (RFC 8215)`],
      ['100::/64', 'not_public', `${IANA_V6}: discard-only (RFC 6666)`],
      [
        '2001::/23',
        'not_public',
        `${IANA_V6}: IETF protocol assignments, Teredo among them (RFC 2928, RFC 4380)`,
      ],
      ['2001:db8::/32', 'documentation', 'RFC 3849: documentation'],
      ['2002::/16', 'not_public', `${IANA_V6}: 6to4 (RFC 3056); the address is the relay's`],
      ['3fff::/20', 'not_public', 'RFC 9637: documentation; not a sandbox range of C93.6'],
      ['5f00::/16', 'not_public', `${IANA_V6}: segment routing SIDs (RFC 9602)`],
      ['fc00::/7', 'not_public', `${IANA_V6}: unique-local (RFC 4193)`],
      ['fe80::/10', 'not_public', `${IANA_V6}: link-local unicast (RFC 4291)`],
      ['ff00::/8', 'not_public', 'RFC 4291: multicast'],
    ] as const
  ).map(([network, kind, source]) => Object.freeze({ network, class: kind, source })),
);

interface ParsedBlock {
  readonly start: bigint;
  readonly end: bigint;
  readonly class: SpecialBlock['class'];
}

const BLOCKS: readonly ParsedBlock[] = SPECIAL_BLOCKS.map((block) => {
  const network = parseNetwork(block.network);
  return { start: network.start, end: network.end, class: block.class };
});

/** The class of an address. */
export function classifyAddress(address: ParsedAddress): AddressClass {
  for (const block of BLOCKS) {
    if (address.key >= block.start && address.key <= block.end) {
      return block.class;
    }
  }
  // C93.1: IPv6 outside the global unicast space 2000::/3 is never public.
  if (address.family === 6 && address.key >> 125n !== 1n) {
    return 'not_public';
  }
  return 'public';
}
