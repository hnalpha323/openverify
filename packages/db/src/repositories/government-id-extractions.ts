/**
 * C31.7: one government ID extraction per verification. The worker (Workflow 3A `api-wiring`)
 * builds it from the vision analysis and writes it with {@link createGovernmentIdExtraction};
 * the API serves it as the C31.5 attributes, masked per principal (C31.6).
 *
 * - `fields` is sealed to its row (context `government_id_extractions.fields#<verification id>`)
 *   and opened on read; the repository returns plaintext and never logs it.
 * - `field_sources` names fields and sources only.
 * - The blind index (`identificationNumberIndex`, C31.8) and the perceptual hash with its eight
 *   generated bands (`front_phash_band_0..7`) serve the repeat lookups of C34. A Hamming distance
 *   up to 7 between two 64-bit hashes leaves at least one of the eight 8-bit bands equal
 *   (pigeonhole), so an equality lookup on the indexed bands misses no candidate within it.
 * - Redaction sets `fields`, the blind index and the hash (so its bands) to `null` and stamps
 *   `redacted_at`; `redactInquiryRecords` calls it for the inquiry's verifications.
 */
import {
  extractedFieldsSchema,
  extractionFieldSourcesSchema,
  type ExtractedFields,
  type ExtractionFieldSources,
} from '@openverify/core';
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { assertBlindIndexKey, extractionIndexOf, type IdClassGroup } from '../blind-index.js';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  governmentIdExtractions,
  inquiries,
  verifications,
  type GovernmentIdExtractionRow,
} from '../schema.js';
import { openJson, sealJson } from '../sealed.js';
import { firstOrNull } from './rows.js';

export interface GovernmentIdExtraction {
  environmentId: string;
  verificationId: string;
  /** The C31.5 fields; `null` after redaction. */
  fields: ExtractedFields | null;
  /** Per field, the sources that agreed: names only, kept after redaction. */
  fieldSources: ExtractionFieldSources;
  /** C31.8 HMAC-SHA-256 hex; `null` when there was no number, and after redaction. */
  identificationNumberIndex: string | null;
  /** 16 lowercase hex characters; `null` without a rectified front, and after redaction. */
  frontPhash: string | null;
  /** The eight bytes of `frontPhash`, as the database indexes them; `null` with it. */
  frontPhashBands: readonly number[] | null;
  /** The C31.8 class group of the blind index (the established ID class, or `unknown`). */
  idClassGroup: IdClassGroup;
  redactedAt: Date | null;
  createdAt: Date;
}

export interface NewGovernmentIdExtractionInput {
  verificationId: string;
  fields: ExtractedFields;
  fieldSources: ExtractionFieldSources;
  identificationNumberIndex: string | null;
  frontPhash: string | null;
  /**
   * The C31.8 class group the blind index was computed with: the established ID class, or
   * `unknown`. `blind-index:rebuild` recomputes the index from it. Defaults to `unknown`.
   */
  idClassGroup?: IdClassGroup | undefined;
}

/** Most pHash bits two fronts may differ by for the band lookup to find every match (C34). */
export const MAX_PHASH_LOOKUP_DISTANCE = 7;

/** At most this many candidates per lookup, newest first. */
export const DEFAULT_REPEAT_CANDIDATE_LIMIT = 100;

export interface RepeatLookupInput {
  /** The verification being processed: never a candidate of itself. */
  verificationId: string;
  /** The account of its inquiry: only extractions of other accounts are candidates (C34). */
  accountId: string;
  /** Its C31.8 blind index; `null` skips the number lookup. */
  identificationNumberIndex: string | null;
  /** Its front pHash; `null` skips the image lookup. */
  frontPhash: string | null;
  /** 0-7 (`max-phash-distance`); `null` skips the image lookup. */
  maxPhashDistance: number | null;
  limit?: number | undefined;
}

/** An earlier, unredacted extraction of another account that matched (C34). */
export interface RepeatCandidateRow {
  verificationId: string;
  sameIdentificationNumber: boolean;
  /** Hamming distance of the front pHashes, or `null` when either has none. */
  phashDistance: number | null;
}

export interface SameNumberLookupInput {
  verificationId: string;
  identificationNumberIndex: string;
  limit?: number | undefined;
}

/** An earlier, unredacted extraction with the same blind index, its identity decrypted (C34). */
export interface SameNumberExtraction {
  verificationId: string;
  inquiryId: string;
  fields: Pick<ExtractedFields, 'name-first' | 'name-last' | 'birthdate'>;
  createdAt: Date;
}

