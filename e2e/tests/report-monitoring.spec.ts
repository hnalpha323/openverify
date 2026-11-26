/**
 * C74, C75.4, C75.8, C76.2, C89.2 (Workflow 6A): continuous monitoring, full stack. Budget: 90 s.
 *
 * A recurring watchlist report on the sandbox list's monitored person starts without a match. An
 * operator imports version 2 of the synthetic list, which adds that person: the sync enqueues the
 * re-screen (C74.4), which inserts a `list_update` run, and `report/watchlist.matched` fires. The
 * match is dismissed. Version 3 changes the entry's birth date, a new content hash, so the next
 * re-screen's run lapses the dismissal: a new open match with `lapsed-from` and `.matched` (the
 * real lapse path; H20, F20). Then pause, resume and run now (C74.5).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { importWatchlist } from './support/commands.js';
import { recordingClient } from './support/platform.js';
import {
  SANDBOX_LISTS,
  assertInFixture,
  attributesOf,
  historyOf,
  runsOf,
  waitForCompletedRuns,
  waitForReport,
  watchlistFixture,
} from './support/reports.js';
import { eventNamesFor, waitForEvent } from './support/webhooks.js';

interface Match {
  id: string;
  status: string;
  'lapsed-from': string | null;
}

test('a recurring report alerts on a list update, a dismissal lapses when the entry changes, and pause, resume and run now work (C74, C75.8, C89.2)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const { data: webhook } = await client.webhooks.create({
    url: receiver.url,
    'enabled-events': ['report/watchlist.matched', 'report/watchlist.dismissed'],
  });
  try {
    const person = SANDBOX_LISTS.monitoredPerson;
    await assertInFixture('openverify-sandbox.v2.json', person.entryId);
    const { data: template } = await client.reportTemplates.create({
      'report-type': 'watchlist',
      name: `e2e-monitoring-${randomUUID()}`,
      config: { 'search-lists': ['openverify-sandbox'], 'recurrence-interval-days': 1 },
    });
    const { data: created } = await client.reports.create(
      'report/watchlist',
      { 'report-template-id': template.id, query: person.query },
      { 'auto-create-account': false },
    );
    expect(created.attributes['is-recurring']).toBe(true);
    // Version 1 (seed:dev) does not list the monitored person.
    const first = attributesOf(await waitForReport(client, created.id));
    expect(first).toMatchObject({ status: 'ready', 'has-match': false });

    // Version 2 adds the person: the re-screen runs the report again (C74.4).
    const v2 = await importWatchlist(
      watchlistFixture('openverify-sandbox.v2.json'),
      'openverify-sandbox',
    );
    expect(v2).toMatchObject({ outcome: 'applied', added: 1, removed: 0, rescreen: 'enqueued' });
    await waitForEvent(receiver, 'report/watchlist.matched', created.id, 60_000);
    const listed = attributesOf(
      await waitForReport(client, created.id, (report) => report.attributes['has-match']),
    );
    const [match] = listed.matches as Match[];
    expect(match).toMatchObject({ status: 'open', 'lapsed-from': null });
    const updateRuns = runsOf(await historyOf(client, created.id));
    expect(updateRuns.map((run) => run.attributes['run-type'])).toContain('list_update');

    // Dismissed, then version 3 changes the entry's birth date: the dismissal lapses (C75.4).
    await client.reports.dismiss(created.id, { reason: 'Synthetic e2e: a different person' });
    await waitForEvent(receiver, 'report/watchlist.dismissed', created.id);
    const v3 = await importWatchlist(
      watchlistFixture('openverify-sandbox.v3.json'),
      'openverify-sandbox',
    );
    expect(v3).toMatchObject({ outcome: 'applied', changed: 1, rescreen: 'enqueued' });
    await expect
      .poll(
        () =>
          eventNamesFor(receiver, created.id).filter((name) => name === 'report/watchlist.matched')
            .length,
        { timeout: 60_000, intervals: [500, 1000] },
      )
      .toBe(2);
    const lapsed = attributesOf(
      await waitForReport(client, created.id, (report) => report.attributes['has-match']),
    );
    const rows = lapsed.matches as Match[];
    expect(rows.map((row) => row.status).sort()).toEqual(['dismissed', 'open']);
    const open = rows.find((row) => row.status === 'open');
    expect(open?.['lapsed-from']).toBe(match?.id);

    // Pause, resume and run now (C74.5).
    const { data: paused } = await client.reports.pause(created.id);
    expect(paused.attributes).toMatchObject({ 'is-recurring': false, 'paused-reason': 'operator' });
    const { data: resumed } = await client.reports.resume(created.id);
    expect(resumed.attributes).toMatchObject({ 'is-recurring': true, 'paused-at': null });
    const before = runsOf(await historyOf(client, created.id)).length;
    await client.reports.run(created.id);
    const history = await waitForCompletedRuns(client, created.id, before + 1);
    expect(runsOf(history)[0]?.attributes['run-type']).toBe('manual');
    expect(
      history
        .filter((entry) => entry.type === 'report-action')
        .map((entry) => entry.attributes['action-type']),
    ).toEqual(expect.arrayContaining(['dismiss', 'pause', 'resume', 'run']));
  } finally {
    await client.webhooks.disable(webhook.id);
    await receiver.close();
  }
});
