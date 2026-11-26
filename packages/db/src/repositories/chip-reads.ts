/**
 * C53.3, C62.6: what one NFC verification read from a chip once its integrity was established:
 * the DG1 fields and the SOD signature, sealed to the row (`chip_reads.<column>#<verification
 * id>`), their blind indexes (`openverify/chip-sod/v1`, `openverify/chip-document-number/v1`),
 * the non-PII Passive Authentication summary, and `selfie_bound`, set in the decision transaction
 * once the NFC selfie comparison passed and the verification ended `passed` or `needs_review`.
 *
 * Workflow 5B Stage 1 (`contracts-5b`) wrote this file, the reads the attributes use, redaction
 * and the index rebuild; `api-nfc` owns it and adds the write and the C62.6 sighting lookup.
 */
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { assertBlindIndexKey, chipDocumentNumberIndex, chipSodIndex } from '../blind-index.js';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson, openValue, sealJson, sealValue } from '../sealed.js';
import { chipReads, inquiries, type ChipReadRow } from '../schema.js';
import type { RebuildIndexesOptions, RebuildIndexesResult } from './government-id-extractions.js';
import { firstOrNull } from './rows.js';

/** Rows per rebuild transaction, as the extractions' rebuild. */
const DEFAULT_REBUILD_BATCH_SIZE = 100;

/** The DG1 field the document number index reads (C52.8 `government-id-nfc`). */
const DOCUMENT_NUMBER_FIELD = 'identification-number';

/** C62.2: whether the chip data's integrity was established, broken, or neither. */
export type ChipReadIntegrity = 'established' | 'broken' | 'not_established';

/** A chip read without its sealed values. Not PII. */
export interface ChipRead {
  verificationId: string;
  inquiryId: string;
  integrity: ChipReadIntegrity;
  selfieBound: boolean;
  /** DG1's issuing state, ICAO alpha-3; `null` once redacted. */
  issuingCountry: string | null;
  /** The non-PII PA summary (`@openverify/emrtd` `PassiveAuthenticationReport`, as JSON). */
  paSummary: Readonly<Record<string, unknown>>;
  sodSignatureIndex: string | null;
  documentNumberIndex: string | null;
  createdAt: Date;
  redactedAt: Date | null;
}

/** The sealed values, opened. PII. */
export interface ChipReadEvidence {
  /** The DG1 fields (C52.8 `government-id-nfc` attribute names), never DG2. */
  fields: Readonly<Record<string, string | null>>;
  /** The SOD signature value. */
  sodSignature: Uint8Array;
}

function toChipRead(row: ChipReadRow): ChipRead {
  return {
    verificationId: row.verificationId,
    inquiryId: row.inquiryId,
    integrity: row.integrity,
    selfieBound: row.selfieBound,
    issuingCountry: row.issuingCountry,
    paSummary: row.paSummary,
    sodSignatureIndex: row.sodSignatureIndex,
    documentNumberIndex: row.documentNumberIndex,
    createdAt: row.createdAt,
    redactedAt: row.redactedAt,
  };
}

const ofVerification = (environmentId: string, verificationId: string) =>
  and(eq(chipReads.environmentId, environmentId), eq(chipReads.verificationId, verificationId));

type Fields = Readonly<Record<string, string | null>>;

