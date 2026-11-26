/**
 * C163.4 (Workflow 9B; verification round, H04): the inquiry's contribution to the rollups, recorded
 * by its redaction before anything is cleared. Owner: `api-analytics`; `foundation-9b` (Stage 1b (A))
 * froze the signature and placed the call in `services/redaction.ts`, inside the redaction's
 * transaction, after the transactions and flow copies are read and before `redactInquiryRecords`.
 *
 * It runs the rollup SQL restricted to that inquiry (`computeCohortRollups`, `kind: 'inquiry'`) and
 * adds the result to its cohort day's `source = 'redacted'` rows (counts only, no inquiry id; an
 * upsert on each table's key), while the day is open (`analytics-settle-days`); a closed day is
 * frozen and gets nothing, so its counts stay as they are. It adds nothing for an inquiry already
 * redacted (`redacted_at` set), so a contribution is never counted twice. A throw rolls the
 * redaction back.
 *
 * So that `facts` plus `redacted` (what every reader adds) never changes at a redaction, a stored
 * open day also gives the contribution back from its `facts` rows (`subtractFactsInTx`). When it
 * cannot (the inquiry's outcome changed since the day's last full recompute, so its `facts` rows hold
 * the earlier outcome), that day alone is recomputed at once without the inquiry. The current day is
 * not stored (it is computed live from unredacted inquiries), so it needs neither.
 */
import { inquiries, type Db } from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import { addDays, localDayOf } from './days.js';
import { recomputeDays } from './refresh.js';
import { computeCohortRollups } from './rollup-sql.js';
import { analyticsEnvironmentOf, firstLiveDay, readAnalyticsState } from './state.js';
import { addRedactedInTx, lockAnalyticsInTx, subtractFactsInTx } from './store.js';

export interface RedactedContributionInput {
  environmentId: string;
  inquiryId: string;
  /** The redaction's time (its clock), the same `redacted_at` the records get. */
  at: Date;
}

export type RecordRedactedContributionInTx = (
  tx: Db,
  input: RedactedContributionInput,
) => Promise<void>;

export const recordRedactedContributionInTx: RecordRedactedContributionInTx = async (tx, input) => {
  const { environmentId, inquiryId, at } = input;
  const [inquiry] = await tx
    .select({ createdAt: inquiries.createdAt, redactedAt: inquiries.redactedAt })
    .from(inquiries)
    .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.id, inquiryId)));
  const environment = await analyticsEnvironmentOf(tx, environmentId);
  if (inquiry?.redactedAt !== null || environment === null) {
    return;
  }
  await lockAnalyticsInTx(tx, environmentId);
  const state = await readAnalyticsState(tx, environmentId);
  // The zone the open days are stored in (a pending rebuild has not moved them yet).
  const zone = state?.timeZone ?? environment.settings['analytics-time-zone'];
  const day = localDayOf(inquiry.createdAt, zone);
  const today = localDayOf(at, zone);
  if (day < addDays(today, -environment.settings['analytics-settle-days'])) {
    return;
  }
  const contribution = await computeCohortRollups(
    tx,
    {
      environmentId,
      timeZone: zone,
      source: 'redacted',
      selection: { kind: 'inquiry', inquiryId },
    },
    'all',
  );
  const liveFrom = firstLiveDay(state, zone);
  if (liveFrom !== null && day < liveFrom && !(await subtractFactsInTx(tx, contribution))) {
    await recomputeDays(tx, {
      environmentId,
      zone,
      days: [day],
      columns: 'all',
      excludeInquiryIds: [inquiryId],
      tx,
    });
  }
  await addRedactedInTx(tx, contribution);
};
