/**
 * C251.1, C251.2, C287.3 (Workflow 11B, integration-11b): a flooding environment is held at its
 * queue cap while another environment's job is admitted and completes. Budget: 90 s.
 *
 * The dev sandbox environment's `report-run` cap is set to 1 in its settings (the stack's database;
 * restored in `finally`), and it creates six watchlist reports at once: one run is admitted, the
 * others stay `pending` with `admitted_at` null (counts). The production environment of the same
 * organisation then creates one report: it is admitted at once and completes while the sandbox runs
 * are still held, and it was admitted before the flood's last run (order). The fair sweep then
 * drains the flood. The p95 ratio is not judged here (11D's calibration, review H12). Every value is
 * synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { readStackInfo } from '../src/stack-info.js';
import { pollUntil } from './support/platform-9b.js';
import { dashboardRequest, recordingClient, signInToApi } from './support/platform.js';
import { SANDBOX_LISTS, seededTemplateId } from './support/reports.js';

interface RunRow {
  report_id: string;
  status: string;
  admitted_at: Date | null;
}

test('a flooding environment is held at its cap while another environment’s report completes (C251)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const sandbox = recordingClient(stack.apiUrl, stack.apiKey).client;
  const db = new pg.Client({ connectionString: stack.databaseUrl });
  await db.connect();
  const runsOf = async (ids: readonly string[]) =>
    (
      await db.query<RunRow>(
        'select report_id, status, admitted_at from report_runs where report_id = any($1::text[])',
        [ids],
      )
    ).rows;
  await db.query(
    `update environments set settings = jsonb_set(settings, '{queue-in-flight-caps}',
       coalesce(settings->'queue-in-flight-caps', '{}'::jsonb) || '{"report-run": 1}'::jsonb)
       where id = $1`,
    [stack.environments.sandbox],
  );
  const flood: string[] = [];
  try {
    const sandboxTemplate = await seededTemplateId(sandbox, 'watchlist');
    // All at once, so each is produced while the first is still in flight (a sandbox run can finish
    // before the next create arrives, and a held run is admitted only by the 15 s sweep after that).
    const created = await Promise.all(
      Array.from({ length: 6 }, () =>
        sandbox.reports.create(
          'report/watchlist',
          { 'report-template-id': sandboxTemplate, query: SANDBOX_LISTS.monitoredPerson.query },
          { 'auto-create-account': false },
        ),
      ),
    );
    flood.push(...created.map(({ data }) => data.id));
    const held = (await runsOf(flood)).filter(
      (run) => run.admitted_at === null && run.status === 'pending',
    );
    expect(held.length).toBeGreaterThanOrEqual(2);

    // The other environment: the admin's session moved to production, its own report admitted.
    const token = await signInToApi(stack, stack.operators.admin);
    expect(
      (
        await dashboardRequest(stack, 'PUT', '/sessions/current/environment', {
          token,
          body: { 'environment-id': stack.environments.production },
        })
      ).status,
    ).toBe(200);
    const production = recordingClient(stack.apiUrl, token).client;
    const { data: other } = await production.reports.create(
      'report/watchlist',
      {
        'report-template-id': await seededTemplateId(production, 'watchlist'),
        query: { 'name-first': 'Synthetic', 'name-last': `Quota${randomUUID().slice(0, 6)}` },
      },
      { 'auto-create-account': false },
    );
    await pollUntil(
      async () => (await production.reports.retrieve(other.id)).data.attributes.status,
      (status) => status !== 'pending',
      45_000,
      'the other environment’s report',
    );
    const [otherRun] = await runsOf([other.id]);
    const stillHeld = (await runsOf(flood)).filter((run) => run.admitted_at === null);
    expect(stillHeld.length).toBeGreaterThanOrEqual(1);
    expect(otherRun?.admitted_at).not.toBeNull();
  } finally {
    await db.query(
      `update environments set settings = settings #- '{queue-in-flight-caps,report-run}'
         where id = $1`,
      [stack.environments.sandbox],
    );
  }
  try {
    // The fair sweep admits the rest once the cap is back (its tick is 15 s).
    const drained = await pollUntil(
      () => runsOf(flood),
      (runs) => runs.every((run) => run.admitted_at !== null),
      40_000,
      'the flood',
    );
    expect(drained).toHaveLength(6);
  } finally {
    await db.end();
  }
});
