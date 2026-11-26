/**
 * C24 specs 3, 6, 7 and 9: the inquiry, template and account pages of the dashboard (C23), full
 * stack. Inquiries, templates and uploads are set up through the server API with
 * `@openverify/node`, as a customer backend would; every decision is then taken in the browser.
 *
 * 3. A reviewer approves an inquiry from its page; a viewer sees its fields as "Hidden" and no
 *    action buttons.
 * 6. A developer drafts a template version, edits its JSON (a refused value shows its error by
 *    path) and publishes it; a new inquiry pins the published version, an older one keeps its own.
 * 7. A reviewer consolidates two accounts; the source account's inquiries move to the target.
 * 9. A reviewer redacts an inquiry with a typed confirmation; its files then answer 410 and its
 *    fields show as redacted.
 */
import { randomUUID } from 'node:crypto';
import type { InquiryResource } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo, type StackInfo } from '../src/stack-info.js';
import { defaultTemplateAttributes, flowApi, recordingClient } from './support/platform.js';
import { signInAs } from './support/ui.js';

/** A toast or any other polite message with this text. */
const notice = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** A titled section of a console page. */
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** A sandbox inquiry the end user finished (C10 simulate actions), with one synthetic field. */
async function completedInquiry(client: OpenVerifyClient, stack: StackInfo, label: string) {
  const { data } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `ui-${label}-${randomUUID()}`,
    fields: { name_first: 'Synthetic' },
  });
  const { data: completed } = await client.inquiries.performSimulateActions(data.id, {
    actions: [{ type: 'start_inquiry' }, { type: 'complete_inquiry' }],
  });
  expect(completed.attributes.status).toBe('completed');
  return completed;
}

