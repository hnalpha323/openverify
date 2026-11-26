/**
 * C104, C105 (Workflow 7B): transactions, full stack. Budget: 90 s.
 *
 * A transaction type is published with a searchable string, a number and a `never`-redacted
 * acknowledged string (C104.1, C104.2: a new type's version 1 is a draft, so a second draft carries
 * the content and is published). A transaction is created, its status updated, labelled and
 * redacted (C105.2, C105.5); each step's event is delivered signed, and none carries a field value
 * (rule 11). After the redaction every field is gone but the `never` one, and the status stays.
 * Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { recordingClient } from './support/platform.js';
import { createServerApi } from './support/server-api.js';
import { eventNamesFor, verifyDelivery, waitForEvent } from './support/webhooks.js';

const FIELD_SCHEMAS = [
  { type: 'string', key: 'order_id', label: 'Order', config: { searchable: true } },
  {
    type: 'string',
    key: 'ledger',
    label: 'Ledger',
    config: { 'redaction-policy': 'never', 'never-redact-acknowledged': true },
  },
  { type: 'string', key: 'note', label: 'Note' },
  { type: 'number', key: 'amount', label: 'Amount' },
] as const;

test('a published transaction type, a transaction created, its status updated, labelled and redacted, each event signed and free of field values (C104, C105)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const webhook = await api.createWebhook(receiver.url, ['*']);
  try {
    const run = randomUUID().slice(0, 8);
    const orderId = `synthetic-order-${run}`;
    const note = `synthetic-note-${run}`;
    const ledger = `synthetic-ledger-${run}`;

    // C104.1: the type, then a draft with its content, published.
    const { data: type } = await client.transactionTypes.create({ name: `e2e-payout-${run}` });
    const { data: draft } = await client.transactionTypes.versions.create({
      'transaction-type-id': type.id,
      'field-schemas': [...FIELD_SCHEMAS],
      statuses: ['created', 'approved', 'declined'],
    });
    const { data: published } = await client.transactionTypes.versions.publish(draft.id);
    expect(published.attributes.status).toBe('published');

    // C105.2: create.
    const { data: created } = await client.transactions.create({
      'transaction-type-id': type.id,
      'reference-id': `e2e-transactions-${run}`,
      fields: { order_id: orderId, ledger, note, amount: 12.5 },
    });
    expect(created.attributes.status).toBe('created');
    expect(created.attributes.fields).toMatchObject({
      order_id: { type: 'string', value: orderId },
      amount: { type: 'number', value: 12.5 },
    });
    // The searchable field finds it by its exact value.
    const { data: found } = await client.transactions.list({
      filter: { 'identifier][key': 'order_id', 'identifier][value': orderId },
    });
    expect(found.map((transaction) => transaction.id)).toEqual([created.id]);

    // The status, then the label.
    const { data: approved } = await client.transactions.update(created.id, {
      status: 'approved',
    });
    expect(approved.attributes.status).toBe('approved');
    await client.transactions.label(created.id, {
      label: 'synthetic-legitimate',
      score: 0.12,
      'model-version': 'synthetic-model-1',
    });

    // C105.5: the redaction keeps the `never` field and the status, and nulls the rest.
    const { data: redacted } = await client.transactions.redact(created.id);
    expect(redacted.attributes['redacted-at']).not.toBeNull();
    expect(redacted.attributes.status).toBe('approved');
    expect(redacted.attributes.fields).toMatchObject({
      ledger: { type: 'string', value: ledger },
    });
    expect(JSON.stringify(redacted.attributes.fields)).not.toContain(note);
    expect(JSON.stringify(redacted.attributes.fields)).not.toContain(orderId);

    // C105.3: every step's event, signed; no field value in any of them (rule 11).
    for (const name of [
      'transaction.created',
      'transaction.status-updated',
      'transaction.labeled',
      'transaction.redacted',
    ]) {
      const delivery = await waitForEvent(receiver, name, created.id, 30_000);
      expect(verifyDelivery(delivery, webhook.attributes.secret), name).toBeGreaterThan(0);
      expect(delivery.request.body, name).not.toContain(note);
      expect(delivery.request.body, name).not.toContain(orderId);
      expect(delivery.request.body, name).not.toContain(ledger);
    }
    expect(eventNamesFor(receiver, created.id)).toEqual(
      expect.arrayContaining(['transaction.created', 'transaction.redacted']),
    );
    const status = await waitForEvent(receiver, 'transaction.status-updated', created.id);
    expect((status.event.attributes.payload as { meta?: unknown }).meta).toEqual({
      from: 'created',
      to: 'approved',
    });
  } finally {
    await api.disableWebhook(webhook.id);
    await receiver.close();
  }
});