/** Default number of same-number extractions compared (each may be re-embedded, C31.9). */
export const DEFAULT_SAME_NUMBER_LIMIT = 20;

const DEFAULT_REBUILD_BATCH_SIZE = 100;

const BAND_COLUMNS = [
  governmentIdExtractions.frontPhashBand0,
  governmentIdExtractions.frontPhashBand1,
  governmentIdExtractions.frontPhashBand2,
  governmentIdExtractions.frontPhashBand3,
  governmentIdExtractions.frontPhashBand4,
  governmentIdExtractions.frontPhashBand5,
  governmentIdExtractions.frontPhashBand6,
  governmentIdExtractions.frontPhashBand7,
] as const;

/** The eight bytes of a 16-hex-character pHash, as its generated band columns hold them. */
function phashBytes(phash: string): number[] {
  if (!/^[0-9a-f]{16}$/.test(phash)) {
    throw new RangeError('A front pHash is 16 lowercase hex characters');
  }
  return Array.from({ length: BAND_COLUMNS.length }, (_, band) =>
    Number.parseInt(phash.slice(band * 2, band * 2 + 2), 16),
  );
}

/** Rows of the extraction table that belong to a verification of `environmentId`, unredacted. */
const unredactedIn = (environmentId: string, exclude: string): SQL | undefined =>
  and(
    eq(governmentIdExtractions.environmentId, environmentId),
    isNull(governmentIdExtractions.redactedAt),
    ne(governmentIdExtractions.verificationId, exclude),
  );

/**
 * C34 `id_repeat_detection` lookup: earlier extractions of this environment, not redacted, of
 * another account, with the same blind index or a front pHash within `maxPhashDistance` bits.
 * The pHash half uses the eight band indexes (pigeonhole), then filters the exact distance.
 * @throws {RangeError} for a distance outside 0-7, which the bands cannot guarantee.
 */
export async function findRepeatCandidates(
  db: Db,
  environmentId: string,
  input: RepeatLookupInput,
): Promise<RepeatCandidateRow[]> {
  const max = input.maxPhashDistance;
  if (max !== null && !(Number.isInteger(max) && max >= 0 && max <= MAX_PHASH_LOOKUP_DISTANCE)) {
    throw new RangeError(
      `max-phash-distance must be a whole number from 0 to ${String(MAX_PHASH_LOOKUP_DISTANCE)}`,
    );
  }
  const index = input.identificationNumberIndex;
  const phash = max === null ? null : input.frontPhash;
  if (index === null && phash === null) {
    return [];
  }
  const t = governmentIdExtractions;
  const distance =
    phash === null
      ? sql<number | null>`null::int`
      : sql<
          number | null
        >`bit_count(('x' || ${t.frontPhash})::bit(64) # ('x' || ${phash})::bit(64))::int`;
  const lookups: SQL[] = [];
  if (index !== null) {
    lookups.push(eq(t.identificationNumberIndex, index));
  }
  if (phash !== null) {
    const bytes = phashBytes(phash);
    const anyBand = or(...BAND_COLUMNS.map((column, band) => eq(column, bytes[band] ?? -1)));
    lookups.push(sql`(${anyBand}) and ${distance} <= ${max}`);
  }
  // The account of each candidate's inquiry, as a scalar subquery: Postgres runs it per row
  // that passed the index lookups and the exact distance (a few), through the primary keys,
  // where a join would be planned on the row estimate of the distance filter, which it cannot
  // know, and could scan every verification of the environment.
  const candidateAccount = sql<string>`(select ${inquiries.accountId} from ${verifications}
      join ${inquiries} on ${inquiries.environmentId} = ${verifications.environmentId}
        and ${inquiries.id} = ${verifications.inquiryId}
     where ${verifications.environmentId} = ${t.environmentId}
       and ${verifications.id} = ${t.verificationId})`;
  const rows = await db
    .select({
      verificationId: t.verificationId,
      sameIdentificationNumber:
        index === null
          ? sql<boolean>`false`
          : sql<boolean>`coalesce(${t.identificationNumberIndex} = ${index}, false)`,
      phashDistance: distance,
    })
    .from(t)
    .where(
      and(
        unredactedIn(environmentId, input.verificationId),
        or(...lookups),
        sql`${candidateAccount} <> ${input.accountId}`,
      ),
    )
    .orderBy(desc(t.createdAt), desc(t.verificationId))
    .limit(input.limit ?? DEFAULT_REPEAT_CANDIDATE_LIMIT);
  return rows;
}

