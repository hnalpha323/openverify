import { readFileSync } from 'node:fs';
import {
  EVENT_NAMES,
  buildEventResource,
  eventDocumentSchema,
  eventPayloadSchema,
  newId,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { createFixtureSampleSource, WEBHOOK_SAMPLE_FIXTURES } from './samples.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const source = createFixtureSampleSource();

function fixturePayload(name: string) {
  const text = readFileSync(new URL(name, WEBHOOK_SAMPLE_FIXTURES), 'utf8');
  return eventDocumentSchema.parse(JSON.parse(text)).data.attributes.payload;
}

describe('createFixtureSampleSource (C14 simulate)', () => {
  it.each(EVENT_NAMES)('builds a valid sample payload for %s', async (name) => {
    const payload = await source.payloadFor(name);

    expect(eventPayloadSchema.parse(payload)).toEqual(payload);
    expect(() =>
      buildEventResource({ id: newId('evt'), name, payload, createdAt: NOW, simulated: true }),
    ).not.toThrow();
  });

  it('uses the golden event fixtures where one exists for the name', async () => {
    expect(await source.payloadFor('inquiry.approved')).toEqual(
      fixturePayload('event-inquiry-approved.json'),
    );
    expect(await source.payloadFor('inquiry.completed')).toEqual(
      fixturePayload('webhook-event-inquiry-completed.json'),
    );
    expect(await source.payloadFor('account.consolidated')).toEqual(
      fixturePayload('event-account-consolidated.json'),
    );
  });

  it('names the pinned template version in every inquiry sample, as inquiry events do (C25.4, C38)', async () => {
    const inquiryEvents = EVENT_NAMES.filter((name) => name.startsWith('inquiry.'));
    for (const name of inquiryEvents) {
      const payload = await source.payloadFor(name);
      expect(
        (payload.data as { relationships?: Record<string, unknown> }).relationships?.[
          'inquiry-template-version'
        ],
        name,
      ).toEqual({
        data: { type: 'inquiry-template-version', id: 'itmplv_01M5A0GTG0VF5QW51511984D0G' },
      });
    }
  });

  it('gives the resource the status the event announces', async () => {
    const status = async (name: (typeof EVENT_NAMES)[number]) =>
      ((await source.payloadFor(name)).data.attributes as { status?: string }).status;

    expect(await status('inquiry.declined')).toBe('declined');
    expect(await status('inquiry.marked-for-review')).toBe('needs_review');
    expect(await status('inquiry.expired')).toBe('expired');
    expect(await status('verification.failed')).toBe('failed');
    expect(await status('verification.canceled')).toBe('canceled');
    expect(await status('inquiry-session.expired')).toBe('expired');
    expect(await status('inquiry-session.canceled')).toBe('canceled');
    expect(await status('account.archived')).toBe('archived');
    expect(await status('account.restored')).toBe('active');
  });

  it('carries { from, to } on inquiry.transitioned and redacted-at on redaction events', async () => {
    const transitioned = await source.payloadFor('inquiry.transitioned');
    const redacted = await source.payloadFor('inquiry.redacted');

    expect(transitioned.meta).toEqual({ from: 'pending', to: 'completed' });
    expect(transitioned.data.attributes).toMatchObject({ status: 'completed' });
    expect(redacted.data.attributes).toMatchObject({
      'redacted-at': expect.any(String) as unknown,
    });
  });

  it('returns a fresh copy, so callers cannot change later samples', async () => {
    const first = await source.payloadFor('inquiry.created');
    (first.data.attributes as Record<string, unknown>).status = 'declined';

    expect((await source.payloadFor('inquiry.created')).data.attributes).toMatchObject({
      status: 'created',
    });
  });

  it('rejects when the fixtures cannot be read', async () => {
    const missing = createFixtureSampleSource(new URL('file:///nonexistent-openverify-fixtures/'));

    await expect(missing.payloadFor('inquiry.created')).rejects.toThrow();
  });
});

describe('report samples (C70.4, F09)', () => {
  const attributesOf = async (name: string) =>
    (await source.payloadFor(name as (typeof EVENT_NAMES)[number])).data.attributes as Record<
      string,
      unknown
    >;

  it('take the golden report of the event type, with the status the event announces', async () => {
    const payload = await source.payloadFor('report/phone-number.ready');
    expect(payload.data).toMatchObject({ type: 'report/phone-number' });
    expect(await attributesOf('report/watchlist.errored')).toMatchObject({
      status: 'errored',
      errors: [{ code: 'execution_error' }],
    });
    expect(await attributesOf('report/watchlist.matched')).toMatchObject({
      status: 'ready',
      'has-match': true,
    });
  });

  it('null the report PII on .redacted instead of setting fields', async () => {
    const redacted = await attributesOf('report/watchlist.redacted');
    expect(redacted).toMatchObject({
      'redacted-at': expect.any(String) as unknown,
      query: null,
      'matched-lists': null,
      matches: null,
      'ignore-list': null,
      'next-run-at': null,
      'is-recurring': false,
    });
    expect(redacted).not.toHaveProperty('fields');
    expect(await attributesOf('report/email-address.redacted')).toMatchObject({
      'email-domain': null,
      'email-domain-typo-suggestion': null,
      'email-domain-kind': 'custom',
    });
  });

  it('carry the dismissed match ids and the review in meta', async () => {
    const dismissed = await source.payloadFor('report/watchlist.dismissed');
    expect(dismissed.meta).toEqual({
      'match-ids': [expect.stringMatching(/^rpm_/) as unknown],
    });
    const reviewed = await source.payloadFor('report/politically-exposed-person.reviewed');
    expect(reviewed.meta).toMatchObject({
      'review-type': 'record',
      'review-status': 'true_positive',
      reviewer: expect.stringMatching(/^key_/) as unknown,
    });
  });
});
