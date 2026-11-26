/**
 * Phase 2, C16: redacting an inquiry deletes its stored files (every version: the bucket has
 * versioning on) and stubs every stored event about it; the retention job, run with an injected
 * clock, redacts a finished inquiry once its template's retention has passed.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { runRetentionAsOf } from './support/commands.js';
import {
  dashboardRequest,
  defaultTemplateAttributes,
  flowApi,
  recordingClient,
} from './support/platform.js';
import { sessionTokenAs } from './support/ui.js';
import { objectStore, storageKeysOf } from './support/storage.js';

const DAY_MS = 86_400_000;

test('redaction deletes the stored files and stubs the events about the inquiry', async () => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const store = objectStore(stack);
  try {
    const { data: inquiry } = await client.inquiries.create({
      'inquiry-template-id': stack.defaultTemplateId,
      'reference-id': `e2e-redact-${randomUUID()}`,
      fields: { name_first: 'Synthetic' },
    });

    // The end user uploads both sides of the synthetic ID.
    const resumed = await client.inquiries.resume(inquiry.id);
    const flow = flowApi(stack.apiUrl, resumed.meta['session-token']);
    const session = await flow.session();
    const consent = session.flow.steps.find((step) => step.type === 'consent');
    await flow.consent(consent?.type === 'consent' ? consent.textKeys : []);
    const verificationId = await flow.createVerification('government-id');
    const fileIds = [
      await flow.upload(verificationId, 'front', FIXTURES.idFront),
      await flow.upload(verificationId, 'back', FIXTURES.idBack),
    ];
    const keys = await storageKeysOf(stack, fileIds);
    for (const key of keys) {
      expect(await store.headStatus(key)).toBe(200);
      expect(await store.versions(key)).not.toEqual([]);
    }
    const eventsBefore = (await client.events.list({ filter: { 'object-id': inquiry.id } })).data;
    expect(eventsBefore.map((event) => event.attributes.name)).toEqual(
      expect.arrayContaining(['inquiry.created', 'inquiry.started']),
    );

    const { data: redacted } = await client.inquiries.redact(inquiry.id);
    const redactedAt = redacted.attributes['redacted-at'];
    expect(redactedAt).not.toBeNull();

    // No copy of the ciphertext is left, not even a noncurrent version.
    for (const key of keys) {
      expect(await store.headStatus(key)).toBe(404);
      expect(await store.versions(key)).toEqual([]);
    }
    // Every event stored before the redaction now holds only the stub (C16).
    const eventsAfter = (await client.events.list({ filter: { 'object-id': inquiry.id } })).data;
    for (const before of eventsBefore) {
      const after = eventsAfter.find((event) => event.id === before.id);
      expect(after?.attributes.payload, before.attributes.name).toEqual({
        data: { type: 'inquiry', id: inquiry.id, attributes: { 'redacted-at': redactedAt } },
      });
    }
    // `inquiry.redacted`, written by the redaction, carries the inquiry as it now is: no PII.
    const redactedEvent = eventsAfter.find((event) => event.attributes.name === 'inquiry.redacted');
    expect(redactedEvent?.attributes.payload.data.attributes).toMatchObject({
      fields: {},
      note: null,
      'redacted-at': redactedAt,
    });
    expect(JSON.stringify(eventsAfter)).not.toContain('Synthetic');
    // The dashboard can no longer serve the files (410 redacted).
    const adminToken = await sessionTokenAs(stack, 'admin');
    const content = await fetch(
      `${stack.apiUrl}/api/v1/dashboard/files/${fileIds[0] ?? ''}/content`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(content.status).toBe(410);
    await content.body?.cancel();

    // Redaction is idempotent.
    const { data: again } = await client.inquiries.redact(inquiry.id);
    expect(again.attributes['redacted-at']).toBe(redactedAt);
  } finally {
    store.close();
  }
});

test('the retention job, run with an injected clock, redacts a finished inquiry past its retention', async () => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: template } = await client.inquiryTemplates.create({
    ...(await defaultTemplateAttributes(`e2e retention ${randomUUID()}`)),
    settings: { 'retention-days': 1 },
  });
  const finished = async (templateId: string) => {
    const { data } = await client.inquiries.create({
      'inquiry-template-id': templateId,
      'reference-id': `e2e-retention-${randomUUID()}`,
      fields: { name_first: 'Synthetic' },
    });
    await client.inquiries.performSimulateActions(data.id, {
      actions: [{ type: 'start_inquiry' }, { type: 'complete_inquiry' }],
    });
    return data.id;
  };
  const expiring = await finished(template.id);
  // The default template keeps finished inquiries (the environment's retention is unset).
  const kept = await finished(stack.defaultTemplateId);

  // As of now, one day of retention has not passed yet.
  const today = await runRetentionAsOf(new Date());
  expect(today.report.failedRedactions).toBe(0);
  expect((await client.inquiries.retrieve(expiring)).data.attributes['redacted-at']).toBeNull();

  const later = new Date(Date.now() + 2 * DAY_MS);
  const run = await runRetentionAsOf(later);
  expect(run.now).toBe(later.toISOString());
  expect(run.report.redactedInquiries).toBeGreaterThanOrEqual(1);
  expect(run.report.failedRedactions).toBe(0);

  const { data: redacted } = await client.inquiries.retrieve(expiring);
  expect(redacted.attributes['redacted-at']).not.toBeNull();
  // Stamped with the real time, not the evaluation time.
  expect(Date.parse(redacted.attributes['redacted-at'] ?? '')).toBeLessThan(later.getTime());
  const names = (await client.events.list({ filter: { 'object-id': expiring } })).data.map(
    (event) => event.attributes.name,
  );
  expect(names).toContain('inquiry.redacted');
  expect((await client.inquiries.retrieve(kept)).data.attributes['redacted-at']).toBeNull();

  // Settings say why: the environment keeps finished inquiries unless a template says otherwise.
  const adminToken = await sessionTokenAs(stack, 'admin');
  const settings = await dashboardRequest(stack, 'GET', '/settings', { token: adminToken });
  expect((settings.body as Record<string, unknown>)['inquiry-retention-days']).toBeNull();
});