/**
 * C34 `id_inconsistent_repeat_detection` lookup: earlier, unredacted extractions of this
 * environment with the same blind index (any account), newest first, with only the names and
 * the birth date decrypted.
 */
export async function findSameNumberExtractions(
  db: Db,
  environmentId: string,
  input: SameNumberLookupInput,
): Promise<SameNumberExtraction[]> {
  const t = governmentIdExtractions;
  const rows = await db
    .select({
      verificationId: t.verificationId,
      inquiryId: verifications.inquiryId,
      fieldsSealed: t.fieldsSealed,
      createdAt: t.createdAt,
    })
    .from(t)
    .innerJoin(
      verifications,
      and(eq(verifications.environmentId, t.environmentId), eq(verifications.id, t.verificationId)),
    )
    .where(
      and(
        unredactedIn(environmentId, input.verificationId),
        eq(t.identificationNumberIndex, input.identificationNumberIndex),
      ),
    )
    .orderBy(desc(t.createdAt), desc(t.verificationId))
    .limit(input.limit ?? DEFAULT_SAME_NUMBER_LIMIT);
  return rows.flatMap((row) => {
    if (row.fieldsSealed === null) {
      return [];
    }
    const fields = extractedFieldsSchema.parse(
      openJson(SEALED.governmentIdExtractionFields, row.verificationId, row.fieldsSealed),
    );
    return [
      {
        verificationId: row.verificationId,
        inquiryId: row.inquiryId,
        fields: {
          'name-first': fields['name-first'],
          'name-last': fields['name-last'],
          birthdate: fields.birthdate,
        },
        createdAt: row.createdAt,
      },
    ];
  });
}

/** The extractions of these verifications of this environment, by verification id. */
export async function listGovernmentIdExtractions(
  db: Db,
  environmentId: string,
  verificationIds: readonly string[],
): Promise<Map<string, GovernmentIdExtraction>> {
  if (verificationIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select()
    .from(governmentIdExtractions)
    .where(
      and(
        eq(governmentIdExtractions.environmentId, environmentId),
        inArray(governmentIdExtractions.verificationId, [...verificationIds]),
      ),
    );
  return new Map(rows.map((row) => [row.verificationId, toExtraction(row)]));
}

export interface RebuildIndexesOptions {
  /** Rows per transaction. Defaults to 100. */
  batchSize?: number | undefined;
}

export interface RebuildIndexesResult {
  /** Unredacted rows read. */
  scanned: number;
  /** Rows whose index changed. */
  updated: number;
}

/**
 * C31.8 `blind-index:rebuild`: recomputes the blind index of every unredacted extraction, in
 * every environment, under `key` (each row under its environment's subkey, G003), from its
 * decrypted fields and its class group. Each batch runs
 * in its own transaction and locks its rows, so a concurrent redaction waits for it (and then
 * clears the new index). Neither fields nor indexes are logged or returned.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes, before anything is read.
 */
export async function rebuildIdentificationNumberIndexes(
  db: Db,
  key: Uint8Array,
  options: RebuildIndexesOptions = {},
): Promise<RebuildIndexesResult> {
  assertBlindIndexKey(key);
  const batchSize = options.batchSize ?? DEFAULT_REBUILD_BATCH_SIZE;
  const t = governmentIdExtractions;
  let after = '';
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          environmentId: t.environmentId,
          verificationId: t.verificationId,
          fieldsSealed: t.fieldsSealed,
          idClassGroup: t.idClassGroup,
          identificationNumberIndex: t.identificationNumberIndex,
        })
        .from(t)
        .where(and(isNull(t.redactedAt), gt(t.verificationId, after)))
        .orderBy(asc(t.verificationId))
        .limit(batchSize)
        .for('update');
      let changed = 0;
      for (const row of rows) {
        if (row.fieldsSealed === null) {
          continue;
        }
        const fields = extractedFieldsSchema.parse(
          openJson(SEALED.governmentIdExtractionFields, row.verificationId, row.fieldsSealed),
        );
        const index = extractionIndexOf(key, {
          environmentId: row.environmentId,
          fields,
          classGroup: row.idClassGroup,
        });
        if (index !== row.identificationNumberIndex) {
          await tx
            .update(t)
            .set({ identificationNumberIndex: index })
            .where(eq(t.verificationId, row.verificationId));
          changed += 1;
        }
      }
      return { count: rows.length, changed, last: rows.at(-1)?.verificationId };
    });
    scanned += batch.count;
    updated += batch.changed;
    if (batch.last === undefined || batch.count < batchSize) {
      return { scanned, updated };
    }
    after = batch.last;
  }
}

