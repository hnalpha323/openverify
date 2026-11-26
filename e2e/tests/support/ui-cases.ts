/**
 * `dashboard-cases`' spec helpers for `ui-cases.spec.ts` (Workflow 8C, C142.1): a seeded operator's
 * user id through their kept session, a spec's own random names, a template key no other spec holds,
 * and the newest of the caller's exports made after a moment. Signing in goes through `ui.ts` alone
 * (`signInAs` via `signedInStates`, and `sessionTokenAs`). Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import type { OpenVerifyClient } from '@openverify/node';
import type { StackInfo } from '../../src/stack-info.js';
import { caseTemplateKey } from './cases.js';
import { dashboardRequest } from './platform.js';
import { sessionTokenAs, type SeededRole } from './ui.js';

/** A short random suffix for this spec's names. */
export const runSuffix = (): string => randomUUID().slice(0, 8);

/** A template key no other spec holds (C130.1). */
export const uiCaseTemplateKey = (): string => caseTemplateKey();

/** The user id of a seeded operator, read from `/dashboard/me` with their kept session. */
export async function userIdOf(stack: StackInfo, role: SeededRole): Promise<string> {
  const me = await dashboardRequest(stack, 'GET', '/me', {
    token: await sessionTokenAs(stack, role),
  });
  if (me.status !== 200) {
    throw new Error(`/dashboard/me answered ${String(me.status)}`);
  }
  return (me.body as { data: { id: string } }).data.id;
}

/**
 * The caller's newest export asked at or after `since` (exports are their creator's alone, P26), or
 * `undefined` while none is listed.
 */
export async function newestExportSince(
  client: OpenVerifyClient,
  since: Date,
): Promise<{ id: string } | undefined> {
  const { data } = await client.caseExports.list({ page: { size: 5 } });
  return data.find((each) => new Date(each.attributes['created-at']) >= since);
}

/** A `date,label` CSV with one good holiday and one row whose date does not exist. */
export function holidayCsv(suffix: string): string {
  return `date,label\n2031-01-01,Synthetic new year ${suffix}\n2031-13-01,Synthetic bad row\n`;
}
