/**
 * C253, C287.3 (Workflow 11B, integration-11b): an account's access export on the full stack.
 * Budget: 90 s.
 *
 * With the stack's key (it holds `account-access:export` and sees PII), an account with an inquiry
 * is exported through `@openverify/node`: the create answers 202 `pending` and a second create 409
 * `account_export_pending` while it is in flight; the worker's `account-export` job cuts it; the
 * downloaded manifest is `openverify.account-export.v1` (the contract's strict schema), names the
 * account and its inquiry, states what it does not cover and is served `no-store`. Every value is
 * synthetic.
 */
import { randomUUID } from 'node:crypto';
import { ACCOUNT_EXPORT_SCHEMA_VERSION, accountExportManifestSchema } from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { pollUntil } from './support/platform-9b.js';
import { recordingClient } from './support/platform.js';

test('an account export is cut by the worker and its manifest downloaded and checked (C253)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = randomUUID().slice(0, 8);
  const { data: account } = await client.accounts.create({ 'reference-id': `e2e-export-${run}` });
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'account-id': account.id,
    'reference-id': `e2e-export-inquiry-${run}`,
  });

  const { data: pending } = await client.accountExports.create(account.id);
  expect(pending.attributes).toMatchObject({
    status: 'pending',
    'schema-version': ACCOUNT_EXPORT_SCHEMA_VERSION,
  });
  const second = await client.accountExports.create(account.id).catch((error: unknown) => error);
  expect(second).toBeInstanceOf(OpenVerifyApiError);
  expect((second as OpenVerifyApiError).status).toBe(409);
  expect((second as OpenVerifyApiError).code).toBe('account_export_pending');

  const ready = await pollUntil(
    async () => (await client.accountExports.retrieve(pending.id)).data,
    (current) => current.attributes.status !== 'pending',
    60_000,
    'the export',
  );
  expect(ready.attributes.status).toBe('ready');

  const raw = await fetch(`${stack.apiUrl}/api/v1/account-exports/${pending.id}/manifest`, {
    headers: { authorization: `Bearer ${stack.apiKey}`, accept: 'application/json' },
  });
  expect(raw.status).toBe(200);
  expect(raw.headers.get('cache-control')).toContain('no-store');
  const manifest = accountExportManifestSchema.parse(await raw.json());
  expect(manifest.schema).toBe(ACCOUNT_EXPORT_SCHEMA_VERSION);
  expect(manifest['account-id']).toBe(account.id);
  expect(manifest.subject.account.id).toBe(account.id);
  expect(manifest.subject.inquiries.map((record) => record.id)).toContain(inquiry.id);
  expect(manifest['not-covered'].length).toBeGreaterThan(0);
  expect(await client.accountExports.manifest(pending.id)).toEqual(manifest);
});
