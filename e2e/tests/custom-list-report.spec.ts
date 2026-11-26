/**
 * C106.2 (Workflow 7B): the `custom-list` report, full stack, on the seeded `Default custom list`
 * template (no list pinned, so each report names its own). Budget: 90 s.
 *
 * An email-address list holds one synthetic address. A report for that address is `ready` with
 * `has-match: true`: the list matched exactly (R tier), with the list's provenance in `sources`
 * (its version and `normaliser-version`, no sync). A report for another address on the same list
 * is `ready` with `has-match: false` and no unscreened list, the one case where "no match" is said
 * (ADR 0005). A report with no list at all is refused with `report_lists_required`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { recordingClient } from './support/platform.js';
import { attributesOf, seededTemplateId, waitForReport } from './support/reports.js';

test('a custom-list report matches a listed address with the list’s provenance, says no match for another only when every list was read, and needs a list (C106.2)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = randomUUID().slice(0, 8);
  const listed = `listed-${run}@report.test`;
  const templateId = await seededTemplateId(client, 'custom-list');

  const { data: list } = await client.lists.create('email-addresses', {
    name: `e2e-custom-list-${run}`,
  });
  const { data: item } = await client.listItems.create('email-addresses', {
    'list-id': list.id,
    value: listed,
  });

  const report = async (address: string) => {
    const { data } = await client.reports.create(
      'report/custom-list',
      {
        'report-template-id': templateId,
        query: { 'email-address': address, 'list-ids': [list.id] },
      },
      { 'auto-create-account': false },
    );
    return attributesOf(await waitForReport(client, data.id));
  };
  const [matched, clear] = await Promise.all([report(listed), report(`clear-${run}@report.test`)]);

  expect(matched).toMatchObject({
    status: 'ready',
    'has-match': true,
    'lists-searched': [list.id],
    unscreened: [],
  });
  expect(matched.sources).toEqual([
    expect.objectContaining({ 'list-id': list.id, 'normaliser-version': 'lists-1' }),
  ]);
  expect(matched['matched-lists']).toEqual([
    expect.objectContaining({
      'list-id': list.id,
      'list-type': 'list/email-address',
      items: [
        expect.objectContaining({
          'list-item': { type: 'list-item/email-address', id: item.id },
          method: 'exact',
          tier: 'R',
          'matched-value': listed,
        }),
      ],
    }),
  ]);

  // ADR 0005: "no match" only beside `ready` with every selected list read.
  expect(clear).toMatchObject({
    status: 'ready',
    'has-match': false,
    'lists-searched': [list.id],
    unscreened: [],
  });

  // C106.2: a report with no list on the query or the template is refused.
  await expect(
    client.reports.create(
      'report/custom-list',
      { 'report-template-id': templateId, query: { 'email-address': listed } },
      { 'auto-create-account': false },
    ),
  ).rejects.toMatchObject({ status: 422, problem: { code: 'report_lists_required' } });
});
