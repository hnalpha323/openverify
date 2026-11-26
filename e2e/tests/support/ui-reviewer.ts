/**
 * `dashboard-reviewer`'s full-stack helpers (C142.6): a case of the spec's own on a published
 * template, holding a completed inquiry to decide and an inquiry with a government ID front and a
 * centre selfie to compare, and a case action bound to the template on a running `trigger-case`
 * workflow. Every value is synthetic: fictional names, `example.test` addresses, generated images.
 */
import { readFile } from 'node:fs/promises';
import type { OpenVerifyClient } from '@openverify/node';
import { expect } from '@playwright/test';
import { FIXTURES, selfieStill } from '../../src/paths.js';
import type { StackInfo } from '../../src/stack-info.js';
import { publishedCaseTemplate } from './cases.js';
import {
  flowApi,
  giveFlowConsent,
  recordingClient,
  settledFlowVerification,
  submitGovernmentId,
} from './platform.js';
import { chainDefinition, runningWorkflow } from './workflows.js';

export interface ReviewerCase {
  readonly caseId: string;
  readonly templateId: string;
  /** Completed through sandbox simulation, so a reviewer can decide it. */
  readonly decisionInquiryId: string;
  /** With a government ID front and a centre selfie uploaded, for the compare panel. */
  readonly compareInquiryId: string;
  readonly actionLabel: string;
  readonly workflowId: string;
}

/** A running `trigger-case` workflow that takes one required input, and its case action. */
async function caseAction(
  admin: OpenVerifyClient,
  templateId: string,
  run: string,
): Promise<{ label: string; workflowId: string }> {
  const workflowId = await runningWorkflow(
    admin,
    `e2e ui reviewer action ${run}`,
    chainDefinition({ type: 'trigger-case', config: {} }, [], {
      inputs: [{ name: 'reference', type: 'string', required: true }],
    }),
  );
  const label = `Synthetic re-screen ${run}`;
  await admin.caseActions.create({
    'workflow-id': workflowId,
    'case-template-ids': [templateId],
    label,
  });
  return { label, workflowId };
}

/** A completed inquiry, through the sandbox's simulate actions. */
async function completedInquiry(client: OpenVerifyClient, stack: StackInfo, run: string) {
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-ui-reviewer-decide-${run}`,
    fields: { name_first: 'Synthetic', name_last: 'Decider' },
  });
  await client.inquiries.performSimulateActions(inquiry.id, {
    actions: [{ type: 'start_inquiry' }, { type: 'complete_inquiry' }],
  });
  await expect
    .poll(async () => (await client.inquiries.retrieve(inquiry.id)).data.attributes.status, {
      timeout: 20_000,
    })
    .toBe('completed');
  return inquiry.id;
}

/**
 * An inquiry with a government ID and a centre selfie uploaded through the flow API. Since
 * Workflow 9A only the step the server's position names takes input (C151.4), so the ID is
 * submitted and decided before the selfie step opens.
 */
async function inquiryToCompare(client: OpenVerifyClient, stack: StackInfo, run: string) {
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-ui-reviewer-compare-${run}`,
    fields: { name_first: 'Synthetic', name_last: 'Comparer' },
  });
  const resumed = await client.inquiries.resume(inquiry.id);
  const flow = flowApi(stack.apiUrl, resumed.meta['session-token']);
  await giveFlowConsent(flow);
  const governmentId = await submitGovernmentId(flow, {
    front: FIXTURES.idFront,
    back: FIXTURES.idBack,
  });
  await settledFlowVerification(flow, governmentId, 60_000);
  const selfie = await flow.createVerification('selfie');
  await uploadCentrePose(stack.apiUrl, resumed.meta['session-token'], selfie);
  return inquiry.id;
}

/**
 * The centre pose through a capture (C40.2, C40.3): a selfie verification created since Phase 4
 * takes a pose only with its capture's id and nonce, sent before the file. `upload` is the sandbox's
 * capture method, so no camera is needed.
 */
async function uploadCentrePose(apiUrl: string, token: string, verificationId: string) {
  const call = async (path: string, init: { method: 'POST'; json?: string; body?: FormData }) => {
    const headers = new Headers({ accept: 'application/json', authorization: `Bearer ${token}` });
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json');
    }
    const response = await fetch(`${apiUrl}/api/v1/flow/verifications/${verificationId}${path}`, {
      method: init.method,
      headers,
      body: init.json ?? init.body ?? null,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${path} answered ${String(response.status)}: ${text}`);
    }
    return JSON.parse(text) as { data: { id: string; attributes: { nonce?: string } } };
  };
  const capture = await call('/selfies', {
    method: 'POST',
    json: JSON.stringify({ method: 'upload' }),
  });
  const form = new FormData();
  form.append('kind', 'selfie-center');
  form.append('capture-id', capture.data.id);
  form.append('nonce', capture.data.attributes.nonce ?? '');
  form.append('client-elapsed-ms', '1500');
  form.append(
    'file',
    new Blob([await readFile(selfieStill('a', 'center'))], { type: 'image/jpeg' }),
    'upload.jpg',
  );
  await call('/files', { method: 'POST', body: form });
}

/** Everything the reviewer spec works on, created through the API for this run alone. */
export async function reviewerCase(
  admin: OpenVerifyClient,
  stack: StackInfo,
  run: string,
): Promise<ReviewerCase> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const template = await publishedCaseTemplate(admin, `e2e ui reviewer ${run}`);
  const [action, decisionInquiryId, compareInquiryId] = await Promise.all([
    caseAction(admin, template.id, run),
    completedInquiry(client, stack, run),
    inquiryToCompare(client, stack, run),
  ]);
  const { data: made } = await admin.cases.create(
    { 'case-template-id': template.id },
    { 'object-ids': [decisionInquiryId] },
  );
  // Attached after, so it is the newest held inquiry: the one the compare panel reads.
  await admin.cases.addObjects(made.id, { 'object-ids': [compareInquiryId] });
  return {
    caseId: made.id,
    templateId: template.id,
    decisionInquiryId,
    compareInquiryId,
    actionLabel: action.label,
    workflowId: action.workflowId,
  };
}

/** Ends what the spec made that keeps running: the workflow, paused then archived. */
export async function endReviewerCase(
  admin: OpenVerifyClient,
  made: ReviewerCase | undefined,
): Promise<void> {
  if (made === undefined) {
    return;
  }
  await admin.workflows.pause(made.workflowId).catch(() => undefined);
  await admin.workflows.archive(made.workflowId).catch(() => undefined);
}

/**
 * A JPEG of exactly `bytes`: the ID front's bytes, then zeros after its end-of-image marker, which a
 * decoder ignores. The API types it by its magic bytes (C135.2).
 */
export async function paddedJpeg(bytes: number): Promise<Buffer> {
  const jpeg = await readFile(FIXTURES.idFront);
  if (jpeg.length > bytes) {
    throw new Error('the fixture is larger than the size asked for');
  }
  return Buffer.concat([jpeg, Buffer.alloc(bytes - jpeg.length)]);
}
