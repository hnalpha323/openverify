/**
 * Phase 2, C13: inquiries resolve their account by reference id, and consolidating accounts
 * moves the sources' inquiries to the target, archives the sources and emits the events.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { recordingClient } from './support/platform.js';

test('consolidating accounts moves the inquiries to the target account', async () => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const reference = (label: string) => `e2e-${label}-${randomUUID()}`;
  const [targetRef, sourceRef] = [reference('target'), reference('source')];
  const create = async (referenceId: string) =>
    (
      await client.inquiries.create({
        'inquiry-template-id': stack.defaultTemplateId,
        'reference-id': referenceId,
      })
    ).data;

  // Two inquiries with one reference id share one account; another reference gets another.
  const targetInquiry = await create(targetRef);
  const sourceInquiries = [await create(sourceRef), await create(sourceRef)];
  const accountOf = (inquiry: typeof targetInquiry) => inquiry.relationships.account?.data?.id;
  const targetId = accountOf(targetInquiry) ?? '';
  const sourceId = accountOf(sourceInquiries[0] ?? targetInquiry) ?? '';
  expect(targetId).toMatch(/^acc_/);
  expect(sourceId).toMatch(/^acc_/);
  expect(sourceId).not.toBe(targetId);
  expect(sourceInquiries.map(accountOf)).toEqual([sourceId, sourceId]);
  const { data: source } = await client.accounts.retrieve(sourceId);
  expect(source.attributes['reference-id']).toBe(sourceRef);

  const { data: target } = await client.accounts.consolidate(targetId, {
    'source-account-ids': [sourceId],
  });
  expect(target.attributes.status).toBe('active');
  expect(target.relationships.inquiries.data.map((inquiry) => inquiry.id).sort()).toEqual(
    [targetInquiry.id, ...sourceInquiries.map((inquiry) => inquiry.id)].sort(),
  );

  for (const inquiry of sourceInquiries) {
    const { data } = await client.inquiries.retrieve(inquiry.id);
    expect(accountOf(data)).toBe(targetId);
  }
  const { data: archived } = await client.accounts.retrieve(sourceId);
  expect(archived.attributes).toMatchObject({ status: 'archived', 'consolidated-into': targetId });

  const names = async (objectId: string) =>
    (await client.events.list({ filter: { 'object-id': objectId } })).data.map(
      (event) => event.attributes.name,
    );
  expect(await names(targetId)).toContain('account.consolidated');
  expect(await names(sourceId)).toContain('account.consolidated-with');

  // A later inquiry with the source's reference id resolves to the account that absorbed it.
  expect(accountOf(await create(sourceRef))).toBe(targetId);
});