/** What the dashboard's file route answers this browser for a file (same origin, its cookie). */
function fileStatus(page: Page, fileId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/files/${id}/content`, { cache: 'no-store' });
    return response.status;
  }, fileId);
}

/** Clicks a confirmed action's button, then the dialog's confirm button. */
async function confirm(page: Page, trigger: Locator, dialogName: string, confirmLabel: string) {
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: confirmLabel }).click();
  await expect(dialog).toBeHidden();
}

test('a reviewer approves an inquiry from its page; a viewer sees "Hidden" fields and no actions', async ({
  page,
  browser,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const inquiry = await completedInquiry(client, stack, 'review');
  const inquiryUrl = `${stack.dashboardUrl}/inquiries/${inquiry.id}`;

  await signInAs(page, stack, 'reviewer');
  await page.goto(inquiryUrl);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(inquiry.id);
  await expect(region(page, 'Fields')).toContainText('Synthetic');
  const actions = page.getByRole('group', { name: 'Inquiry actions' });
  await expect(actions.getByRole('button')).toHaveText([
    'Approve',
    'Decline',
    'Mark for review',
    'Redact',
  ]);

  await confirm(
    page,
    actions.getByRole('button', { name: 'Approve' }),
    'Approve this inquiry?',
    'Approve inquiry',
  );

  await expect(notice(page, 'The inquiry was approved.')).toBeVisible();
  await expect(page.getByRole('main').locator('[data-status="approved"]').first()).toHaveText(
    'Approved',
  );
  // A decision is final: only redaction is left.
  await expect(actions.getByRole('button')).toHaveText(['Redact']);
  const { data: approved } = await client.inquiries.retrieve(inquiry.id);
  expect(approved.attributes.status).toBe('approved');
  expect(approved.attributes['decisioned-at']).not.toBeNull();
  const names = (await client.events.list({ filter: { 'object-id': inquiry.id } })).data.map(
    (event) => event.attributes.name,
  );
  expect(names).toEqual(expect.arrayContaining(['inquiry.approved', 'inquiry.transitioned']));

  // A viewer, in another browser: every field is masked, and nothing can be changed.
  const viewerContext = await browser.newContext();
  try {
    const viewer = await viewerContext.newPage();
    await signInAs(viewer, stack, 'viewer');
    await viewer.goto(inquiryUrl);
    await expect(viewer.getByRole('heading', { level: 1 })).toContainText(inquiry.id);
    const fields = region(viewer, 'Fields');
    await expect(fields).toContainText('name_first');
    await expect(fields.getByText('Hidden', { exact: true })).toBeVisible();
    await expect(fields).not.toContainText('Synthetic');
    await expect(region(viewer, 'Note').getByText('Hidden', { exact: true })).toBeVisible();
    await expect(viewer.getByRole('group', { name: 'Inquiry actions' })).toHaveCount(0);
    await expect(
      viewer.getByRole('main').getByRole('button', {
        name: /Approve|Decline|Mark for review|Expire|Redact|Edit|Add|Remove/,
      }),
    ).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }
});

/**
 * `expires-at` minus `created-at`, in whole seconds: the inquiry lifetime of the version the
 * inquiry pinned (C10, C11).
 */
const lifetimeSeconds = (inquiry: InquiryResource) =>
  Math.round(
    (Date.parse(inquiry.attributes['expires-at'] ?? '') -
      Date.parse(inquiry.attributes['created-at'])) /
      1000,
  );

test('a developer drafts a template version, edits its JSON and publishes it; a new inquiry pins it', async ({
  page,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  // A template of its own: other specs rely on the default template's published version.
  const base = await defaultTemplateAttributes(`ui versions ${randomUUID()}`);
  const { data: template } = await client.inquiryTemplates.create({
    ...base,
    settings: { 'inquiry-expiration-seconds': 7200 },
  });

  await signInAs(page, stack, 'developer');
  await page.goto(`${stack.dashboardUrl}/templates/${template.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: template.attributes.name }),
  ).toBeVisible();
  await page
    .getByRole('group', { name: 'Template actions' })
    .getByRole('button', { name: 'New draft' })
    .click();

  await expect(page).toHaveURL(new RegExp(`/templates/${template.id}/versions/itmplv_\\w{26}$`));
  const draftId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Version 2');
  const editor = page.getByRole('form', { name: 'Edit the draft' });
  const settings = editor.getByRole('textbox', { name: 'Settings' });
  const flow = editor.getByRole('textbox', { name: 'Flow' });
  expect(JSON.parse(await settings.inputValue())).toMatchObject({
    'inquiry-expiration-seconds': 7200,
  });

  // A value the contract refuses: the error shows in the Settings document, by its path.
  await settings.fill('{ "inquiry-expiration-seconds": 10 }');
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByRole('list', { name: 'Problems in Settings' })).toContainText(
    '/inquiry-expiration-seconds',
  );

  // Version 2: one selfie attempt, and a one-hour inquiry lifetime.
  const flowDocument = JSON.parse(await flow.inputValue()) as typeof base.flow;
  const editedFlow = {
    ...flowDocument,
    // The default flow is at version 2 since C45.1, so the edit makes the next one.
    metadata: { ...flowDocument.metadata, version: flowDocument.metadata.version + 1 },
    steps: flowDocument.steps.map((step) =>
      step.type === 'selfie' ? { ...step, maxAttempts: 1 } : step,
    ),
  };
  await flow.fill(JSON.stringify(editedFlow, null, 2));
  await settings.fill(JSON.stringify({ 'inquiry-expiration-seconds': 3600 }, null, 2));
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(notice(page, 'Saved the draft.')).toBeVisible();
  const { data: saved } = await client.inquiryTemplateVersions.retrieve(draftId);
  expect(saved.attributes).toMatchObject({
    status: 'draft',
    settings: { 'inquiry-expiration-seconds': 3600 },
    flow: { metadata: { version: flowDocument.metadata.version + 1 } },
  });

  // A draft is never used: an inquiry created now still pins version 1.
  const { data: early } = await client.inquiries.create({
    'inquiry-template-id': template.id,
    'reference-id': `ui-early-${randomUUID()}`,
  });
  expect(lifetimeSeconds(early)).toBe(7200);

  await confirm(
    page,
    page.getByRole('button', { name: 'Publish', exact: true }),
    'Publish version 2?',
    'Publish version',
  );
  await expect(notice(page, 'Version 2 was published.')).toBeVisible();
  await expect(page.getByRole('main').locator('[data-status="published"]').first()).toHaveText(
    'Published',
  );
  await expect(page.getByRole('form', { name: 'Edit the draft' })).toHaveCount(0);

  const { data: current } = await client.inquiryTemplates.retrieve(template.id);
  expect(current.attributes['current-version']).toMatchObject({ id: draftId, 'version-number': 2 });
  const { data: versions } = await client.inquiryTemplateVersions.list({
    filter: { 'inquiry-template-id': template.id },
  });
  expect(
    versions.map((version) => [version.attributes['version-number'], version.attributes.status]),
  ).toEqual([
    [2, 'published'],
    [1, 'superseded'],
  ]);

  // A new inquiry pins version 2; the early one keeps version 1, for good.
  const { data: late } = await client.inquiries.create({
    'inquiry-template-id': template.id,
    'reference-id': `ui-late-${randomUUID()}`,
  });
  expect(lifetimeSeconds(late)).toBe(3600);
  const flowOf = async (inquiryId: string) => {
    const resumed = await client.inquiries.resume(inquiryId);
    return (await flowApi(stack.apiUrl, resumed.meta['session-token']).session()).flow;
  };
  const lateFlow = await flowOf(late.id);
  expect(lateFlow.metadata.version).toBe(flowDocument.metadata.version + 1);
  expect(lateFlow.steps.find((step) => step.type === 'selfie')).toMatchObject({ maxAttempts: 1 });
  expect((await flowOf(early.id)).metadata.version).toBe(flowDocument.metadata.version);

  // The template page shows the published version as current.
  await page.goto(`${stack.dashboardUrl}/templates/${template.id}`);
  await expect(region(page, 'Current version')).toContainText('Version 2');
  await expect(region(page, 'Current version')).toContainText('3,600 seconds');
});

