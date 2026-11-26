/**
 * C163.3, C174.5 (Workflow 9B; review P20): the assignee rollup is personal data about employees, so
 * a user's `analytics_case_assignee_daily` rows are re-keyed to "former user" (`user_id` `null`,
 * added into that day's former-user row of the same case template, zone and source) when the user is
 * deleted. Owner: `api-analytics`; `foundation-9b` (Stage 1b (A)) froze the signature.
 *
 * No path deletes a user at Workflow 9B's base (users are deactivated, `services/users.ts`, and
 * reactivated by C168.3; Phase 11 deletes none either), so this hook has no call site yet (Stage 1b
 * amendment A3): a deletion path added later calls it first, in its transaction. Meanwhile the
 * table's foreign key on `users(id)` deletes a user's rows with the user, whichever path deletes one.
 * Only the organisation's environments are touched.
 */
import type { Db } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { lockAnalyticsInTx } from './store.js';

export interface ForgetAnalyticsAssigneeInput {
  organizationId: string;
  userId: string;
}

export type ForgetAnalyticsAssigneeInTx = (
  tx: Db,
  input: ForgetAnalyticsAssigneeInput,
) => Promise<void>;

export const forgetAnalyticsAssigneeInTx: ForgetAnalyticsAssigneeInTx = async (tx, input) => {
  const ofUser = sql`a.user_id = ${input.userId} and a.environment_id in (
    select id from environments where organization_id = ${input.organizationId})`;
  const result = await tx.execute<{ environment_id: string }>(
    sql`select distinct a.environment_id from analytics_case_assignee_daily a where ${ofUser}
      order by 1`,
  );
  for (const { environment_id: environmentId } of (result as { rows: { environment_id: string }[] })
    .rows) {
    await lockAnalyticsInTx(tx, environmentId);
  }
  await tx.execute(
    sql`insert into analytics_case_assignee_daily as t (environment_id, day, time_zone, source,
        case_template_id, user_id, assigned, resolved)
      select a.environment_id, a.day, a.time_zone, a.source, a.case_template_id, null,
        sum(a.assigned)::int, sum(a.resolved)::int
      from analytics_case_assignee_daily a where ${ofUser}
      group by 1, 2, 3, 4, 5
      on conflict on constraint analytics_case_assignee_daily_key do update set
        assigned = t.assigned + excluded.assigned,
        resolved = t.resolved + excluded.resolved`,
  );
  await tx.execute(sql`delete from analytics_case_assignee_daily a where ${ofUser}`);
};
