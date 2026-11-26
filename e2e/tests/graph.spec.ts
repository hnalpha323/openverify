/**
 * C101-C103 (Workflow 7B): the account graph, full stack. Budget: 90 s.
 *
 * Two accounts each have an inquiry whose end user confirms the same email address with the code
 * Mailpit received; at completion the `graph-index` job writes each passed verification's confirmed
 * destination as the strong `email_address` kind (C101.2, C101.3). A query template that starts
 * from an account and connects on `email_address` is published (C102.1), and an asynchronous query
 * from the first account (the `graph-query` job on the worker, C102.4) links the second through a
 * property node with a random `gn_` id that names no value (C102.5). `add-tag` in bulk then tags
 * both accounts (C103.1, with its Idempotency-Key). The address is synthetic, at `.test`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { confirmEmailInquiry, emailCodeTemplate, waitForInquiryStatus } from './support/phase7b.js';
import { recordingClient } from './support/platform.js';

test('two accounts sharing a confirmed email are linked by a template query, and add-tag in bulk tags both (C101-C103)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = randomUUID().slice(0, 8);
  const shared = `shared-${run}@graph.test`;

  // C101.3: two accounts, each with an inquiry that confirms the shared address.
  const templateId = await emailCodeTemplate(client, `e2e-graph-${run}`);
  const first = (await client.accounts.create({ 'reference-id': `e2e-graph-a-${run}` })).data.id;
  const second = (await client.accounts.create({ 'reference-id': `e2e-graph-b-${run}` })).data.id;
  const one = await confirmEmailInquiry(stack, client, {
    templateId,
    referenceId: `e2e-graph-a-${run}`,
    address: shared,
    accountId: first,
  });
  const two = await confirmEmailInquiry(stack, client, {
    templateId,
    referenceId: `e2e-graph-b-${run}`,
    address: shared,
    accountId: second,
    exceptMailIds: [one.mailId],
  });
  await waitForInquiryStatus(client, one.inquiryId, 'completed');
  await waitForInquiryStatus(client, two.inquiryId, 'completed');

  // C102.1: a template from an account over the strong email kind, as a published draft.
  const { data: template } = await client.graphQueryTemplates.create({
    name: `e2e-graph-${run}`,
  });
  const { data: draft } = await client.graphQueryTemplates.versions.create({
    'graph-query-template-id': template.id,
    config: {
      parameters: [{ name: 'account_id', kind: 'account_id' }],
      start: [{ kind: 'account_id', value: '{{account_id}}' }],
      'connect-kinds': ['email_address'],
      'max-hops': 2,
    },
  });
  await client.graphQueryTemplates.versions.publish(draft.id);

  // C102.4: the query runs on the worker; the graph-index job may still be writing, so a query
  // that finds only its start is run again until the link is indexed.
  let query: Awaited<ReturnType<typeof client.graphQueries.retrieve>>['data'] | undefined;
  await expect
    .poll(
      async () => {
        const { data: submitted } = await client.graphQueries.create({
          'graph-query-template-id': template.id,
          'parameter-map': { account_id: first },
        });
        await expect
          .poll(
            async () => {
              query = (await client.graphQueries.retrieve(submitted.id)).data;
              return query.attributes.status;
            },
            { timeout: 20_000, intervals: [250, 500] },
          )
          .toBe('completed');
        return (query?.relationships.accounts.data ?? []).map((account) => account.id).sort();
      },
      { timeout: 50_000, intervals: [1_000, 2_000] },
    )
    .toEqual([first, second].sort());

  const attributes = query?.attributes;
  const property = attributes?.nodes.find((node) => node.type === 'email_address');
  // C102.5: the property node's value is a random id local to the result, never the address.
  expect(property?.value).toMatch(/^gn_[A-Za-z0-9_-]{22}$/u);
  expect(JSON.stringify(attributes)).not.toContain(shared);
  expect(attributes?.links).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'email_address', to: property?.value }),
    ]),
  );
  expect(attributes?.['node-limit-reached']).toBe(false);

  // C103.1: add-tag in bulk on the stored result.
  const tag = `e2e-graph-${run}`;
  const { data: action } = await client.graphQueries.action(query?.id ?? '', {
    action: 'add-tag',
    tag,
    all: true,
  });
  expect(action.attributes).toMatchObject({
    action: 'add-tag',
    preview: false,
    'selected-count': 2,
  });
  expect(
    action.attributes.outcomes.map((outcome) => [outcome.outcome, outcome['account-id']]).sort(),
  ).toEqual([first, second].sort().map((id) => ['done', id]));
  for (const id of [first, second]) {
    expect((await client.accounts.retrieve(id)).data.attributes.tags).toContain(tag);
  }
});
