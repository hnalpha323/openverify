/**
 * C97-C100, C99.3-C99.6 (Workflow 7B): lists, full stack. Budget: 90 s.
 *
 * An email-address list is filled by a CSV import (C100: the `list-import` job on the worker,
 * through the real `ListItemWriter`), one row of it an address an end user then confirms with the
 * code Mailpit received, on a template whose version screens that list at completion with
 * `on-list-match: needs_review` (C99.5, C99.6). Once the inquiry completes, the `list-screen` job
 * matches the confirmed address exactly (R tier), writes the list match, delivers
 * `list-match.created` (signed, with no value in the event: rule 11), and moves the inquiry to
 * `needs_review`. The match is then dismissed with a reason. Every address is synthetic, at
 * `.test` (C56: a sandbox answers it without a DNS query).
 */
import { randomUUID } from 'node:crypto';
import { eventDocumentSchema } from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver, type RecordedRequest } from '../src/webhook-receiver.js';
import {
  base64Csv,
  confirmEmailInquiry,
  emailCodeTemplate,
  waitForInquiryStatus,
} from './support/phase7b.js';
import { recordingClient } from './support/platform.js';
import { createServerApi } from './support/server-api.js';
import { verifyDelivery } from './support/webhooks.js';

/** The `list-match.created` delivery about `inquiryId`'s match, if `request` is one. */
function listMatchEventOf(request: RecordedRequest, inquiryId: string) {
  try {
    const parsed = eventDocumentSchema.safeParse(JSON.parse(request.body));
    if (!parsed.success || parsed.data.data.attributes.name !== 'list-match.created') {
      return null;
    }
    const resource = parsed.data.data.attributes.payload.data as {
      relationships?: { inquiry?: { data?: { id?: string } | null } };
    };
    return resource.relationships?.inquiry?.data?.id === inquiryId ? parsed.data.data : null;
  } catch {
    return null;
  }
}

test('a CSV-imported email list matches an inquiry’s confirmed address at completion, signs list-match.created, sends the inquiry to review, and the match is dismissed (C97-C100)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const webhook = await api.createWebhook(receiver.url, ['*']);
  try {
    const run = randomUUID().slice(0, 8);
    const listed = `listed-${run}@lists.test`;

    // C97.1, C100: the list, filled by a CSV import of two rows (one with an empty match type).
    const { data: list } = await client.lists.create('email-addresses', {
      name: `e2e-lists-${run}`,
    });
    const { data: importer } = await client.importers.create('email-addresses', {
      'list-id': list.id,
      file: base64Csv(
        ['value', 'match_type'],
        [
          [listed, 'email_address'],
          [`other-${run}@lists.test`, ''],
        ],
      ),
    });
    let imported: Awaited<ReturnType<typeof client.importers.retrieve>>['data'] | undefined;
    await expect
      .poll(
        async () => {
          imported = (await client.importers.retrieve(importer.id)).data;
          return imported.attributes.status;
        },
        { timeout: 30_000, intervals: [250, 500] },
      )
      .toBe('ready');
    expect(imported?.attributes).toMatchObject({
      'row-count': 2,
      'successful-count': 2,
      'error-count': 0,
    });
    expect((await client.importers.errors(importer.id)).data).toEqual([]);

    // C99.5, C99.6: a template that screens the list at completion and sends a match to review.
    const templateId = await emailCodeTemplate(client, `e2e-lists-${run}`, {
      screen: [list.id],
      'on-list-match': 'needs_review',
    });
    const { inquiryId } = await confirmEmailInquiry(stack, client, {
      templateId,
      referenceId: `e2e-lists-${run}`,
      address: listed,
    });

    // C99.3: the list-screen job matches the confirmed address and moves the inquiry to review.
    await waitForInquiryStatus(client, inquiryId, 'needs_review', 60_000);
    const { data: matches } = await client.listMatches.list({
      filter: { 'inquiry-id': inquiryId },
    });
    expect(matches).toHaveLength(1);
    const [match] = matches;
    expect(match?.attributes).toMatchObject({
      status: 'open',
      method: 'exact',
      tier: 'R',
      confidence: null,
      approximate: false,
      'matched-value': listed,
    });
    expect(match?.relationships.list.data).toMatchObject({ id: list.id });

    // The signed event names the match and carries no value (rule 11).
    const request = await receiver.waitFor(
      (candidate) => listMatchEventOf(candidate, inquiryId) !== null,
      { timeoutMs: 30_000, description: `list-match.created for ${inquiryId}` },
    );
    const event = listMatchEventOf(request, inquiryId);
    expect(event?.attributes.payload.data.id).toBe(match?.id);
    expect(
      verifyDelivery({ request, event: event ?? ({} as never) }, webhook.attributes.secret),
    ).toBeGreaterThan(0);
    expect(request.body).not.toContain(listed);

    // C99.3: the match is dismissed with a reason, which only a pii:view reader sees.
    const { data: dismissed } = await client.listMatches.dismiss(match?.id ?? '', {
      reason: 'Synthetic review: same person, known customer',
    });
    expect(dismissed.attributes).toMatchObject({
      status: 'dismissed',
      reason: 'Synthetic review: same person, known customer',
    });
    expect(dismissed.attributes['dismissed-at']).not.toBeNull();
  } finally {
    await api.disableWebhook(webhook.id);
    await receiver.close();
  }
});
