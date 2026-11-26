/**
 * C92.6: the pinned hosting and VPN ASN seeds and the committed overrides, which the VPN and
 * hosting-ASN flags read (C93.3, H-tier, `beta`).
 *
 * - The seeds are `data/x4bnet-datacenter-ASN.txt`, `data/x4bnet-vpn-ASN.txt` (X4BNet `lists_vpn`)
 *   and `data/bad-asn-list.csv`, fetched by `python3 scripts/fetch_data.py` and gitignored. Each is
 *   checked against its SHA-256 in `data/manifest.json` before it is read: a missing seed answers
 *   `missing`, another digest `unexpected`, and either leaves every ASN flag `null` with
 *   `list_unavailable` (never a guess from a partial list).
 * - Hosting is the X4BNet datacenter seed plus bad-asn-list; VPN is the X4BNet VPN seed; each less
 *   and plus `network/asn-overrides.json` (committed, ours: one row per ASN and list, with its
 *   evidence; it starts empty).
 *
 * Loaded once per process and per path while it loads. A missing or unexpected answer is kept with
 * the size and modification time of the manifest and the seeds, so a session start re-reads nothing
 * until one of them changes, and a seed fetched or corrected later is seen on the next call
 * (KP11-91, 7C review R010). Owner: `api-network` (Workflow 7A Stage 3).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAsnSets,
  parseBadAsnList,
  parseX4bnetAsnList,
  type AsnSeed,
  type AsnSets,
} from '@openverify/signals/network';
import { z } from 'zod';

/** The overrides file's format name. */
export const ASN_OVERRIDES_FORMAT = 'openverify/asn-overrides/v1';

/** One override row: an ASN added to or removed from a list, with its evidence. */
export interface AsnOverrideRow {
  asn: number;
  list: 'hosting' | 'vpn';
  action: 'add' | 'remove';
  evidence: string;
}

export interface AsnOverrides {
  $comment?: string | undefined;
  format: typeof ASN_OVERRIDES_FORMAT;
  overrides: AsnOverrideRow[];
}

/** The ASN sets, or why there are none (`list_unavailable` for every ASN flag). */
export type AsnData =
  | { status: 'loaded'; sets: AsnSets; counts: { hosting: number; vpn: number } }
  | { status: 'missing' | 'unexpected'; files: string[] };

export interface AsnDataPaths {
  /** `data/` at the repository (or image) root. */
  dataDirectory: string;
  /** `network/asn-overrides.json`. */
  overridesPath: string;
}

const overrideRowSchema = z.strictObject({
  asn: z.int().min(1).max(4_294_967_295),
  list: z.enum(['hosting', 'vpn']),
  action: z.enum(['add', 'remove']),
  /** Why: a public source or an observation, never a subject's data. */
  evidence: z.string().min(1).max(500),
});

const overridesSchema = z.strictObject({
  $comment: z.string().optional(),
  format: z.literal(ASN_OVERRIDES_FORMAT),
  overrides: z
    .array(overrideRowSchema)
    .max(10_000)
    .refine(
      (rows) => new Set(rows.map((row) => `${String(row.asn)}/${row.list}`)).size === rows.length,
      { message: 'an ASN is overridden twice in one list' },
    ),
});

/**
 * Validates a parsed overrides document.
 * @throws {z.ZodError} for a row without evidence, an unknown list, a bad ASN or a repeated row.
 */
export function parseAsnOverrides(value: unknown): AsnOverrides {
  return overridesSchema.parse(value);
}

/** The repository (or image) root: four levels above this module from `src/` or `dist/`. */
const root = () => resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** `data/` and `network/asn-overrides.json` at the repository (or image) root. */
export function defaultAsnDataPaths(): AsnDataPaths {
  return {
    dataDirectory: join(root(), 'data'),
    overridesPath: join(root(), 'network', 'asn-overrides.json'),
  };
}

