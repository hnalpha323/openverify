/**
 * MMDB access over `mmdb-lib` 3.0.3 (plan C92.3, C93.3, C93.5): DB-IP's Country, City and ASN Lite
 * files as published, and an operator-licensed anonymous-IP file for the `ipReputation` adapter.
 * The reader works on the file's own buffer, so a snapshot's memory is about its size.
 *
 * - {@link MmdbSnapshot.open} checks the metadata and the search tree's bounds: format 2, IP
 *   version 4 or 6, a record size of 24, 28 or 32, a database type that names the role, and the
 *   16-byte separator.
 * - {@link MmdbSnapshot.verify} walks every node and decodes every distinct record once, checking
 *   the role's shape: the sync's strict parse (C92.2 step 5).
 * - The lookups return normalised records, or `null` when the file holds none for the address.
 *   A record that breaks the role's shape, or a decoder failure, throws `mmdb`, so a corrupt file
 *   is never read as "not in the data".
 */
import { Reader } from 'mmdb-lib';
import { IPV4_MAPPED_START, type ParsedAddress } from './address.js';
import { NetworkParseError } from './errors.js';

export const MMDB_ROLES = ['country', 'city', 'asn', 'anonymous-ip'] as const;
export type MmdbRole = (typeof MMDB_ROLES)[number];

/** What a file says about itself. */
export interface MmdbMetadata {
  readonly databaseType: string;
  /** The `build_epoch`: the publication time (C92.2 step 6). */
  readonly buildEpoch: Date;
  readonly ipVersion: 4 | 6;
  readonly recordSize: 24 | 28 | 32;
  readonly nodeCount: number;
  /** The file's size, for the mass-removal guard (an MMDB under half the applied size). */
  readonly bytes: number;
}

/** What {@link MmdbSnapshot.verify} walked. */
export interface MmdbVerification {
  readonly nodes: number;
  /** Prefixes that lead to a record. */
  readonly prefixes: number;
  /** Distinct records, each decoded and checked once. */
  readonly records: number;
}

/** A country (DB-IP Country Lite, or City Lite's country). */
export interface MmdbCountry {
  readonly code: string;
  readonly name: string | null;
}

/** An AS (DB-IP ASN Lite). */
export interface MmdbAsn {
  readonly asn: number;
  readonly organization: string | null;
}

/** A coarse city point (DB-IP City Lite); approximate, with no accuracy radius. */
export interface MmdbCity {
  readonly country: MmdbCountry | null;
  readonly regionCode: string | null;
  readonly regionName: string | null;
  readonly cityName: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** An anonymous-IP record's flags (commercial files flag addresses; they rarely clear them). */
export interface MmdbAnonymousIp {
  readonly isAnonymous: boolean | null;
  readonly isAnonymousVpn: boolean | null;
  readonly isHostingProvider: boolean | null;
  readonly isPublicProxy: boolean | null;
  readonly isResidentialProxy: boolean | null;
  readonly isTorExitNode: boolean | null;
}

const METADATA_MARKER = Buffer.from('abcdef4d61784d696e642e636f6d', 'hex');
const SEPARATOR_BYTES = 16;
const MAX_ASN = 4_294_967_295;
const ROLE_TYPES: Readonly<Record<MmdbRole, RegExp>> = Object.freeze({
  country: /country/i,
  city: /city/i,
  asn: /asn/i,
  'anonymous-ip': /anonymous/i,
});
const COUNTRY_CODE = /^[A-Z]{2}$/;
const REGION_CODE = /^[\x21-\x7e]{1,16}$/;

/** Names and organisations: 1 to 200 characters, no control character. */
function isName(value: string): boolean {
  if (value.length === 0 || value.length > 200) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return true;
}

function refuse(message: string, cause?: unknown): never {
  throw new NetworkParseError('mmdb', message, { cause });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, where: string): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !isName(value)) {
    refuse(`${where} is not a name of 1 to 200 characters`);
  }
  return value;
}

function englishName(holder: unknown, where: string): string | null {
  if (holder === undefined) {
    return null;
  }
  if (!isObject(holder)) {
    refuse(`${where} is not a map`);
  }
  if (holder.names === undefined) {
    return null;
  }
  if (!isObject(holder.names)) {
    refuse(`${where}.names is not a map`);
  }
  return optionalText(holder.names.en, `${where}.names.en`);
}

