/**
 * C70.4 (F10, decision 45): a strict subject (a report's) without the filtered attribute does not
 * pass a present filter; it still reaches a webhook without that filter. Other subjects keep C14's
 * rule. Synthetic values only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import { createWebhook, listWebhooksForEvent } from './webhooks.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('listWebhooksForEvent with a strict subject (C70.4)', () => {
  it('drops webhooks whose filter the subject cannot meet, and keeps the unfiltered', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    const template = testId('itmpl');
    const hook = (filters: Record<string, string[]>) =>
      createWebhook(database.db, env, {
        id: testId('wbh'),
        url: 'https://hooks.example.test/x',
        enabledEvents: ['*'],
        secret: `wbhsec_${'a'.repeat(32)}`,
        filters,
      });
    const unfiltered = await hook({});
    const byTemplate = await hook({ 'inquiry-template-ids': [template] });
    const byType = await hook({ 'account-type-ids': [testId('acctp')] });
    const ids = async (subject: Parameters<typeof listWebhooksForEvent>[3]) =>
      (await listWebhooksForEvent(database.db, env, 'report/watchlist.ready', subject))
        .map((webhook) => webhook.id)
        .sort();

    expect(await ids({ strict: true })).toEqual([unfiltered.id]);
    expect(await ids({ strict: true, inquiryTemplateId: template })).toEqual(
      [unfiltered.id, byTemplate.id].sort(),
    );
    // C14 for any other subject: an absent attribute is not filtered.
    expect(await ids({})).toEqual([unfiltered.id, byTemplate.id, byType.id].sort());
  });
});
