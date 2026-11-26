/**
 * C178.4 (Workflow 9B, integration-9b): an asynchronous CSV export on the full stack (C166.1 to
 * C166.4). Budget: 90 s.
 *
 * An operator holding `inquiries:read` and `inquiries:export` but not `pii:view` exports the
 * inquiries of a fresh template: the worker cuts the file, the personal columns are masked
 * (`reference-id` empty), and only the creator may read or download it; the admin, another user,
 * gets 404 for both. Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import {
  expectStatus,
  operatorWithRole,
  parseCsv,
  pollUntil,
  serverRequest,
} from './support/platform-9b.js';
import { defaultTemplateAttributes, recordingClient } from './support/platform.js';
import { sessionTokenAs } from './support/ui.js';

test('an export with masked personal data is downloaded by its creator and refused to another user (C166.1-C166.4)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const template = (
    await client.inquiryTemplates.create(
      await defaultTemplateAttributes(`e2e export ${randomUUID().slice(0, 8)}`),
    )
  ).data;
  const references = [`e2e-export-${randomUUID()}`, `e2e-export-${randomUUID()}`];
  for (const reference of references) {
    await client.inquiries.create({
      'inquiry-template-id': template.id,
      'reference-id': reference,
    });
  }
  const exporter = await operatorWithRole(stack, ['inquiries:read', 'inquiries:export'], null);
  const token = await exporter.signIn();

  const created = expectStatus(
    await serverRequest(stack, token, 'POST', '/exports', {
      data: {
        type: 'export',
        attributes: {
          'object-type': 'inquiries',
          format: 'csv',
          filter: { 'filter[inquiry-template-id]': template.id },
        },
      },
    }),
    202,
    'the export',
  ).body as { data: { id: string } };
  const id = created.data.id;
  const done = await pollUntil(
    () => serverRequest(stack, token, 'GET', `/exports/${id}`),
    (answer) =>
      ['completed', 'failed'].includes(
        (answer.body as { data: { attributes: { status: string } } }).data.attributes.status,
      ),
    60_000,
    'the export job',
  );
  expect(
    (done.body as { data: { attributes: Record<string, unknown> } }).data.attributes,
  ).toMatchObject({
    status: 'completed',
    'row-count': 2,
    'include-personal-data': false,
  });

  const download = expectStatus(
    await serverRequest(stack, token, 'GET', `/exports/${id}/download`),
    200,
    'the download',
  );
  expect(download.headers.get('content-type')).toContain('text/csv');
  const csv = String(download.body);
  const [columns = [], ...rows] = parseCsv(csv);
  const reference = columns.indexOf('reference-id');
  expect(columns, columns.join(',')).toContain('reference-id');
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row[reference]).toBe('');
  }
  for (const value of references) {
    expect(csv).not.toContain(value);
  }

  const admin = await sessionTokenAs(stack, 'admin');
  expect((await serverRequest(stack, admin, 'GET', `/exports/${id}`)).status).toBe(404);
  expect((await serverRequest(stack, admin, 'GET', `/exports/${id}/download`)).status).toBe(404);
});
