/**
 * C178.4 (Workflow 9B, integration-9b): bulk report creation from a CSV on the full stack
 * (C166.5). Budget: 90 s.
 *
 * Three `ip-address` rows go to the seeded template: two documentation addresses create their
 * reports with origin `bulk`, and a row that is not an address is reported failed with its code,
 * never skipped (rule 10). Every address is from the documentation ranges.
 */
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectStatus, pollUntil, serverRequest } from './support/platform-9b.js';
import { recordingClient } from './support/platform.js';
import { seededTemplateId } from './support/reports.js';

interface BulkJob {
  data: {
    id: string;
    attributes: {
      status: string;
      rows: {
        row: number;
        outcome: string;
        'report-id': string | null;
        'error-code': string | null;
      }[];
    };
  };
}

test('a bulk report CSV creates each row’s report or reports the row failed (C166.5)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const templateId = await seededTemplateId(client, 'ip-address');
  const form = new FormData();
  form.append('report-template-id', templateId);
  form.append(
    'file',
    new Blob(['ip-address\n192.0.2.41\nnot-an-address\n198.51.100.42\n'], { type: 'text/csv' }),
    'synthetic-bulk.csv',
  );

  const created = expectStatus(
    await serverRequest(stack, stack.apiKey, 'POST', '/reports/bulk', form),
    202,
    'the bulk upload',
  ).body as BulkJob;
  const job = await pollUntil(
    async () =>
      (await serverRequest(stack, stack.apiKey, 'GET', `/reports/bulk/${created.data.id}`))
        .body as BulkJob,
    (answer) => ['completed', 'failed'].includes(answer.data.attributes.status),
    60_000,
    'the bulk job',
  );

  expect(job.data.attributes.status).toBe('completed');
  const rows = job.data.attributes.rows;
  expect(rows.map((row) => [row.row, row.outcome])).toEqual([
    [1, 'created'],
    [2, 'failed'],
    [3, 'created'],
  ]);
  expect(rows[1]?.['error-code']).not.toBeNull();
  for (const row of [rows[0], rows[2]]) {
    const report = await client.reports.retrieve(row?.['report-id'] ?? '');
    expect(report.data.attributes.origin).toBe('bulk');
  }
});
