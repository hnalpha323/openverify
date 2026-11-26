/**
 * C254.1 (Q10 granted 2026-11-21; Workflow 11G records-11g; KP11-31): the UN Security Council list's
 * opt-in on the full stack. The stack sets no `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`, so the API
 * takes the documented default (true since Q10's grant), and the container hands the switch to the
 * dashboard's opt-in routes: a seeded admin's opt-in is no longer refused 409
 * `watchlist_source_locked`. It is refused 422 for other terms and 403 `step_up_required` without a
 * recent second factor, so nothing is stored: the spec changes no environment's settings, and the
 * seeded environments stay opted out (no seed opts in). Budget: 30 s. Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { REPO_ROOT } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { sessionTokenAs } from './support/ui.js';

const manifest = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'watchlists', 'sources.json'), 'utf8'),
) as { sources: { id: string; terms: { url: string } }[] };
const UN_TERMS = manifest.sources.find((source) => source.id === 'un-sc')?.terms.url ?? '';

test('the UN opt-in reaches its checks on the stack, not the lock (C254.1, Q10 granted)', async () => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const token = await sessionTokenAs(stack, 'admin');
  const optIn = (termsUrl: string) =>
    fetch(`${stack.apiUrl}/api/v1/dashboard/watchlist-sources/un-sc/opt-in`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ acknowledgement: { 'terms-url': termsUrl, accepted: true } }),
    });

  const otherTerms = await optIn('https://example.com/terms');
  expect(otherTerms.status).toBe(422);

  const noStepUp = await optIn(UN_TERMS);
  expect(noStepUp.status).toBe(403);
  expect(await noStepUp.json()).toMatchObject({ code: 'step_up_required' });
});