function countryOf(record: Record<string, unknown>): MmdbCountry | null {
  const country = record.country;
  if (country === undefined) {
    return null;
  }
  if (!isObject(country)) {
    refuse('country is not a map');
  }
  if (country.iso_code === undefined) {
    return null;
  }
  if (typeof country.iso_code !== 'string' || !COUNTRY_CODE.test(country.iso_code)) {
    refuse('country.iso_code is not ISO 3166-1 alpha-2');
  }
  return { code: country.iso_code, name: englishName(country, 'country') };
}

function asnOf(record: Record<string, unknown>): MmdbAsn {
  const asn = record.autonomous_system_number;
  if (typeof asn !== 'number' || !Number.isInteger(asn) || asn < 1 || asn > MAX_ASN) {
    refuse('autonomous_system_number is not an AS number');
  }
  return {
    asn,
    organization: optionalText(
      record.autonomous_system_organization,
      'autonomous_system_organization',
    ),
  };
}

function coordinate(value: unknown, limit: number, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    refuse(`${where} is not a coordinate`);
  }
  return value;
}

function cityOf(record: Record<string, unknown>): MmdbCity {
  let regionCode: string | null = null;
  let regionName: string | null = null;
  if (record.subdivisions !== undefined) {
    if (!Array.isArray(record.subdivisions)) {
      refuse('subdivisions is not an array');
    }
    const first: unknown = record.subdivisions[0];
    if (first !== undefined) {
      if (!isObject(first)) {
        refuse('subdivisions[0] is not a map');
      }
      if (first.iso_code !== undefined) {
        if (typeof first.iso_code !== 'string' || !REGION_CODE.test(first.iso_code)) {
          refuse('subdivisions[0].iso_code is not a region code');
        }
        regionCode = first.iso_code;
      }
      regionName = englishName(first, 'subdivisions[0]');
    }
  }
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (record.location !== undefined) {
    if (!isObject(record.location)) {
      refuse('location is not a map');
    }
    latitude = coordinate(record.location.latitude, 90, 'location.latitude');
    longitude = coordinate(record.location.longitude, 180, 'location.longitude');
  }
  return {
    country: countryOf(record),
    regionCode,
    regionName,
    cityName: englishName(record.city, 'city'),
    latitude,
    longitude,
  };
}

function flag(record: Record<string, unknown>, member: string): boolean | null {
  const value = record[member];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'boolean') {
    refuse(`${member} is not a boolean`);
  }
  return value;
}

function anonymousOf(record: Record<string, unknown>): MmdbAnonymousIp {
  return {
    isAnonymous: flag(record, 'is_anonymous'),
    isAnonymousVpn: flag(record, 'is_anonymous_vpn'),
    isHostingProvider: flag(record, 'is_hosting_provider'),
    isPublicProxy: flag(record, 'is_public_proxy'),
    isResidentialProxy: flag(record, 'is_residential_proxy'),
    isTorExitNode: flag(record, 'is_tor_exit_node'),
  };
}

/** Checks a record against its role, returning its normalised form. */
function checkRecord(role: MmdbRole, record: unknown): unknown {
  if (!isObject(record)) {
    refuse('a record is not a map');
  }
  switch (role) {
    case 'country':
      return countryOf(record);
    case 'city':
      return cityOf(record);
    case 'asn':
      return asnOf(record);
    case 'anonymous-ip':
      return anonymousOf(record);
  }
}

/** One MMDB file, opened for one role. */
export class MmdbSnapshot {
  readonly kind = 'mmdb' as const;
  readonly #role: MmdbRole;
  readonly #reader: Reader<Record<string, unknown>>;
  readonly #buffer: Buffer;
  readonly #metadata: MmdbMetadata;
  readonly #dataSize: number;

  private constructor(
    role: MmdbRole,
    reader: Reader<Record<string, unknown>>,
    buffer: Buffer,
    metadata: MmdbMetadata,
    dataSize: number,
  ) {
    this.#role = role;
    this.#reader = reader;
    this.#buffer = buffer;
    this.#metadata = metadata;
    this.#dataSize = dataSize;
  }

