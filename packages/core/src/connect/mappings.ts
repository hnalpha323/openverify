/**
 * C234.5, C234.6 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 3): a hydrate's field
 * resolution, pure. Fields only, and only the policy's allowlisted ones; matched by name, then by
 * the public `meta.field-mappings`.
 */
import type { ShareFieldType } from './categories.js';

/** One field of the source object as the source holds it now (C234.7). */
export interface HydrateSourceField {
  readonly key: string;
  readonly type: ShareFieldType;
  readonly value: unknown;
}

/**
 * One field the destination object declares (its template's, account type's or transaction type's
 * fields; a nested one by its dotted name), with Phase 9's write-once rule as input: `writeOnce`
 * with `filled` refuses a write (`field_write_once`).
 */
export interface HydrateDestinationField {
  readonly name: string;
  readonly type: ShareFieldType;
  readonly writeOnce: boolean;
  readonly filled: boolean;
}

/** One `meta.field-mappings` entry (C234.1, the public names). */
export interface HydrateFieldMapping {
  readonly 'source-field-name': string;
  readonly 'destination-field-name': string;
}

export interface HydrateMappingInput {
  /** The token's policy version's allowlist for the source object's type. */
  readonly allowlist: readonly string[];
  readonly source: readonly HydrateSourceField[];
  readonly destination: readonly HydrateDestinationField[];
  readonly mappings: readonly HydrateFieldMapping[];
}

/** One value to write. */
export interface HydrateWrite {
  readonly sourceKey: string;
  readonly destinationName: string;
  readonly matchedBy: 'name' | 'mapping';
  readonly value: unknown;
}

/** Why an explicit mapping fails the redemption (`import_failed`, C234.5). */
export const HYDRATE_MAPPING_FAILURES = Object.freeze([
  'destination_not_declared',
  'destination_mapped_twice',
  'type_mismatch',
  'write_once',
] as const);
export type HydrateMappingFailureReason = (typeof HYDRATE_MAPPING_FAILURES)[number];

export interface HydrateMappingFailure {
  readonly sourceKey: string;
  readonly destinationName: string;
  readonly reason: HydrateMappingFailureReason;
}

export interface HydrateMappingResolution {
  readonly writes: readonly HydrateWrite[];
  /** `redeem-summary.dropped-fields`: keys only, distinct and sorted. */
  readonly dropped: readonly string[];
  readonly failures: readonly HydrateMappingFailure[];
}

const held = (value: unknown): boolean => value !== null && value !== undefined;

/**
 * C234.5, C234.6: what a hydrate writes, drops and fails on, in two passes.
 *
 * 1. Each `meta.field-mappings` entry, in order. A source key outside the allowlist, or that the
 *    source does not hold, is dropped (named, since the destination named it). Otherwise the mapping
 *    fails the redemption (`import_failed`) when its destination is not declared, was already
 *    mapped, is of another type, or is a filled write-once field the mapping has a value for; else
 *    it writes the value (when the source holds one) and takes the destination.
 * 2. Each allowlisted source field no mapping names, by name: written when the destination declares
 *    a field of that name and type that no mapping took and that is not a filled write-once field;
 *    else, when the source holds a value, dropped.
 *
 * A key outside the allowlist that no mapping names is never written or named. `dropped` is
 * `redeem-summary.dropped-fields`: keys only, distinct and sorted. A value's own validation (a
 * choice, a format) is the destination's validator's, which `api-redeem` runs on every write.
 */
export function resolveHydrateMappings(input: HydrateMappingInput): HydrateMappingResolution {
  const allowed = new Set(input.allowlist);
  const shared = new Map(
    input.source.filter((entry) => allowed.has(entry.key)).map((entry) => [entry.key, entry]),
  );
  const declared = new Map(input.destination.map((entry) => [entry.name, entry]));
  const taken = new Set<string>();
  const writes: HydrateWrite[] = [];
  const failures: HydrateMappingFailure[] = [];
  const dropped = new Set<string>();
  const mapped = new Set<string>();

  for (const mapping of input.mappings) {
    const sourceKey = mapping['source-field-name'];
    const destinationName = mapping['destination-field-name'];
    mapped.add(sourceKey);
    const from = shared.get(sourceKey);
    if (from === undefined) {
      dropped.add(sourceKey);
      continue;
    }
    const to = declared.get(destinationName);
    const reason: HydrateMappingFailureReason | null =
      to === undefined
        ? 'destination_not_declared'
        : taken.has(destinationName)
          ? 'destination_mapped_twice'
          : to.type !== from.type
            ? 'type_mismatch'
            : to.writeOnce && to.filled && held(from.value)
              ? 'write_once'
              : null;
    if (reason !== null) {
      failures.push({ sourceKey, destinationName, reason });
      continue;
    }
    taken.add(destinationName);
    if (held(from.value)) {
      writes.push({ sourceKey, destinationName, matchedBy: 'mapping', value: from.value });
    }
  }

  for (const from of shared.values()) {
    if (mapped.has(from.key) || !held(from.value)) {
      continue;
    }
    const to = declared.get(from.key);
    if (to?.type !== from.type || taken.has(from.key) || (to.writeOnce && to.filled)) {
      dropped.add(from.key);
      continue;
    }
    taken.add(from.key);
    writes.push({
      sourceKey: from.key,
      destinationName: from.key,
      matchedBy: 'name',
      value: from.value,
    });
  }

  return { writes, dropped: [...dropped].sort(), failures };
}
