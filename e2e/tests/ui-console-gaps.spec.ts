/**
 * C27 (Workflow 2E): the console pages added for the C25 API, full stack.
 *
 * - An account type is edited on its page: adding a field works, and removing one shows the
 *   API's 422 at that field's path (C25.3, C26).
 * - The inquiry timeline lists the events of its verification and session, read with
 *   `filter[inquiry-id]` (C25.7), and the verification page they link shows its checks (C26).
 *
 * Account types, inquiries and uploads are set up through the server and flow APIs, as a
 * customer backend and the hosted flow would; the console is then used in the browser.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import {
  flowApi,
  giveFlowConsent,
  recordingClient,
  submitGovernmentId,
} from './support/platform.js';
import { signInAs } from './support/ui.js';

/** A toast or any other polite message with this text. */
const notice = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** A titled section of a console page. */
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test('an account type is edited: adding a field works, and removing one shows the API refusal at its path (C25.3)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const name = `ui-type-${randomUUID().slice(0, 8)}`;
  const legalName = { type: 'string', label: 'Legal name' } as const;
  const founded = { type: 'date', label: 'Founded on' } as const;
  const { data: type } = await client.accountTypes.create({
    name,
    'fields-schema': { legal_name: legalName },
  });

  await signInAs(page, stack, 'reviewer');
  await page.goto(`${stack.dashboardUrl}/account-types/${type.id}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const form = page.getByRole('form', { name: 'Edit the account type' });
  const schema = form.getByRole('textbox', { name: 'Fields schema' });
  expect(JSON.parse(await schema.inputValue())).toEqual({ legal_name: legalName });

  // Adding a field, and changing a label: the change is additive, so the API takes it.
  await schema.fill(
    JSON.stringify({ legal_name: { ...legalName, label: 'Registered name' }, founded }, null, 2),
  );
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(notice(page, 'Saved the account type.')).toBeVisible();
  const fields = page.getByRole('table', { name: `Fields of ${name}` });
  await expect(fields.getByRole('rowheader', { name: 'founded' })).toBeVisible();
  await expect(fields).toContainText('Registered name');
  expect((await client.accountTypes.retrieve(type.id)).data.attributes['fields-schema']).toEqual({
    legal_name: { ...legalName, label: 'Registered name' },
    founded,
  });

  // Leaving a field out removes it: the API refuses, naming the field by its path.
  await schema.fill(JSON.stringify({ founded }, null, 2));
  await form.getByRole('button', { name: 'Save changes' }).click();
  const problems = form.getByRole('list', { name: 'Problems in Fields schema' });
  await expect(problems).toContainText('/legal_name');
  await expect(problems).toContainText('cannot be removed');
  await expect(form).toContainText('An account type change may add fields and change labels only.');
  // What was typed stays, and the type keeps the field.
  expect(JSON.parse(await schema.inputValue())).toEqual({ founded });
  expect(
    (await client.accountTypes.retrieve(type.id)).data.attributes['fields-schema'],
  ).toHaveProperty('legal_name');
});

test('the inquiry timeline shows its verification and session events, and the verification page its checks (C25.7)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `ui-timeline-${randomUUID()}`,
  });
  // The end user consents, uploads both sides of the synthetic ID and submits it.
  const sessionToken = (await client.inquiries.resume(inquiry.id)).meta['session-token'];
  const flow = flowApi(stack.apiUrl, sessionToken);
  await giveFlowConsent(flow);
  const verificationId = await submitGovernmentId(flow, {
    front: FIXTURES.idFront,
    back: FIXTURES.idBack,
  });

  // The worker runs the checks with the vision service.
  await expect
    .poll(
      async () => (await client.verifications.retrieve(verificationId)).data.attributes.status,
      { timeout: 120_000, intervals: [1_000] },
    )
    .toMatch(/^(passed|failed)$/);
  const { data: verification } = await client.verifications.retrieve(verificationId);
  expect(verification.attributes.checks.length).toBeGreaterThan(0);

  await signInAs(page, stack, 'reviewer');
  await page.goto(`${stack.dashboardUrl}/inquiries/${inquiry.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(inquiry.id);
  // The inquiry names the template version it pinned (C25.4).
  await expect(region(page, 'Details')).toContainText(/itmplv_[0-9A-Z]{26}/);

  const timeline = region(page, 'Timeline');
  const outcome = `Government ID verification ${verification.attributes.status}`;
  await expect(timeline.getByRole('link', { name: outcome })).toBeVisible();
  await expect(
    timeline.getByRole('link', { name: 'Government ID verification submitted' }),
  ).toBeVisible();
  await expect(timeline.getByText('Session started', { exact: true })).toBeVisible();

  await timeline.getByRole('link', { name: outcome }).click();
  await expect(page).toHaveURL(new RegExp(`/verifications/${verificationId}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    `Government ID verification ${verificationId}`,
  );
  // What needs the operator stays in view; the rest open from their disclosure (C37).
  const checks = region(page, 'Checks');
  await checks
    .locator('summary')
    .filter({ hasText: /^(Other|All) checks: / })
    .click();
  for (const check of verification.attributes.checks) {
    await expect(checks.getByRole('rowheader', { name: check.name, exact: true })).toBeVisible();
  }
  // A reviewer has pii:view: the images show through the dashboard's file route.
  const front = region(page, 'Files').getByRole('img', { name: 'Government ID, front' });
  await expect(front).toBeVisible();
  // A lazy image loads only near the viewport (the rendition route serves it, C135.3).
  await front.scrollIntoViewIfNeeded();
  await expect
    .poll(() => front.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});