test('a reviewer consolidates two accounts in the dashboard and the inquiries move', async ({
  page,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const reference = (label: string) => `ui-${label}-${randomUUID()}`;
  const [targetRef, sourceRef] = [reference('target'), reference('source')];
  const create = async (referenceId: string) =>
    (
      await client.inquiries.create({
        'inquiry-template-id': stack.defaultTemplateId,
        'reference-id': referenceId,
      })
    ).data;
  const accountOf = (inquiry: InquiryResource) => inquiry.relationships.account?.data?.id ?? '';
  const targetInquiry = await create(targetRef);
  const sourceInquiries = [await create(sourceRef), await create(sourceRef)];
  const targetId = accountOf(targetInquiry);
  const sourceId = accountOf(sourceInquiries[0] ?? targetInquiry);
  expect(targetId).toMatch(/^acc_/);
  expect(sourceId).toMatch(/^acc_/);
  expect(sourceId).not.toBe(targetId);

  await signInAs(page, stack, 'reviewer');
  await page.goto(`${stack.dashboardUrl}/accounts/${targetId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(targetId);
  const inquiries = region(page, 'Inquiries');
  await expect(inquiries.getByRole('link', { name: targetInquiry.id })).toBeVisible();
  for (const inquiry of sourceInquiries) {
    await expect(inquiries.getByRole('link', { name: inquiry.id })).toHaveCount(0);
  }

  await page
    .getByRole('group', { name: 'Account actions' })
    .getByRole('button', { name: 'Consolidate' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Consolidate accounts into this one?' });
  await dialog.getByRole('textbox', { name: 'Source account IDs' }).fill(sourceId);
  await dialog.getByRole('button', { name: 'Consolidate accounts' }).click();
  await expect(dialog).toBeHidden();
  await expect(notice(page, 'The accounts were consolidated.')).toBeVisible();

  // The source's inquiries are now the target's, on the page and in the API.
  for (const inquiry of sourceInquiries) {
    await expect(inquiries.getByRole('link', { name: inquiry.id })).toBeVisible();
    const { data } = await client.inquiries.retrieve(inquiry.id);
    expect(accountOf(data)).toBe(targetId);
  }
  const { data: source } = await client.accounts.retrieve(sourceId);
  expect(source.attributes).toMatchObject({ status: 'archived', 'consolidated-into': targetId });

  // The source account's page says where it went.
  await page.goto(`${stack.dashboardUrl}/accounts/${sourceId}`);
  await expect(page.getByRole('main').locator('[data-status="archived"]').first()).toHaveText(
    'Archived',
  );
  const consolidated = page.getByRole('status', { name: 'Consolidated' });
  await expect(consolidated.getByRole('link', { name: targetId })).toHaveAttribute(
    'href',
    `/accounts/${targetId}`,
  );
});

test('a reviewer redacts an inquiry in the dashboard; its files then answer 410 and its fields show as redacted', async ({
  page,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `ui-redact-${randomUUID()}`,
    fields: { name_first: 'Synthetic' },
  });
  // The end user consents and uploads both sides of the synthetic ID.
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

  await signInAs(page, stack, 'reviewer');
  await page.goto(`${stack.dashboardUrl}/inquiries/${inquiry.id}`);
  await expect(region(page, 'Fields')).toContainText('Synthetic');
  const front = page.getByRole('img', { name: 'Government ID, front' });
  await expect(front).toBeVisible();
  // A lazy image loads only near the viewport, and the decision records now sit above the images.
  await front.scrollIntoViewIfNeeded();
  await expect
    .poll(() => front.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  for (const fileId of fileIds) {
    expect(await fileStatus(page, fileId)).toBe(200);
  }

  await page
    .getByRole('group', { name: 'Inquiry actions' })
    .getByRole('button', { name: 'Redact' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Redact this inquiry?' });
  const confirmButton = dialog.getByRole('button', { name: 'Redact inquiry' });
  await expect(confirmButton).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Type redact to confirm' }).fill('redact');
  await confirmButton.click();
  await expect(dialog).toBeHidden();
  await expect(notice(page, 'The inquiry was redacted.')).toBeVisible();

  // The page shows the redaction: no fields, no images, no second redaction.
  await expect(page.getByRole('status', { name: 'Redacted' })).toContainText(
    'This inquiry was redacted',
  );
  await expect(region(page, 'Fields').getByText('Redacted', { exact: true })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Synthetic');
  await expect(page.getByRole('img')).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Government ID images' }).getByText('Redacted', { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole('group', { name: 'Inquiry actions' }).getByRole('button', { name: 'Redact' }),
  ).toHaveCount(0);

  // The files are gone for good: the dashboard's file route passes the API's 410 on.
  for (const fileId of fileIds) {
    expect(await fileStatus(page, fileId)).toBe(410);
  }
  const { data: redacted } = await client.inquiries.retrieve(inquiry.id);
  expect(redacted.attributes['redacted-at']).not.toBeNull();
  expect(redacted.attributes.fields).toEqual({});
});
