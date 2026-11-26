/**
 * C241.3, C241.4 (Workflow 11A, `api-consent`): Connect in the daily C16 pass, in this order (a token
 * cites its consent records, a record cites its texts by digest):
 *
 * 1. tokens: `expired` and `failed` ones 30 days after they ended (as one-time links are); a
 *    `redeemed` token, the disclosure record holding ids only, once its source and its destination
 *    copy are both redacted or gone (review P04, decision 36), so a later source redaction or
 *    withdrawal still reaches the destination meanwhile;
 * 2. consent records: a redacted record's bare fact once the environment's
 *    `consent-proof-retention-days` (0 to 3,650, default 0) after its redaction have passed, unless a
 *    token still cites it;
 * 3. consent texts: a `consent_texts` row no record of its environment cites, written more than a day
 *    before the pass (so a text stored for a record about to commit is never a candidate).
 *
 * Each statement deletes at most `batch.limit` rows, locked with `SKIP LOCKED`, and runs until a
 * statement deletes fewer. `foundation-11a` placed the call in `runRetention` (Stage 1b (K)) and these
 * report keys; `api-consent` builds the pass (its file).
 */
import {
  deleteEndedShareTokens,
  deleteExpiredConsentFacts,
  deleteUncitedConsentTexts,
  type Db,
} from '@openverify/db';
import type { Clock } from '../../ports.js';

/** The pass's counts, merged into the C16 report. */
export interface ConnectRetentionReport {
  deletedShareTokens: number;
  deletedConsentRecords: number;
  deletedConsentTexts: number;
}

/** A text younger than this is never deleted, so a record about to cite it can commit first. */
const TEXT_GRACE_MS = 86_400_000;

/** Runs `step` until it deletes fewer than `limit` rows; answers the total. */
async function drain(limit: number, step: () => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await step();
    total += deleted;
    if (deleted < limit) {
      return total;
    }
  }
}

export async function runConnectRetention(deps: {
  db: Db;
  clock: Clock;
  now: Date;
  /** The pass's batch: its cutoff time and rows per statement. */
  batch: { now: Date; limit: number };
}): Promise<ConnectRetentionReport> {
  const { db, batch } = deps;
  const limit = Math.max(1, batch.limit);
  const deletedShareTokens = await drain(limit, () => deleteEndedShareTokens(db, batch.now, limit));
  const deletedConsentRecords = await drain(limit, () =>
    deleteExpiredConsentFacts(db, batch.now, limit),
  );
  const deletedConsentTexts = await drain(limit, () =>
    deleteUncitedConsentTexts(db, limit, new Date(batch.now.getTime() - TEXT_GRACE_MS)),
  );
  return { deletedShareTokens, deletedConsentRecords, deletedConsentTexts };
}