  /**
   * Opens a file for a role.
   * @throws {NetworkParseError} `mmdb` for a file that is not a sound MaxMind DB of that role.
   */
  static open(bytes: Uint8Array, role: MmdbRole): MmdbSnapshot {
    const buffer = Buffer.isBuffer(bytes)
      ? bytes
      : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const marker = buffer.lastIndexOf(METADATA_MARKER);
    if (marker < 0) {
      refuse('no MaxMind DB metadata marker');
    }
    let reader: Reader<Record<string, unknown>>;
    try {
      reader = new Reader<Record<string, unknown>>(buffer);
    } catch (error) {
      refuse('the metadata or the tree does not decode', error);
    }
    const found = reader.metadata as Partial<Reader<Record<string, unknown>>['metadata']>;
    const { binaryFormatMajorVersion, ipVersion, recordSize, nodeCount, databaseType, buildEpoch } =
      found;
    if (binaryFormatMajorVersion !== 2) {
      refuse('not binary format 2');
    }
    if (ipVersion !== 4 && ipVersion !== 6) {
      refuse('ip_version is not 4 or 6');
    }
    if (recordSize !== 24 && recordSize !== 28 && recordSize !== 32) {
      refuse('record_size is not 24, 28 or 32');
    }
    if (typeof nodeCount !== 'number' || !Number.isInteger(nodeCount) || nodeCount < 1) {
      refuse('node_count is not a positive integer');
    }
    if (typeof databaseType !== 'string' || !ROLE_TYPES[role].test(databaseType)) {
      refuse(`database_type does not name a ${role} database`);
    }
    if (!(buildEpoch instanceof Date) || Number.isNaN(buildEpoch.getTime())) {
      refuse('build_epoch is not a time');
    }
    const treeSize = (nodeCount * recordSize) / 4;
    if (treeSize + SEPARATOR_BYTES > marker) {
      refuse('the search tree runs past the data section');
    }
    if (buffer.subarray(treeSize, treeSize + SEPARATOR_BYTES).some((byte) => byte !== 0)) {
      refuse('the data section separator is not 16 zero bytes');
    }
    return new MmdbSnapshot(
      role,
      reader,
      buffer,
      { databaseType, buildEpoch, ipVersion, recordSize, nodeCount, bytes: buffer.length },
      marker - treeSize - SEPARATOR_BYTES,
    );
  }

  get role(): MmdbRole {
    return this.#role;
  }

  get metadata(): MmdbMetadata {
    return this.#metadata;
  }

  /** The `build_epoch`. */
  get publishedAt(): Date {
    return new Date(this.#metadata.buildEpoch.getTime());
  }

  #records(offset: number): [number, number] {
    const buffer = this.#buffer;
    switch (this.#metadata.recordSize) {
      case 24:
        return [buffer.readUIntBE(offset, 3), buffer.readUIntBE(offset + 3, 3)];
      case 28:
        return [
          (((buffer[offset + 3] ?? 0) & 0xf0) << 20) | buffer.readUIntBE(offset, 3),
          (((buffer[offset + 3] ?? 0) & 0x0f) << 24) | buffer.readUIntBE(offset + 4, 3),
        ];
      case 32:
        return [buffer.readUInt32BE(offset), buffer.readUInt32BE(offset + 4)];
    }
  }

