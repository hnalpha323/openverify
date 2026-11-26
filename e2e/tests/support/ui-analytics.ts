/**
 * `dashboard-analytics`' e2e support (Workflow 9C, C178.4): a seeded synthetic population for the
 * console's Analytics section, made through the server API in the spec's own templates, so the spec
 * depends on no other spec's data. Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import type { StackInfo } from '../../src/stack-info.js';
import { defaultTemplateAttributes, recordingClient } from './platform.js';

export interface AnalyticsPopulation {
  /** A template with fewer inquiries than the threshold (11): its counts are suppressed. */
  readonly smallTemplateId: string;
  /** A template with 12 inquiries: its `created` is shown. */
  readonly largeTemplateId: string;
  readonly inquiryIds: readonly string[];
  /** Every inquiry's synthetic reference id, which no analytics page may carry. */
  readonly references: readonly string[];
}

/** Two fresh templates of the sandbox, with 3 and 12 inquiries created today. */
export async function seedAnalyticsPopulation(stack: StackInfo): Promise<AnalyticsPopulation> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const template = async (name: string) =>
    (
      await client.inquiryTemplates.create(
        await defaultTemplateAttributes(`${name} ${randomUUID().slice(0, 8)}`),
      )
    ).data.id;
  const smallTemplateId = await template('e2e ui analytics small');
  const largeTemplateId = await template('e2e ui analytics large');
  const references: string[] = [];
  const inquiryIds: string[] = [];
  const populate = async (templateId: string, count: number) => {
    const created = await Promise.all(
      Array.from({ length: count }, () => {
        const reference = `e2e-ui-analytics-${randomUUID()}`;
        references.push(reference);
        return client.inquiries.create({
          'inquiry-template-id': templateId,
          'reference-id': reference,
        });
      }),
    );
    inquiryIds.push(...created.map((answer) => answer.data.id));
  };
  await populate(smallTemplateId, 3);
  await populate(largeTemplateId, 12);
  return { smallTemplateId, largeTemplateId, inquiryIds, references };
}

/** Reloads `page` until `ready` holds, at most `timeoutMs` (a job the console shows as it runs). */
export async function reloadUntil(
  page: Page,
  ready: () => Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.reload();
        return ready();
      },
      { timeout: timeoutMs, intervals: [1_000, 2_000], message: what },
    )
    .toBe(true);
}
