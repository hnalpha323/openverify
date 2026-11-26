/**
 * C52.8, C53.7 acceptance with the real `document` attribute hook, at every exit: served unmasked
 * to a key and to a user with `pii:view`, masked member-wise for a user without it, in
 * `GET /verifications/:id`, `?include=verifications`, the `verification.*` payload as the Events
 * API serves it, a stored API log body and the dashboard inquiry document; and `fields: null` once
 * the inquiry is redacted, even with `pii:view` (the class, pages and media type stay). Every
 * value is synthetic.
 */
import { dashboardInquiryDocumentSchema, newId } from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  createEvent,
  createVerification,
  getVerification,
  listApiLogs,
  redactInquiryRecords,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  seedDocumentExtraction,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from '../../routes/dashboard/dashboard.test-support.js';
import {
  bearer,
  createInquiry,
  createTestApi,
  expectStatus,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';
import { stageVerificationEvent } from '../verifications.js';

const FIELDS = {
  name: 'QUINN VALEMONT',
  'address-street-1': '14 LANTERN ROW',
  'address-city': 'MERIDALE',
  'address-subdivision': 'UT',
  'address-postal-code': '00000',
  'address-country-code': 'US',
  'issue-date': '2026-09-30',
  issuer: 'UTOPIA WATER BOARD',
};
const NO_FIELDS = {
  name: null,
  'address-street-1': null,
  'address-street-2': null,
  'address-city': null,
  'address-subdivision': null,
  'address-postal-code': null,
  'address-country-code': null,
  'issue-date': null,
  issuer: null,
  'expiration-date': null,
};
const PLAIN = {
  'document-type': 'utility_bill',
  'document-type-confidence': 0.91,
  'page-count': 2,
  'mime-type': 'application/pdf',
};
const SERVED = { ...PLAIN, fields: { ...NO_FIELDS, ...FIELDS } };
const MASKED = { ...PLAIN, fields: NO_FIELDS };
const REDACTED = { ...PLAIN, fields: null };

/** Fails when any extracted value appears in `text` as a JSON string of its own. */
function expectNoValue(text: string): void {
  for (const value of Object.values(FIELDS)) {
    expect(text).not.toContain(JSON.stringify(value));
  }
}

/** The type attributes of a served verification resource. */
function typeAttributes(resource: unknown): Record<string, unknown> {
  const attributes = (resource as { attributes?: Record<string, unknown> } | undefined)?.attributes;
  return Object.fromEntries(
    Object.entries(attributes ?? {}).filter(
      ([name]) =>
        ![
          'status',
          'checks',
          'from-rejected-handoff',
          'created-at',
          'updated-at',
          'redacted-at',
        ].includes(name),
    ),
  );
}

const extractionOf = (verificationId: string, inquiryId: string) => ({
  verificationId,
  inquiryId,
  documentType: 'utility_bill' as const,
  typeConfidence: 0.91,
  pageCount: 2,
  mimeType: 'application/pdf' as const,
  fields: FIELDS,
});

describe('the server API exits of a document verification (C52.8, C53.7)', () => {
  let api: TestApi;
  let viewer: string;
  let reviewer: string;
  let inquiryId: string;
  let verificationId: string;

  beforeAll(async () => {
    api = await createTestApi();
    viewer = api.newUserToken(api.environmentId, {
      permissions: PERMISSIONS.filter((permission: Permission) => permission !== 'pii:view'),
    });
    reviewer = api.newUserToken(api.environmentId);
    inquiryId = await createInquiry(api);
    verificationId = (
      await seedVerification(api, api.environmentId, inquiryId, {
        type: 'document',
        files: ['document'],
      })
    ).id;
    await seedDocumentExtraction(
      api.database.db,
      api.environmentId,
      extractionOf(verificationId, inquiryId),
    );
  });

  afterAll(async () => {
    await api.close();
  });

  it('GET /verifications/:id: unmasked for a key and with pii:view, masked without it', async () => {
    const url = `/api/v1/verifications/${verificationId}`;

    const key = expectStatus(await api.app.inject({ url, headers: bearer(api.token) }), 200);
    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const hidden = await api.app.inject({ url, headers: bearer(viewer) });

    expect(typeAttributes(key.data)).toEqual(SERVED);
    expect(typeAttributes(seen.data)).toEqual(SERVED);
    expect(typeAttributes(expectStatus(hidden, 200).data)).toEqual(MASKED);
    expectNoValue(hidden.body);
  });

  it('GET /inquiries/:id?include=verifications: the same', async () => {
    const url = `/api/v1/inquiries/${inquiryId}?include=verifications`;
    const included = (document: { included?: unknown[] }) =>
      document.included?.find((resource) => (resource as { id: string }).id === verificationId);

    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const hidden = await api.app.inject({ url, headers: bearer(viewer) });

    expect(typeAttributes(included(seen))).toEqual(SERVED);
    expect(typeAttributes(included(expectStatus(hidden, 200)))).toEqual(MASKED);
    expectNoValue(hidden.body);
  });

  it('the verification.* payload carries them, and the Events API masks them', async () => {
    const row = await getVerification(api.database.db, api.environmentId, verificationId);
    if (row === null) {
      throw new Error('seeded verification missing');
    }
    const staged = await stageVerificationEvent(
      api.database.db,
      api.events,
      'verification.passed',
      row,
      [],
    );
    await api.events.dispatch([staged]);
    const payload = api.events.events.find((event) => event.id === staged.eventId)?.payload;
    expect(typeAttributes(payload?.data)).toEqual(SERVED);
    const event = await createEvent(api.database.db, api.environmentId, {
      id: newId('evt'),
      name: 'verification.passed',
      payload: payload as never,
    });
    const url = `/api/v1/events/${event.id}`;
    const eventData = (document: { data: unknown }) =>
      (document.data as { attributes: { payload: { data: unknown } } }).attributes.payload.data;

    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const hidden = await api.app.inject({ url, headers: bearer(viewer) });

    expect(typeAttributes(eventData(seen))).toEqual(SERVED);
    expect(typeAttributes(eventData(expectStatus(hidden, 200)))).toEqual(MASKED);
    expectNoValue(hidden.body);
  });

  it('a stored API log body keeps them for pii:view and masks them without it', async () => {
    const requestId = `req-document-${newId('evt')}`;
    await api.app.inject({
      url: `/api/v1/verifications/${verificationId}`,
      headers: { ...bearer(api.token), 'x-request-id': requestId },
    });
    const logs = await listApiLogs(api.database.db, api.environmentId, { size: 100 });
    const log = logs.items.find((entry) => entry.requestId === requestId);
    if (log === undefined) {
      throw new Error('the request left no API log');
    }
    const url = `/api/v1/api-logs/${log.id}`;
    const body = (document: { data: unknown }) =>
      (document.data as { attributes: { 'response-body': { data: unknown } } }).attributes[
        'response-body'
      ].data;

    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const hidden = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(body(seen))).toEqual(SERVED);
    expect(typeAttributes(body(hidden))).toEqual(MASKED);
    expectNoValue(JSON.stringify(body(hidden)));
  });

  it('serves fields as null once the inquiry is redacted, even with pii:view', async () => {
    const redactedInquiry = await createInquiry(api);
    const { id } = await seedVerification(api, api.environmentId, redactedInquiry, {
      type: 'document',
      files: ['document'],
    });
    await seedDocumentExtraction(
      api.database.db,
      api.environmentId,
      extractionOf(id, redactedInquiry),
    );
    await redactInquiryRecords(api.database.db, api.environmentId, redactedInquiry);

    const response = await api.app.inject({
      url: `/api/v1/verifications/${id}`,
      headers: bearer(reviewer),
    });

    expect(typeAttributes(expectStatus(response, 200).data)).toEqual(REDACTED);
    expectNoValue(response.body);
  });
});

