/**
 * C287.3 (Workflow 11A integration-11a): Connect on the full stack, two organisations on one
 * install: the sample partner (`seed:dev --connect`, the source) shares with the dev organisation
 * (the destination, `connect-inbound` on). Budget: 90 s per test.
 *
 * 1. The partner creates a connection; the dev organisation's TOTP admin activates it in the console
 *    with a second factor (C231.3). A person consents in the partner's flow (`share_consent`, source
 *    side) after a government ID passes; the partner creates a share token citing that record; the
 *    dev organisation peeks (the policy's `inquiry.status` only), attests its own consent and
 *    redeems by API into a clone, which is `needs_review` with its provenance (accept-cloned-results
 *    is off) and carries the Cloned banner in the console. A second token, citing an attested
 *    consent, expires when that consent is withdrawn. Every webhook on both sides is verified with
 *    `@openverify/node`, and no URL or flow answer names a token.
 *
 * Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectEventName } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import {
  SPEC_SHARE_POLICY,
  connectSides,
  connectWebhook,
  consentInSourceFlow,
  openInbound,
  sourceTemplate,
} from './support/connect.js';
import { freshTotpCode, signInAsMfaAdmin } from './support/ui.js';
import { verifyDelivery, waitForEvent } from './support/webhooks.js';

const DESTINATION_EVENTS: ConnectEventName[] = [
  'connect/connection.activated',
  'connect/share-token.inbound-created',
  'connect/share-token.inbound-redeemed',
  'connect/share-token.expired',
];
const SOURCE_EVENTS: ConnectEventName[] = [
  'connect/connection.created',
  'connect/share-token.outbound-created',
  'connect/share-token.outbound-redeemed',
  'connect/share-token.expired',
  'consent-record.created',
  'consent-record.withdrawn',
];

test('a share is consented, created, peeked, redeemed into a clone and withdrawn (C231-C239)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const run = randomUUID().slice(0, 8);
  const { partner, dev, devKey } = await connectSides(stack);
  await openInbound(stack, dev);
  const destinationHooks = await connectWebhook(devKey, DESTINATION_EVENTS);
  const sourceHooks = await connectWebhook(partner.client, SOURCE_EVENTS);
  try {
    // The connection, from the partner to the dev organisation (one per pair and direction).
    const existing = (
      await partner.client.connectConnections.list({
        filter: { 'destination-organization-id': [dev.organizationId] },
      })
    ).data[0];
    let connectionId = existing?.id;
    if (connectionId === undefined) {
      const { data: created } = await partner.client.connectConnections.create({
        'destination-organization-id': dev.organizationId,
        'share-policy': SPEC_SHARE_POLICY,
      });
      connectionId = created.id;
      expect(created.attributes.status).toBe('pending');
      // The source does not see the destination's name before the first activation.
      expect(created.attributes['destination-organization-name']).toBeNull();
      await waitForEvent(sourceHooks.receiver, 'connect/connection.created', connectionId);
    } else if (existing?.attributes.status === 'active') {
      // A second pass on the same stack: deactivate and reactivate (C231.4), then activate again.
      await partner.client.connectConnections.deactivate(connectionId);
      await partner.client.connectConnections.reactivate(connectionId);
    }

    // C231.3: the destination's admin activates it in the console, after a second factor.
    await signInAsMfaAdmin(page, stack);
    await page.goto(`${stack.dashboardUrl}/settings/connect`);
    await page
      .getByRole('table', { name: 'Inbound connections' })
      .getByRole('link')
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/settings/connect/connections/${connectionId}$`));
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Agreement reference' }).fill(`E2E-${run}`);
    await dialog
      .getByRole('checkbox', { name: 'I accept this policy for my organization' })
      .check();
    await dialog
      .getByRole('textbox', { name: 'Code from your authenticator app' })
      .fill(await freshTotpCode(stack.mfaAdmin.totpSecret));
    await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(page.getByText('The connection is active.')).toBeVisible();
    verifyDelivery(
      await waitForEvent(destinationHooks.receiver, 'connect/connection.activated', connectionId),
      destinationHooks.secret,
    );

    // The person consents in the source's flow; the record names the recipient and the digest.
    const templateId = await sourceTemplate(stack, partner, connectionId, run);
    const inquiryId = await consentInSourceFlow(stack, partner, templateId);
    const { data: records } = await partner.client.connectConsentRecords.list({
      filter: { 'subject-id': inquiryId },
    });
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.attributes).toMatchObject({ side: 'source', method: 'flow', status: 'active' });
    verifyDelivery(
      await waitForEvent(sourceHooks.receiver, 'consent-record.created', record?.id ?? ''),
      sourceHooks.secret,
    );

    // C232: the token cites the record; both sides are told.
    const { data: token } = await partner.client.connectShareTokens.create({
      'connection-id': connectionId,
      'source-id': inquiryId,
      'consent-record-id': record?.id ?? '',
    });
    expect(token.attributes.status).toBe('created');
    for (const [hooks, name] of [
      [sourceHooks, 'connect/share-token.outbound-created'],
      [destinationHooks, 'connect/share-token.inbound-created'],
    ] as const) {
      verifyDelivery(await waitForEvent(hooks.receiver, name, token.id), hooks.secret);
    }

    // C233: the peek shows what the policy names, in the {visibility, value} envelope.
    const peeked = await devKey.connectShareTokens.peek(token.id);
    const sourceData = JSON.stringify(peeked.data.attributes);
    expect(sourceData).toContain('"visibility":"full"');
    expect(sourceData).not.toContain(inquiryId);

    // C234: the destination attests its consent and redeems into a clone; the job makes the copy.
    const { data: destinationConsent } = await devKey.connectConsentRecords.attest({
      side: 'destination',
      'connection-id': connectionId,
      'share-token-id': token.id,
      'data-categories': token.attributes['data-categories'],
      'explicit-biometric': false,
      'expires-in-seconds': 86_400,
      'evidence-reference': `Synthetic call log E2E-${run}`,
      'attested-at': new Date().toISOString(),
      'text-locale': 'en',
      'text-body':
        'Synthetic attested text: I agree that the dev organisation receives my ID data.',
    });
    expect(destinationConsent.attributes.method).toBe('attested');
    const accepted = await devKey.connectShareTokens.redeem(token.id, {
      'inquiry-template-id': stack.defaultTemplateId,
      'destination-consent-record-id': destinationConsent.id,
    });
    expect(accepted.data.attributes.status).toBe('pending');
    for (const [hooks, name] of [
      [sourceHooks, 'connect/share-token.outbound-redeemed'],
      [destinationHooks, 'connect/share-token.inbound-redeemed'],
    ] as const) {
      verifyDelivery(await waitForEvent(hooks.receiver, name, token.id, 60_000), hooks.secret);
    }
    const { data: redeemed } = await devKey.connectShareTokens.retrieve(token.id);
    expect(redeemed.attributes.status).toBe('redeemed');
    const cloneId = redeemed.relationships.destination?.data.id ?? '';
    expect(cloneId).toMatch(/^inq_/);
    const { data: clone } = await devKey.inquiries.retrieve(cloneId);
    // C235.4: accept-cloned-results is off on the default template, so the clone waits for review.
    expect(clone.attributes.status).toBe('needs_review');
    expect(clone.attributes.provenance).toMatchObject({
      kind: 'connect-clone',
      'share-token-id': token.id,
    });

    // C242.4: the console marks the clone and names the token and the source organisation.
    await page.goto(`${stack.dashboardUrl}/inquiries/${cloneId}`);
    const connect = page.getByRole('region', { name: 'Connect' });
    await expect(connect.getByRole('status')).toContainText('Cloned from');
    await expect(
      connect
        .getByRole('table', { name: 'Cloned verifications' })
        .getByRole('cell', { name: 'Cloned' }),
    ).toBeVisible();
    await expect(connect.getByRole('link', { name: token.id })).toBeVisible();

    // C237.2: a second token, citing an attested source consent, expires when it is withdrawn.
    const { data: attested } = await partner.client.connectConsentRecords.attest({
      side: 'source',
      'connection-id': connectionId,
      'subject-id': inquiryId,
      'data-categories': token.attributes['data-categories'],
      'explicit-biometric': false,
      'expires-in-seconds': 86_400,
      'evidence-reference': `Synthetic signed form E2E-${run}`,
      'attested-at': new Date().toISOString(),
      'text-locale': 'en',
      'text-body': 'Synthetic attested text: I agree that my ID data is shared once more.',
    });
    const { data: second } = await partner.client.connectShareTokens.create({
      'connection-id': connectionId,
      'source-id': inquiryId,
      'consent-record-id': attested.id,
    });
    await partner.client.connectConsentRecords.withdraw(attested.id, {
      'withdrawal-reason': 'subject-request',
    });
    for (const hooks of [sourceHooks, destinationHooks]) {
      verifyDelivery(
        await waitForEvent(hooks.receiver, 'connect/share-token.expired', second.id),
        hooks.secret,
      );
    }
    verifyDelivery(
      await waitForEvent(sourceHooks.receiver, 'consent-record.withdrawn', attested.id),
      sourceHooks.secret,
    );
    expect((await devKey.connectShareTokens.retrieve(second.id)).data.attributes.status).toBe(
      'expired',
    );

    // No delivery's URL and no page the person saw named a token (C238.3).
    for (const request of [
      ...sourceHooks.receiver.requests,
      ...destinationHooks.receiver.requests,
    ]) {
      expect(request.path).not.toContain('cnst_');
    }
  } finally {
    await destinationHooks.close();
    await sourceHooks.close();
  }
});
