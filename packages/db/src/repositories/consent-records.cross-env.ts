/**
 * C240.5 (V04), Workflow 11A: consent records read and written from the other side (the redeem job's
 * read of the source record under its lock, a withdrawal reaching the counterparty, the access
 * export's counterparty read). Every function takes the counterparty's environment id. Only
 * `apps/api/src/services/connect/cross-tenant.ts` imports this module (through
 * `@openverify/db/cross-env`).
 *
 * Declared as stubs by `foundation-11a` (Stage 1b (K)); built by `api-consent` (its file).
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../client.js';
import { consentRecords } from '../tables/connect.js';
import {
  getConsentRecord,
  lockConsentRecord,
  type OpenedConsentRecord,
} from './consent-records.js';

/**
 * C234.2: the source record a token cites, `FOR SHARE`, read by the destination's redeem job after
 * the connection and before the token (C287.2's lock order).
 */
export const lockSourceConsentRecordForShare = (
  tx: Db,
  sourceEnvironmentId: string,
  consentRecordId: string,
): Promise<OpenedConsentRecord | null> =>
  lockConsentRecord(tx, sourceEnvironmentId, consentRecordId, 'share');

/** C232.3: the other side's record a token cites, read without a lock (its `source-consent`). */
export const getCounterpartyConsentRecord = (
  db: Db,
  environmentId: string,
  consentRecordId: string,
): Promise<OpenedConsentRecord | null> => getConsentRecord(db, environmentId, consentRecordId);

/**
 * C253.2 (11B's access export): the records of `environmentId` about these objects, or citing these
 * tokens, oldest first.
 */
export async function listConsentRecordsTouching(
  db: Db,
  environmentId: string,
  objectIds: readonly string[],
): Promise<OpenedConsentRecord[]> {
  if (objectIds.length === 0) {
    return [];
  }
  const ids = [...objectIds];
  const rows = await db
    .select({ id: consentRecords.id })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.environmentId, environmentId),
        or(inArray(consentRecords.subjectId, ids), inArray(consentRecords.shareTokenId, ids)),
      ),
    )
    .orderBy(consentRecords.createdAt, consentRecords.id);
  const records: OpenedConsentRecord[] = [];
  for (const row of rows) {
    const record = await getConsentRecord(db, environmentId, row.id);
    if (record !== null) {
      records.push(record);
    }
  }
  return records;
}
