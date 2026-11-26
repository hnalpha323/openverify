/** C70.4: report events, their payloads, stubs and meta. */
import { describe, expect, it } from 'vitest';
import { REPORT_EVENT_NAMES } from './event-names.js';
import {
  buildEventResource,
  eventAttributesSchema,
  redactedEventPayloadSchema,
  reportDismissedMetaSchema,
  reportReviewedMetaSchema,
} from './events.js';
import { readFixture } from './test-support.js';

const AT = new Date('2026-10-27T09:00:00.000Z');
const watchlist = () =>
  (readFixture('api/report-watchlist.json') as { data: Record<string, unknown> }).data;
const MATCH = 'rpm_01M5CJXHG07XPHF3HRM6NREDH8';
const REVIEWED = {
  'review-type': 'record',
  'review-status': 'true_positive',
  'risk-level': 'material',
  'record-token': MATCH,
  reviewer: 'usr_01M5CJXHG03PHEQZPRWAH2RXM5',
};

const attributes = (name: string, payload: Record<string, unknown>) => ({
  name,
  payload,
  'created-at': AT.toISOString(),
});

describe('report events (C70.4)', () => {
  it('carry the report of their own type', () => {
    expect(
      eventAttributesSchema.safeParse(attributes('report/watchlist.ready', { data: watchlist() }))
        .success,
    ).toBe(true);
    expect(
      eventAttributesSchema.safeParse(
        attributes('report/phone-number.ready', { data: watchlist() }),
      ).success,
    ).toBe(false);
    expect(REPORT_EVENT_NAMES).toContain('report/watchlist.matched');
  });

  it('name the dismissed match ids in .dismissed and the review in .reviewed, never the comment', () => {
    const dismissed = { data: watchlist(), meta: { 'match-ids': [MATCH] } };
    expect(
      eventAttributesSchema.safeParse(attributes('report/watchlist.dismissed', dismissed)).success,
    ).toBe(true);
    expect(
      eventAttributesSchema.safeParse(
        attributes('report/watchlist.dismissed', { data: watchlist() }),
      ).success,
    ).toBe(false);
    expect(reportDismissedMetaSchema.safeParse({ 'match-ids': [] }).success).toBe(false);
    expect(
      eventAttributesSchema.safeParse(
        attributes('report/watchlist.reviewed', { data: watchlist(), meta: REVIEWED }),
      ).success,
    ).toBe(true);
    expect(
      reportReviewedMetaSchema.safeParse({ ...REVIEWED, comment: 'A reviewer note' }).success,
    ).toBe(false);
    expect(
      reportReviewedMetaSchema.safeParse({
        ...REVIEWED,
        'review-type': 'all_records',
        'record-token': null,
        reviewer: 'key_01M5CJXHG0RVK7X4H9941FSM5K',
      }).success,
    ).toBe(true);
  });

  it('accept the stub of a redacted report, its id a rep_ id', () => {
    const stub = {
      data: {
        type: 'report/email-address',
        id: 'rep_01M5CJXHG07XPHF3HRM6NREDH8',
        attributes: { 'redacted-at': AT.toISOString() },
      },
    };
    expect(redactedEventPayloadSchema.safeParse(stub).success).toBe(true);
    expect(
      redactedEventPayloadSchema.safeParse({
        data: { ...stub.data, id: 'ver_01M5CJXHG07XPHF3HRM6NREDH8' },
      }).success,
    ).toBe(false);
    expect(
      eventAttributesSchema.safeParse(attributes('report/email-address.ready', stub)).success,
    ).toBe(true);
    expect(
      eventAttributesSchema.safeParse(
        attributes('report/watchlist.reviewed', {
          data: { ...stub.data, type: 'report/watchlist' },
        }),
      ).success,
    ).toBe(true);
  });

  it('build as events', () => {
    expect(() =>
      buildEventResource({
        id: 'evt_01M5CK4VW0MRQ4HKKTBDT6PXEM',
        name: 'report/watchlist.matched',
        payload: { data: watchlist() } as never,
        createdAt: AT,
      }),
    ).not.toThrow();
  });
});
