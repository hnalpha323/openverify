/**
 * C236.3, C241.3 (Workflow 11A; review P11): the server-composed `flow` texts, once per environment
 * and digest, the body sealed for `consentTextRowId(environment id, sha256)`. Insert-if-absent and
 * never updated; the retention pass deletes a text no record cites.
 *
 * The race (C236.3's concurrency test): two sessions accepting the same text both insert it, and
 * `on conflict do nothing` keeps one row. A retention pass deleting an uncited text while a session
 * cites it is ruled out by the lock each side takes: the insert takes the row `FOR KEY SHARE` and
 * re-inserts a row deleted under it, and the pass deletes only rows it locked `FOR UPDATE SKIP
 * LOCKED`, re-checking in a later statement that no record cites them.
 *
 * Declared as stubs by `foundation-11a` (Stage 1b (K)); built by `api-consent` (its file).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openValue, sealValue } from '../sealed.js';
import { consentTextRowId, consentTexts, type ConnectConsentText } from '../tables/connect.js';
import { firstOrNull } from './rows.js';

const rowsOf = <T = unknown>(result: unknown): T[] => (result as { rows: T[] }).rows;

/** How often a row deleted under the insert is written again before giving up. */
const INSERT_ATTEMPTS = 3;

const ofText = (environmentId: string, sha256: string) =>
  and(eq(consentTexts.environmentId, environmentId), eq(consentTexts.sha256, sha256));

/** C236.3: insert-if-absent under concurrency (two sessions accepting the same text). */
export async function insertConsentTextIfAbsent(
  tx: Db,
  environmentId: string,
  input: {
    sha256: string;
    locale: string;
    body: string;
    createdAt?: Date | undefined;
  },
): Promise<void> {
  const body = sealValue(
    SEALED.consentTextBody,
    consentTextRowId(environmentId, input.sha256),
    input.body,
  );
  for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt += 1) {
    await tx
      .insert(consentTexts)
      .values({
        environmentId,
        sha256: input.sha256,
        locale: input.locale,
        body,
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      })
      .onConflictDoNothing();
    const held = await tx
      .select({ sha256: consentTexts.sha256 })
      .from(consentTexts)
      .where(ofText(environmentId, input.sha256))
      .for('key share');
    if (held.length > 0) {
      return;
    }
  }
  throw new Error('consent text: the row was deleted under every insert');
}

/** C236.3: a stored text by its digest (the console shows it with `pii:view`), or null. */
export async function getConsentText(
  db: Db,
  environmentId: string,
  sha256: string,
): Promise<(Omit<ConnectConsentText, 'body'> & { body: string }) | null> {
  const row = firstOrNull(
    await db.select().from(consentTexts).where(ofText(environmentId, sha256)),
  );
  return row === null
    ? null
    : {
        ...row,
        body: openValue(SEALED.consentTextBody, consentTextRowId(environmentId, sha256), row.body),
      };
}

/**
 * C241.3: deletes up to `limit` texts no record of their environment cites (by its text or its
 * biometric digest), written before `before` (so a text inserted for a record about to commit is
 * never a candidate). Run it in a transaction: the candidates are locked first and re-checked.
 */
export async function deleteUncitedConsentTexts(
  db: Db,
  limit: number,
  before: Date = new Date(),
): Promise<number> {
  const uncited = sql`not exists (
    select 1 from consent_records r
     where r.environment_id = t.environment_id
       and (r.text_sha256 = t.sha256 or r.biometric_text_sha256 = t.sha256))`;
  return db.transaction(async (tx) => {
    const candidates = rowsOf<{ environment_id: string; sha256: string }>(
      await tx.execute(sql`
        select t.environment_id, t.sha256 from consent_texts t
         where t.created_at < ${before} and ${uncited}
         limit ${limit}
         for update skip locked`),
    );
    if (candidates.length === 0) {
      return 0;
    }
    const keys = sql.join(
      candidates.map((row) => sql`(${row.environment_id}, ${row.sha256})`),
      sql`, `,
    );
    const removed = rowsOf(
      await tx.execute(sql`
        delete from consent_texts t
         where (t.environment_id, t.sha256) in (${keys}) and ${uncited}
        returning t.sha256`),
    );
    return removed.length;
  });
}