export async function getChipRead(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<ChipRead | null> {
  const row = firstOrNull(
    await db.select().from(chipReads).where(ofVerification(environmentId, verificationId)),
  );
  return row === null ? null : toChipRead(row);
}

/** The sealed values, opened; `null` when not found or redacted. PII. */
export async function openChipReadEvidence(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<ChipReadEvidence | null> {
  const row = firstOrNull(
    await db
      .select({ fields: chipReads.fieldsSealed, sodSignature: chipReads.sodSignatureSealed })
      .from(chipReads)
      .where(ofVerification(environmentId, verificationId)),
  );
  if (row?.fields == null || row.sodSignature === null) {
    return null;
  }
  return {
    fields: openJson(SEALED.chipReadFields, verificationId, row.fields) as Fields,
    sodSignature: new Uint8Array(
      Buffer.from(
        openValue(SEALED.chipReadSodSignature, verificationId, row.sodSignature),
        'base64',
      ),
    ),
  };
}

// The write and the sighting lookup (api-nfc, C62.6) --------------------------------------------

/** What the NFC job's decision writes once the chip's integrity was established (C62.6). */
export interface NewChipRead {
  verificationId: string;
  inquiryId: string;
  /** DG1's fields (C52.8 attribute names). Sealed; PII. */
  fields: Readonly<Record<string, string | null>>;
  /** The SOD's signature value. Sealed; indexed (`openverify/chip-sod/v1`). */
  sodSignature: Uint8Array;
  /** DG1's issuing state, ICAO alpha-3 (`UTO`, `D<<`); indexed with the document number. */
  issuingCountry: string | null;
  integrity: ChipReadIntegrity;
  /** C62.6: the NFC selfie comparison passed and the verification ended passed or needs_review. */
  selfieBound: boolean;
  /** The non-PII Passive Authentication summary. */
  paSummary: Readonly<Record<string, unknown>>;
  /** The environment subkey's root (`OPENVERIFY_BLIND_INDEX_KEY`). */
  blindIndexKey: Uint8Array;
  at: Date;
}

/** The read's document number index, or `null` without a number or an issuing state. */
function documentNumberIndexOf(
  key: Uint8Array,
  environmentId: string,
  fields: Fields,
  issuingCountry: string | null,
): string | null {
  const number = fields[DOCUMENT_NUMBER_FIELD];
  return typeof number === 'string' && number.trim() !== '' && issuingCountry !== null
    ? chipDocumentNumberIndex(key, {
        environmentId,
        issuingState: issuingCountry,
        documentNumber: number,
      })
    : null;
}

/**
 * C62.6: writes (or, on a re-run of the decision, replaces) the verification's chip read, in the
 * decision transaction, with both blind indexes. Never over a redacted read.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export async function writeChipRead(
  tx: Db,
  environmentId: string,
  input: NewChipRead,
): Promise<ChipRead> {
  assertBlindIndexKey(input.blindIndexKey);
  const id = input.verificationId;
  const values = {
    inquiryId: input.inquiryId,
    fieldsSealed: sealJson(SEALED.chipReadFields, id, input.fields),
    sodSignatureSealed: sealValue(
      SEALED.chipReadSodSignature,
      id,
      Buffer.from(input.sodSignature).toString('base64'),
    ),
    sodSignatureIndex: chipSodIndex(input.blindIndexKey, {
      environmentId,
      signature: input.sodSignature,
    }),
    documentNumberIndex: documentNumberIndexOf(
      input.blindIndexKey,
      environmentId,
      input.fields,
      input.issuingCountry,
    ),
    integrity: input.integrity,
    selfieBound: input.selfieBound,
    issuingCountry: input.issuingCountry,
    paSummary: { ...input.paSummary },
  };
  const row = firstOrNull(
    await tx
      .insert(chipReads)
      .values({ environmentId, verificationId: id, ...values, createdAt: input.at })
      .onConflictDoUpdate({
        target: chipReads.verificationId,
        set: values,
        // C53.6: a redacted read is never written again.
        setWhere: sql`${chipReads.environmentId} = ${environmentId} and ${chipReads.redactedAt} is null`,
      })
      .returning(),
  );
  if (row === null) {
    throw new Error('writeChipRead: the chip read was redacted');
  }
  return toChipRead(row);
}

/**
 * C62.6 `id_nfc_repeat_detection`: how many selfie-bound reads of this SOD signature sit in
 * unredacted inquiries of other accounts in the environment: the current inquiry and every
 * inquiry of its account are left out (`inquiries.account_id`), and so is a read whose selfie did
 * not match (`selfie_bound` false) or that was redacted.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export async function countChipSightings(
  db: Db,
  environmentId: string,
  input: { inquiryId: string; sodSignature: Uint8Array; blindIndexKey: Uint8Array },
): Promise<number> {
  const index = chipSodIndex(input.blindIndexKey, {
    environmentId,
    signature: input.sodSignature,
  });
  const current = db
    .select({ accountId: inquiries.accountId })
    .from(inquiries)
    .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.id, input.inquiryId)));
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chipReads)
    .innerJoin(
      inquiries,
      and(
        eq(inquiries.environmentId, chipReads.environmentId),
        eq(inquiries.id, chipReads.inquiryId),
      ),
    )
    .where(
      and(
        eq(chipReads.environmentId, environmentId),
        eq(chipReads.sodSignatureIndex, index),
        eq(chipReads.selfieBound, true),
        isNull(chipReads.redactedAt),
        isNull(inquiries.redactedAt),
        ne(inquiries.id, input.inquiryId),
        sql`${inquiries.accountId} is distinct from (${current})`,
      ),
    );
  return row?.count ?? 0;
}

/**
 * C53.6: clears the sealed values, both indexes and the issuing state, and sets `redacted_at`
 * (kept on a re-run); returns the rows matched.
 */
export async function redactChipReads(
  tx: Db,
  environmentId: string,
  verificationIds: readonly string[],
  at: Date,
): Promise<number> {
  if (verificationIds.length === 0) {
    return 0;
  }
  const rows = await tx
    .update(chipReads)
    .set({
      fieldsSealed: null,
      sodSignatureSealed: null,
      sodSignatureIndex: null,
      documentNumberIndex: null,
      issuingCountry: null,
      redactedAt: sql`coalesce(${chipReads.redactedAt}, ${at.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(chipReads.environmentId, environmentId),
        inArray(chipReads.verificationId, [...verificationIds]),
      ),
    )
    .returning({ verificationId: chipReads.verificationId });
  return rows.length;
}

/**
 * C53.4 `blind-index:rebuild`: recomputes both indexes of every unredacted read, in every
 * environment, under `key`, from its sealed SOD signature and its sealed DG1 document number with
 * the issuing state. Each batch runs in its own transaction and locks its rows. Neither values
 * nor indexes are logged or returned.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes, before anything is read.
 */
export async function rebuildChipReadIndexes(
  db: Db,
  key: Uint8Array,
  options: RebuildIndexesOptions = {},
): Promise<RebuildIndexesResult> {
  assertBlindIndexKey(key);
  const batchSize = options.batchSize ?? DEFAULT_REBUILD_BATCH_SIZE;
  const t = chipReads;
  let after = '';
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          verificationId: t.verificationId,
          environmentId: t.environmentId,
          fieldsSealed: t.fieldsSealed,
          sodSignatureSealed: t.sodSignatureSealed,
          issuingCountry: t.issuingCountry,
          sodSignatureIndex: t.sodSignatureIndex,
          documentNumberIndex: t.documentNumberIndex,
        })
        .from(t)
        .where(and(isNull(t.redactedAt), gt(t.verificationId, after)))
        .orderBy(asc(t.verificationId))
        .limit(batchSize)
        .for('update');
      let changed = 0;
      for (const row of rows) {
        if (row.sodSignatureSealed === null || row.fieldsSealed === null) {
          continue;
        }
        const signature = Buffer.from(
          openValue(SEALED.chipReadSodSignature, row.verificationId, row.sodSignatureSealed),
          'base64',
        );
        const sodSignatureIndex = chipSodIndex(key, {
          environmentId: row.environmentId,
          signature,
        });
        const fields = openJson(
          SEALED.chipReadFields,
          row.verificationId,
          row.fieldsSealed,
        ) as Fields;
        const documentNumberIndex = documentNumberIndexOf(
          key,
          row.environmentId,
          fields,
          row.issuingCountry,
        );
        if (
          sodSignatureIndex !== row.sodSignatureIndex ||
          documentNumberIndex !== row.documentNumberIndex
        ) {
          await tx
            .update(t)
            .set({ sodSignatureIndex, documentNumberIndex })
            .where(
              and(eq(t.environmentId, row.environmentId), eq(t.verificationId, row.verificationId)),
            );
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
