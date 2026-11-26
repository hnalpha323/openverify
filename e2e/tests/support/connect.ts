/**
 * C287.3 (Workflow 11A integration-11a): the helpers of the Connect spec. Two organisations on one
 * install: the dev organisation (the stack's API key and its TOTP-enrolled admin) and the sample
 * partner `seed:dev --connect` made, whose admin signs in with the dev admin's password. Every value
 * is synthetic.
 */
import { createHash, randomUUID } from 'node:crypto';
import { defaultInquiryTemplateAttributes, type SharePolicy } from '@openverify/contracts';
import { expect } from '@playwright/test';
import type { ConnectEventName, OpenVerifyClient } from '@openverify/node';
import type { StackInfo } from '../../src/stack-info.js';
import { startWebhookReceiver, type WebhookReceiver } from '../../src/webhook-receiver.js';
import { FIXTURES } from '../../src/paths.js';
import { consentStep, publishV2, startV2Inquiry, v2Flow } from './flow-v2.js';
import {
  dashboardRequest,
  flowApi,
  recordingClient,
  settledFlowVerification,
  signInToApi,
  submitGovernmentId,
} from './platform.js';

/** The share policy of the spec's connections: a government ID's data and checks, no biometric. */
export const SPEC_SHARE_POLICY: SharePolicy = {
  purpose: 'share.reuse-kyc',
  'source-types': ['inquiry'],
  verifications: {
    types: ['government-id'],
    'extracted-data': true,
    'check-results': true,
    files: false,
  },
  fields: { inquiry: [], account: [], transaction: [] },
  biometric: false,
  peek: { 'inquiry.status': 'full' },
  'attested-consent': 'non-biometric',
};

/** One side of a share: its server-API client (a user session) and its environment. */
export interface ConnectSide {
  token: string;
  client: OpenVerifyClient;
  environmentId: string;
  organizationId: string;
}

/** The partner (source) and the dev organisation (destination), each signed in once. */
export async function connectSides(
  stack: StackInfo,
): Promise<{ partner: ConnectSide; dev: ConnectSide; devKey: OpenVerifyClient }> {
  const partnerToken = await signInToApi(stack, stack.connect.partnerAdmin);
  const devToken = await signInToApi(stack, stack.operators.admin);
  const partner = recordingClient(stack.apiUrl, partnerToken).client;
  // The seeded connection runs from the dev organisation to the partner: its source is the dev one.
  const { data: seeded } = await partner.connectConnections.retrieve(
    stack.connect.seededConnectionId,
  );
  return {
    partner: {
      token: partnerToken,
      client: partner,
      environmentId: stack.connect.partnerEnvironments.sandbox,
      organizationId: stack.connect.partnerOrganizationId,
    },
    dev: {
      token: devToken,
      client: recordingClient(stack.apiUrl, devToken).client,
      environmentId: stack.environments.sandbox,
      organizationId: seeded.attributes['source-organization-id'],
    },
    devKey: recordingClient(stack.apiUrl, stack.apiKey).client,
  };
}

/** C231.10: the dev organisation accepts inbound connections (the console's Connect setting). */
export async function openInbound(stack: StackInfo, dev: ConnectSide): Promise<void> {
  const answer = await dashboardRequest(stack, 'PATCH', '/settings', {
    token: dev.token,
    body: { 'connect-inbound': true },
  });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
}

/** A webhook of `client` for `events`, with its receiver and the secret it returned once. */
export async function connectWebhook(
  client: OpenVerifyClient,
  events: readonly ConnectEventName[],
): Promise<{ receiver: WebhookReceiver; secret: string; close: () => Promise<void> }> {
  const receiver = await startWebhookReceiver();
  const { data: webhook } = await client.webhooks.create({
    url: receiver.url,
    'enabled-events': [...events],
  });
  return {
    receiver,
    secret: webhook.attributes.secret,
    close: async () => {
      await client.webhooks.archive(webhook.id).catch(() => undefined);
      await receiver.close();
    },
  };
}

/**
 * The source's template: consent, a government ID, the source-side `share_consent` naming the
 * connection, then the completion (C238.1).
 */
export async function sourceTemplate(
  stack: StackInfo,
  partner: ConnectSide,
  connectionId: string,
  run: string,
): Promise<string> {
  const defaults = defaultInquiryTemplateAttributes();
  const governmentId = defaults.flow.steps.find((step) => step.type === 'government_id');
  const edge = (id: string, from: string, to: string) => ({ id, from, port: 'next', to });
  const published = await publishV2(
    { ...stack, apiKey: partner.token },
    partner.client,
    `e2e connect source ${run}`,
    {
      metadata: { specVersion: 2, id: `e2e-connect-${run}`, version: 1, name: 'Share out' },
      entry: 'consent',
      steps: [
        consentStep(),
        { ...governmentId, id: 'id_card', maxAttempts: 1, captureMethods: ['upload'] },
        {
          id: 'share_out',
          type: 'share_consent',
          side: 'source',
          connectionId,
          withdrawalContact: 'Write to privacy@example.com',
        },
        { id: 'done', type: 'completion' },
      ],
      edges: [
        edge('e1', 'consent', 'id_card'),
        edge('e2', 'id_card', 'share_out'),
        edge('e3', 'share_out', 'done'),
      ],
    },
    {
      'verification-config': { 'government-id': defaults['verification-config']['government-id'] },
    },
  );
  return published.templateId;
}

/**
 * The person's side at the source: consent, a government ID that passes, then the share consent
 * accepted on the text the server composed (its digest sent back, C238.3). Returns the inquiry id.
 */
export async function consentInSourceFlow(
  stack: StackInfo,
  partner: ConnectSide,
  templateId: string,
): Promise<string> {
  const started = await startV2Inquiry(
    { ...stack, apiKey: partner.token },
    templateId,
    `e2e-connect-${randomUUID()}`,
  );
  const flow = v2Flow(stack, started.sessionToken);
  await flow.consent();
  const idApi = flowApi(stack.apiUrl, started.sessionToken);
  const verificationId = await submitGovernmentId(idApi, {
    front: FIXTURES.idFront,
    back: FIXTURES.idBack,
  });
  expect((await settledFlowVerification(idApi, verificationId, 60_000)).attributes.status).toBe(
    'passed',
  );
  let view: { type?: string; text?: { body: string; sha256: string } } | undefined;
  await expect
    .poll(
      async () => {
        const session = await flow.session();
        view = session.step;
        return session.position?.['step-id'];
      },
      { timeout: 30_000, intervals: [500, 1_000] },
    )
    .toBe('share_out');
  expect(view?.type).toBe('share_consent');
  const text = view?.text;
  expect(text).toBeDefined();
  // The digest a client sends is of the text it showed: here the served body itself.
  const shown = createHash('sha256')
    .update((text?.body ?? '').normalize('NFC'))
    .digest('hex');
  expect(shown).toBe(text?.sha256);
  const accepted = await fetch(`${stack.apiUrl}/api/v1/flow/share-consents/share_out/accept`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${started.sessionToken}`,
      'content-type': 'application/json',
      'openverify-flow-spec': '2',
    },
    body: JSON.stringify({ 'text-sha256': shown, 'explicit-biometric': false }),
  });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  // The URL and the body name no token or connection (C238.3, C238.5).
  expect(await accepted.text()).not.toContain('cnst_');
  return started.inquiryId;
}