function toExtraction(row: GovernmentIdExtractionRow): GovernmentIdExtraction {
  const bands = [
    row.frontPhashBand0,
    row.frontPhashBand1,
    row.frontPhashBand2,
    row.frontPhashBand3,
    row.frontPhashBand4,
    row.frontPhashBand5,
    row.frontPhashBand6,
    row.frontPhashBand7,
  ];
  return {
    environmentId: row.environmentId,
    verificationId: row.verificationId,
    fields:
      row.fieldsSealed === null
        ? null
        : extractedFieldsSchema.parse(
            openJson(SEALED.governmentIdExtractionFields, row.verificationId, row.fieldsSealed),
          ),
    fieldSources: extractionFieldSourcesSchema.parse(row.fieldSources),
    identificationNumberIndex: row.identificationNumberIndex,
    frontPhash: row.frontPhash,
    frontPhashBands: bands.every((band) => band !== null) ? bands : null,
    idClassGroup: row.idClassGroup,
    redactedAt: row.redactedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Stores the extraction of a government ID verification of this environment, replacing an
 * unredacted one written by an earlier attempt of the same job.
 * @throws {z.ZodError} when the fields or sources break C31.5.
 * @throws {Error} when the verification is not in this environment, or its extraction was
 * redacted (a redacted verification is never processed again).
 */
export async function createGovernmentIdExtraction(
  db: Db,
  environmentId: string,
  input: NewGovernmentIdExtractionInput,
): Promise<GovernmentIdExtraction> {
  const fields = extractedFieldsSchema.parse(input.fields);
  const fieldSources = extractionFieldSourcesSchema.parse(input.fieldSources);
  const written = {
    fieldsSealed: sealJson(SEALED.governmentIdExtractionFields, input.verificationId, fields),
    fieldSources,
    identificationNumberIndex: input.identificationNumberIndex,
    frontPhash: input.frontPhash,
    idClassGroup: input.idClassGroup ?? 'unknown',
  };
  const row = firstOrNull(
    await db
      .insert(governmentIdExtractions)
      .values({ environmentId, verificationId: input.verificationId, ...written })
      .onConflictDoUpdate({
        target: governmentIdExtractions.verificationId,
        set: written,
        setWhere: sql`${governmentIdExtractions.environmentId} = ${environmentId}
          and ${governmentIdExtractions.redactedAt} is null`,
      })
      .returning(),
  );
  if (row === null) {
    throw new Error(
      'createGovernmentIdExtraction: the verification is in another environment or redacted',
    );
  }
  return toExtraction(row);
}

/** The extraction of a verification of this environment, or `null` when there is none. */
export async function getGovernmentIdExtraction(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<GovernmentIdExtraction | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(governmentIdExtractions)
      .where(
        and(
          eq(governmentIdExtractions.environmentId, environmentId),
          eq(governmentIdExtractions.verificationId, verificationId),
        ),
      ),
  );
  return row === null ? null : toExtraction(row);
}

/**
 * C16/C31.7 redaction: clears the fields, the blind index and the perceptual hash (with its
 * bands) of these verifications' extractions, stamping `redacted_at`. Idempotent; returns how
 * many extractions it redacted now.
 */
export async function redactGovernmentIdExtractions(
  db: Db,
  environmentId: string,
  verificationIds: readonly string[],
  at: Date,
): Promise<number> {
  if (verificationIds.length === 0) {
    return 0;
  }
  const rows = await db
    .update(governmentIdExtractions)
    .set({ fieldsSealed: null, identificationNumberIndex: null, frontPhash: null, redactedAt: at })
    .where(
      and(
        eq(governmentIdExtractions.environmentId, environmentId),
        inArray(governmentIdExtractions.verificationId, [...verificationIds]),
        isNull(governmentIdExtractions.redactedAt),
      ),
    )
    .returning({ verificationId: governmentIdExtractions.verificationId });
  return rows.length;
}
