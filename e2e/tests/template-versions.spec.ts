/**
 * Phase 2, C11: a template version is drafted, changed while it is a draft, then published.
 * Publishing supersedes the previous version, and inquiries keep the version that was current
 * when they were created: the flow their end user sees and their expiry come from it.
 */
import { randomUUID } from 'node:crypto';
import { problemTypeUri, type InquiryResource } from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { defaultTemplateAttributes, flowApi, recordingClient } from './support/platform.js';

/**
 * `expires-at` minus `created-at`, in whole seconds. The API computes `expires-at` with its own
 * clock while the database stamps `created-at`, so the two can differ by a few milliseconds.
 */
const lifetimeSeconds = (inquiry: InquiryResource) =>
  Math.round(
    (Date.parse(inquiry.attributes['expires-at'] ?? '') -
      Date.parse(inquiry.attributes['created-at'])) /
      1000,
  );

test('inquiries pin the version that was published when they were created', async () => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const base = await defaultTemplateAttributes(`e2e versions ${randomUUID()}`);

  const { data: template } = await client.inquiryTemplates.create({
    ...base,
    settings: { 'inquiry-expiration-seconds': 7200 },
  });
  const v1 = template.attributes['current-version'];
  expect(v1['version-number']).toBe(1);

  // Version 2: another flow (one selfie attempt) and a shorter inquiry lifetime.
  const v2Flow = {
    ...base.flow,
    // The default flow is at version 2 since C45.1, so this is the next one.
    metadata: { ...base.flow.metadata, version: base.flow.metadata.version + 1 },
    steps: base.flow.steps.map((step) =>
      step.type === 'selfie' ? { ...step, maxAttempts: 1 } : step,
    ),
  };
  const { data: draft } = await client.inquiryTemplateVersions.create({
    'inquiry-template-id': template.id,
    flow: v2Flow,
    'verification-config': base['verification-config'],
    settings: { 'inquiry-expiration-seconds': 1800 },
  });
  expect(draft.attributes).toMatchObject({
    'version-number': 2,
    status: 'draft',
    'published-at': null,
  });
  const { data: edited } = await client.inquiryTemplateVersions.update(draft.id, {
    settings: { 'inquiry-expiration-seconds': 3600 },
  });
  expect(edited.attributes.settings['inquiry-expiration-seconds']).toBe(3600);

  // A draft is never used: an inquiry created now still pins version 1.
  const { data: early } = await client.inquiries.create({
    'inquiry-template-id': template.id,
    'reference-id': `e2e-early-${randomUUID()}`,
  });
  expect(lifetimeSeconds(early)).toBe(7200);

  const { data: published } = await client.inquiryTemplateVersions.publish(draft.id);
  expect(published.attributes.status).toBe('published');
  expect(published.attributes['published-at']).not.toBeNull();

  // Published versions no longer change.
  const refused = await client.inquiryTemplateVersions
    .update(draft.id, { settings: { 'inquiry-expiration-seconds': 600 } })
    .catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(OpenVerifyApiError);
  expect(refused).toMatchObject({ status: 409, type: problemTypeUri('invalid-transition') });

  const { data: versions } = await client.inquiryTemplateVersions.list({
    filter: { 'inquiry-template-id': template.id },
  });
  expect(
    versions
      .map((version) => [version.attributes['version-number'], version.attributes.status])
      .sort(),
  ).toEqual([
    [1, 'superseded'],
    [2, 'published'],
  ]);
  const { data: current } = await client.inquiryTemplates.retrieve(template.id);
  expect(current.attributes['current-version']).toMatchObject({
    id: draft.id,
    'version-number': 2,
  });

  const { data: late } = await client.inquiries.create({
    'inquiry-template-id': template.id,
    'reference-id': `e2e-late-${randomUUID()}`,
  });
  expect(lifetimeSeconds(late)).toBe(3600);

  // The end user of each inquiry gets the flow of the version it pinned.
  const flowOf = async (inquiryId: string) => {
    const resumed = await client.inquiries.resume(inquiryId);
    return (await flowApi(stack.apiUrl, resumed.meta['session-token']).session()).flow;
  };
  const selfieAttempts = (flow: Awaited<ReturnType<typeof flowOf>>) =>
    flow.steps.find((step) => step.type === 'selfie');
  const earlyFlow = await flowOf(early.id);
  const lateFlow = await flowOf(late.id);
  expect(earlyFlow.metadata.version).toBe(base.flow.metadata.version);
  expect(selfieAttempts(earlyFlow)).toMatchObject({ maxAttempts: 3 });
  expect(lateFlow.metadata.version).toBe(base.flow.metadata.version + 1);
  expect(selfieAttempts(lateFlow)).toMatchObject({ maxAttempts: 1 });
});