describe('the dashboard inquiry document of a document verification (C52.8, C53.7)', () => {
  let database: TestDatabase;
  let dashboard: DashboardHarness;
  let reviewer: string;
  let viewer: string;
  let inquiryId: string;
  let verificationId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    dashboard = await createDashboardHarness(database);
    const organization = await dashboard.organization();
    reviewer = await dashboard.signIn(
      (await dashboard.operator(organization, { roles: ['reviewer'] })).email,
    );
    viewer = await dashboard.signIn(
      (await dashboard.operator(organization, { roles: ['viewer'] })).email,
    );
    const { inquiry } = await createTestInquiry(database.db, organization.sandboxId);
    inquiryId = inquiry.id;
    verificationId = (
      await createVerification(database.db, organization.sandboxId, {
        id: newId('ver'),
        inquiryId,
        type: 'document',
      })
    ).id;
    await seedDocumentExtraction(
      database.db,
      organization.sandboxId,
      extractionOf(verificationId, inquiryId),
    );
  }, 60_000);

  afterAll(async () => {
    await dashboard.close();
    await database.close();
  });

  async function included(token: string) {
    const document = dashboardInquiryDocumentSchema.parse(
      expectJson(await dashboard.call('GET', `/inquiries/${inquiryId}`, { token }), 200),
    );
    return document.included.find((resource) => resource.id === verificationId);
  }

  it('is shown to a reviewer with pii:view and masked member-wise for a viewer', async () => {
    expect(typeAttributes(await included(reviewer))).toEqual(SERVED);
    const hidden = await included(viewer);
    expect(typeAttributes(hidden)).toEqual(MASKED);
    expectNoValue(JSON.stringify(hidden));
  });
});
