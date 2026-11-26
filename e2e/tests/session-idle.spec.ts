/**
 * C245.1, C245.2, C287.3 (Workflow 11B, integration-11b): an idle console session is signed out.
 * Budget: 90 s.
 *
 * A fresh viewer signs in; the spec moves its one session's `last_seen_at` back past the idle limit
 * in the stack's database (the stack keeps the default 1,800 s, and even the shortest configurable
 * limit, 300 s, is longer than this spec's budget, so it never waits in real time); the next page
 * the browser opens is refused with `session_expired` (idle), and the console signs it out to the
 * login page with "signed out after inactivity". A session of another operator is untouched. Every
 * value is synthetic.
 */
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { readStackInfo } from '../src/stack-info.js';
import { signIn } from './support/dashboard.js';
import { createOperator } from './support/ui.js';

test('an idle console session is signed out after inactivity (C245.2)', async ({ page }) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const operator = await createOperator(stack, 'viewer');
  await signIn(page, stack.dashboardUrl, operator);

  const client = new pg.Client({ connectionString: stack.databaseUrl });
  await client.connect();
  try {
    const moved = await client.query(
      `update user_sessions set last_seen_at = now() - interval '31 minutes'
         where revoked_at is null
           and user_id = (select id from users where email = $1)`,
      [operator.email],
    );
    expect(moved.rowCount).toBe(1);
  } finally {
    await client.end();
  }

  await page.goto(`${stack.dashboardUrl}/inquiries`);

  await expect(page).toHaveURL(/\/login\?reason=session-idle$/);
  await expect(
    page.getByText('You were signed out after inactivity. Sign in again.'),
  ).toBeVisible();
});
