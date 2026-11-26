/**
 * C69, C70, C75, C76.6, C89.2 (Workflow 6A): a watchlist report, full stack. Budget: 90 s.
 *
 * The seeded sandbox template (C71.3) screens the synthetic sandbox list seed:dev imported
 * (C76.6). A customer backend creates a report on the list's fictional listed person: it is
 * `ready` with `has-match`, its sources say the list was imported (never cited as a publisher's),
 * and `report/watchlist.matched` reaches the customer's endpoint, signed. A reviewer dismisses the
 * match with a reason: `.dismissed` carries the match id, `has-match` is false and the match is in
 * the ignore list. A re-run keeps it dismissed: the evidence did not change, so nothing alerts
 * again (C75.3, C75.8).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { recordingClient } from './support/platform.js';
import {
  SANDBOX_LISTS,
  assertInFixture,
  attributesOf,
  runsOf,
  seededTemplateId,
  waitForCompletedRuns,
  waitForReport,
} from './support/reports.js';
import { eventNamesFor, verifyDelivery, waitForEvent } from './support/webhooks.js';

test('a watchlist report on the listed fictional person matches and alerts; a dismissal clears has-match and a re-run keeps it dismissed (C69, C75, C89.2)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const { data: webhook } = await client.webhooks.create({
    url: receiver.url,
    'enabled-events': [
      'report/watchlist.matched',
      'report/watchlist.ready',
      'report/watchlist.dismissed',
    ],
  });
  try {
    const person = SANDBOX_LISTS.listedPerson;
    await assertInFixture('openverify-sandbox.json', person.entryId);
    const templateId = await seededTemplateId(client, 'watchlist');

    const { data: created } = await client.reports.create(
      'report/watchlist',
      { 'report-template-id': templateId, query: person.query },
      { 'auto-create-account': false },
    );
    expect(created.attributes).toMatchObject({ status: 'pending', origin: 'api' });

    // The run: one match, the alert delivered and signed (C70.4, C5).
    const matched = await waitForEvent(receiver, 'report/watchlist.matched', created.id, 60_000);
    expect(verifyDelivery(matched, webhook.attributes.secret)).toBeGreaterThan(0);
    const ready = attributesOf(await waitForReport(client, created.id));
    expect(ready).toMatchObject({
      status: 'ready',
      'has-match': true,
      errors: [],
      coverage: { complete: true, limits: [] },
    });
    // C69.4: provenance names the imported synthetic list, never a publisher (P08).
    expect(ready.sources).toEqual([
      expect.objectContaining({ 'source-id': 'openverify-sandbox', origin: 'import' }),
    ]);
    const matches = ready.matches as { id: string; 'entity-id': string; status: string }[];
    expect(matches).toHaveLength(1);
    const [match] = matches;
    expect(match).toMatchObject({
      'entity-id': `openverify-sandbox:${person.entryId}`,
      status: 'open',
      'review-status': 'pending',
    });
    const lists = ready['matched-lists'] as { 'source-id': string; entities: unknown[] }[];
    expect(lists.map((list) => list['source-id'])).toEqual(['openverify-sandbox']);

    // A reviewer dismisses it (C75.2): has-match false, the match in the ignore list.
    const { data: dismissed } = await client.reports.dismiss(created.id, {
      reason: `Synthetic e2e ${randomUUID()}: not the listed party`,
    });
    expect(attributesOf(dismissed)).toMatchObject({ status: 'ready', 'has-match': false });
    expect((attributesOf(dismissed)['ignore-list'] as unknown[]).length).toBe(1);
    const dismissal = await waitForEvent(receiver, 'report/watchlist.dismissed', created.id);
    expect(dismissal.event.attributes.payload).toMatchObject({
      meta: { 'match-ids': [match?.id] },
    });

    // A re-run: the same evidence stays suppressed, and nothing alerts again (C75.8).
    await client.reports.run(created.id);
    const history = await waitForCompletedRuns(client, created.id, 2);
    expect(runsOf(history).map((run) => run.attributes['run-type'])).toEqual(['manual', 'initial']);
    const rerun = attributesOf(await waitForReport(client, created.id));
    expect(rerun).toMatchObject({ status: 'ready', 'has-match': false });
    expect((rerun.matches as { status: string }[]).map((each) => each.status)).toEqual([
      'dismissed',
    ]);
    await waitForEvent(receiver, 'report/watchlist.ready', created.id);
    expect(
      eventNamesFor(receiver, created.id).filter((name) => name === 'report/watchlist.matched'),
    ).toHaveLength(1);
  } finally {
    await client.webhooks.disable(webhook.id);
    await receiver.close();
  }
});
