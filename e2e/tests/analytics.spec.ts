/**
 * C178.4 (Workflow 9B, integration-9b): the analytics answers on the full stack over a seeded
 * synthetic population. Budget: 90 s.
 *
 * Two fresh templates of the sandbox: one gets 3 inquiries today, the other 12. Today is computed
 * live on every read (C163.4's live day), so no wait for the 5-minute pass:
 * - the overview of the small template shows `created` as `{ suppressed: "small-count" }` (3 is
 *   below the threshold of 11), never 3, and counts the cell in `suppressed-cells`;
 * - the large one shows `created: 12` with every figure's definition context (time zone,
 *   threshold, freshness);
 * - the funnel of the small template and the check view answer with their own cells
 *   suppressed or not run, never a bare small count (C164.7).
 *
 * The populations are made through the server API; every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectStatus, serverRequest, todayUtc } from './support/platform-9b.js';
import { defaultTemplateAttributes, recordingClient } from './support/platform.js';

type Cell = number | { suppressed: string };

interface Answer {
  data: {
    type: string;
    attributes: {
      'time-zone': string;
      threshold: number;
      'suppressed-cells': number;
      freshness: { 'rolled-up-through': string | null; 'outcomes-as-of': string | null };
      buckets: { live: boolean; counts?: Record<string, Cell> }[];
      totals: { counts?: Record<string, Cell> };
    };
  };
}

/**
 * A count is never a visible value from 1 to threshold - 1 (C164.7): every number held in any
 * `counts` map of the answer, at any depth (buckets, totals, versions, steps, checks).
 */
function expectNoSmallCount(answer: Answer): void {
  const { threshold } = answer.data.attributes;
  const visit = (value: unknown, inCounts: boolean): void => {
    if (typeof value === 'number') {
      if (inCounts) {
        expect(value === 0 || value >= threshold, `a visible count of ${String(value)}`).toBe(true);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, false);
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, item] of Object.entries(value)) visit(item, key === 'counts' || inCounts);
    }
  };
  visit(answer.data.attributes, false);
}

test('the overview, funnel and check views over a seeded population, small cells suppressed (C164.1-C164.8)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const template = async (name: string) =>
    (
      await client.inquiryTemplates.create(
        await defaultTemplateAttributes(`${name} ${randomUUID().slice(0, 8)}`),
      )
    ).data;
  const small = await template('e2e analytics small');
  const large = await template('e2e analytics large');
  const populate = (templateId: string, count: number) =>
    Promise.all(
      Array.from({ length: count }, () =>
        client.inquiries.create({
          'inquiry-template-id': templateId,
          'reference-id': `e2e-analytics-${randomUUID()}`,
        }),
      ),
    );
  await populate(small.id, 3);
  await populate(large.id, 12);
  const day = todayUtc();
  const read = async (report: string, filters: string) =>
    expectStatus(
      await serverRequest(
        stack,
        stack.apiKey,
        'GET',
        `/analytics/${report}?filter[from]=${day}&filter[to]=${day}&bucket=day&${filters}`,
      ),
      200,
      `GET /analytics/${report}`,
    ).body as Answer;

  const smallOverview = await read('inquiries', `filter[inquiry-template-id]=${small.id}`);
  expect(smallOverview.data.type).toBe('analytics-inquiries');
  expect(smallOverview.data.attributes.totals.counts?.created).toEqual({
    suppressed: 'small-count',
  });
  expect(smallOverview.data.attributes['suppressed-cells']).toBeGreaterThan(0);
  expect(smallOverview.data.attributes.buckets[0]?.live).toBe(true);
  expectNoSmallCount(smallOverview);

  const largeOverview = await read('inquiries', `filter[inquiry-template-id]=${large.id}`);
  expect(largeOverview.data.attributes.totals.counts?.created).toBe(12);
  expect(largeOverview.data.attributes['time-zone']).toBe('UTC');
  expect(largeOverview.data.attributes.threshold).toBe(11);
  expectNoSmallCount(largeOverview);

  const funnel = await read('funnel', `filter[inquiry-template-id]=${small.id}`);
  expect(funnel.data.type).toBe('analytics-funnel');
  expectNoSmallCount(funnel);

  const checks = await read('checks', `filter[inquiry-template-id]=${small.id}`);
  expect(checks.data.type).toBe('analytics-checks');
  expectNoSmallCount(checks);
});