/** The seeds, by their `data/manifest.json` name, and how each is parsed. */
const SEEDS = [
  { name: 'x4bnet_datacenter_asns', list: 'hosting', parse: parseX4bnetAsnList },
  { name: 'bad_asn_list', list: 'hosting', parse: parseBadAsnList },
  { name: 'x4bnet_vpn_asns', list: 'vpn', parse: parseX4bnetAsnList },
] as const;

const manifestSchema = z.object({
  data: z.array(z.object({ name: z.string(), filename: z.string(), sha256: z.string() })),
});

const loaded = new Map<string, AsnData>();
/**
 * KP11-91 (7C review R010): a missing or unexpected answer, kept with the size and modification
 * time of the manifest and each seed it looked at, so a session start re-reads nothing until one
 * of those files changes (a seed fetched or corrected, a manifest naming a new digest).
 */
const refused = new Map<string, { data: AsnData; files: readonly string[]; stamp: string }>();

/** Each file's size and modification time, or `absent`: cheap beside reading and hashing it. */
function stampOf(files: readonly string[]): string {
  return files
    .map((file) => {
      const stat = statSync(file, { bigint: true, throwIfNoEntry: false });
      return stat === undefined
        ? 'absent'
        : `${String(stat.size)}:${String(stat.mtimeNs)}:${String(stat.ctimeNs)}`;
    })
    .join('|');
}

/** Loads the seeds and the overrides; see the file header. */
export function loadAsnData(paths: AsnDataPaths = defaultAsnDataPaths()): AsnData {
  const key = `${paths.dataDirectory}\u0000${paths.overridesPath}`;
  const cached = loaded.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const earlier = refused.get(key);
  if (earlier !== undefined) {
    if (stampOf(earlier.files) === earlier.stamp) {
      return earlier.data;
    }
  }
  const manifestPath = join(paths.dataDirectory, 'manifest.json');
  const looked: string[] = [manifestPath];
  const stamp = stampOf(looked);
  const pins = new Map(
    manifestSchema
      .parse(JSON.parse(readFileSync(manifestPath, 'utf8')))
      .data.map((entry) => [entry.name, entry]),
  );
  const missing: string[] = [];
  const unexpected: string[] = [];
  const seeds: { list: 'hosting' | 'vpn'; seed: AsnSeed }[] = [];
  for (const { name, list, parse } of SEEDS) {
    const pin = pins.get(name);
    if (pin === undefined) {
      throw new Error(`data/manifest.json has no ${name} entry`);
    }
    const path = join(paths.dataDirectory, pin.filename);
    looked.push(path);
    if (!existsSync(path)) {
      missing.push(pin.filename);
      continue;
    }
    const bytes = readFileSync(path);
    if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) {
      unexpected.push(pin.filename);
      continue;
    }
    seeds.push({ list, seed: parse(bytes) });
  }
  if (unexpected.length > 0 || missing.length > 0) {
    const data: AsnData =
      unexpected.length > 0
        ? { status: 'unexpected', files: unexpected }
        : { status: 'missing', files: missing };
    // The manifest is stamped before it was read, so one rewritten meanwhile is read again.
    refused.set(key, { data, files: looked, stamp: `${stamp}|${stampOf(looked.slice(1))}` });
    return data;
  }
  refused.delete(key);
  const overrides = parseAsnOverrides(JSON.parse(readFileSync(paths.overridesPath, 'utf8')));
  const sets = buildAsnSets({
    hosting: seeds.filter(({ list }) => list === 'hosting').map(({ seed }) => seed),
    vpn: seeds.filter(({ list }) => list === 'vpn').map(({ seed }) => seed),
    overrides: overrides.overrides.map(({ asn, list, action }) => ({ asn, list, action })),
  });
  const data: AsnData = {
    status: 'loaded',
    sets,
    counts: { hosting: sets.hosting.size, vpn: sets.vpn.size },
  };
  loaded.set(key, data);
  return data;
}