  /** The address text that walks exactly a path of the tree. */
  #pathText(bits: bigint, width: number): string {
    if (width === 32) {
      return [24n, 16n, 8n, 0n].map((shift) => String((bits >> shift) & 0xffn)).join('.');
    }
    return Array.from({ length: 8 }, (_, index) =>
      ((bits >> BigInt(112 - 16 * index)) & 0xffffn).toString(16),
    ).join(':');
  }

  /**
   * Walks the whole tree and checks every record against the role. `visit`, when given, sees each
   * prefix that leads to a record, as a closed key range (IPv4 in the IPv4-mapped space), with
   * its normalised record (the sandbox parser checks its prefixes and ASNs with it).
   * @throws {NetworkParseError} `mmdb`.
   */
  verify(visit?: (record: unknown, start: bigint, end: bigint) => void): MmdbVerification {
    const { nodeCount, recordSize, ipVersion } = this.#metadata;
    const width = ipVersion === 6 ? 128 : 32;
    const nodeBytes = recordSize / 4;
    const visited = new Uint8Array(nodeCount);
    const decoded = new Map<number, unknown>();
    let prefixes = 0;
    let nodes = 0;
    const stack: { node: number; depth: number; bits: bigint }[] = [
      { node: 0, depth: 0, bits: 0n },
    ];
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      const { node, depth, bits } = item;
      if (visited[node] === 1) {
        continue;
      }
      visited[node] = 1;
      nodes += 1;
      const [left, right] = this.#records(node * nodeBytes);
      for (const [bit, value] of [
        [0n, left],
        [1n, right],
      ] as const) {
        const path = bits | (bit << BigInt(width - 1 - depth));
        if (value < nodeCount) {
          if (depth + 1 >= width) {
            refuse('a path runs deeper than the address');
          }
          stack.push({ node: value, depth: depth + 1, bits: path });
        } else if (value > nodeCount) {
          const offset = value - nodeCount - SEPARATOR_BYTES;
          if (offset < 0 || offset >= this.#dataSize) {
            refuse('a record points outside the data section');
          }
          prefixes += 1;
          let record = decoded.get(value);
          if (record === undefined) {
            record = this.#checked(this.#pathText(path, width));
            decoded.set(value, record);
          }
          if (visit !== undefined) {
            const end = path | ((1n << BigInt(width - depth - 1)) - 1n);
            // IPv4 sits at ::a.b.c.d in an IPv6 tree; the visitor sees it in the IPv4-mapped space.
            const ipv4 = width === 32 || end <= 0xffff_ffffn;
            visit(
              record,
              ipv4 ? path + IPV4_MAPPED_START : path,
              ipv4 ? end + IPV4_MAPPED_START : end,
            );
          }
        }
      }
    }
    return { nodes, prefixes, records: decoded.size };
  }

  /** The checked, normalised record at an address text, or `null`. */
  #checked(text: string): unknown {
    let record: unknown;
    try {
      record = this.#reader.get(text);
    } catch (error) {
      refuse('a record does not decode', error);
    }
    return record === null ? null : checkRecord(this.#role, record);
  }

  #textOf(address: ParsedAddress): string | null {
    if (address.family === 6 && this.#metadata.ipVersion === 4) {
      return null;
    }
    return address.text;
  }

  /** The record for an address, as the format's reader decodes it, or `null`. */
  raw(address: ParsedAddress): unknown {
    const text = this.#textOf(address);
    if (text === null) {
      return null;
    }
    try {
      return this.#reader.get(text);
    } catch (error) {
      refuse('a record does not decode', error);
    }
  }

  /** The normalised record for an address, after the role's check, or `null`. */
  normalised(address: ParsedAddress, roles: readonly MmdbRole[]): unknown {
    if (!roles.includes(this.#role)) {
      throw new RangeError(`a ${this.#role} file cannot answer this lookup`);
    }
    const text = this.#textOf(address);
    return text === null ? null : this.#checked(text);
  }
}

/** The country of an address (a `country` or `city` file). */
export function lookupCountry(snapshot: MmdbSnapshot, address: ParsedAddress): MmdbCountry | null {
  const record = snapshot.normalised(address, ['country', 'city']);
  if (record === null) {
    return null;
  }
  return snapshot.role === 'city' ? (record as MmdbCity).country : (record as MmdbCountry | null);
}

/** The AS of an address (an `asn` file). */
export function lookupAsn(snapshot: MmdbSnapshot, address: ParsedAddress): MmdbAsn | null {
  return snapshot.normalised(address, ['asn']) as MmdbAsn | null;
}

/** The city point of an address (a `city` file). */
export function lookupCity(snapshot: MmdbSnapshot, address: ParsedAddress): MmdbCity | null {
  return snapshot.normalised(address, ['city']) as MmdbCity | null;
}

/** The anonymous-IP flags of an address (an `anonymous-ip` file). */
export function lookupAnonymousIp(
  snapshot: MmdbSnapshot,
  address: ParsedAddress,
): MmdbAnonymousIp | null {
  return snapshot.normalised(address, ['anonymous-ip']) as MmdbAnonymousIp | null;
}

/**
 * C93.5: the `ipReputation` file adapter's answer from a record. `true` when any anonymiser flag
 * is set (a hosting flag alone is not a proxy); `false` only when the record positively clears
 * every anonymiser flag; otherwise `null` (`not_in_provider_data`). `proxyType` names the most
 * specific flag set.
 */
export function anonymousIpAnswer(record: MmdbAnonymousIp | null): {
  readonly value: boolean | null;
  readonly proxyType: string | null;
} {
  if (record === null) {
    return { value: null, proxyType: null };
  }
  const kinds: [boolean | null, string][] = [
    [record.isResidentialProxy, 'residential_proxy'],
    [record.isPublicProxy, 'public_proxy'],
    [record.isAnonymousVpn, 'vpn'],
    [record.isTorExitNode, 'tor'],
    [record.isAnonymous, 'anonymous'],
  ];
  const set = kinds.find(([value]) => value === true);
  if (set !== undefined) {
    return { value: true, proxyType: set[1] };
  }
  return kinds.every(([value]) => value === false)
    ? { value: false, proxyType: null }
    : { value: null, proxyType: null };
}
