/**
 * C52.8, C53.7 acceptance for the `government-id-nfc` attributes at every exit: DG1's fields from
 * the sealed chip read, the class and issuing country, and the passive and active authentication
 * summaries from the checks and the read's PA summary; served unmasked to a key and to a user
 * with `pii:view`, masked (the DG1 fields `null`) without it, in `GET /verifications/:id`,
 * `?include=verifications`, the `verification.*` payload as the Events API serves it, a stored API
 * log body and the dashboard inquiry document; the DG1 fields `null` once the inquiry is
 * redacted, even with `pii:view`. Every value is synthetic.
 */
import { dashboardInquiryDocumentSchema, newId } from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  createEvent,
  createVerification,
  getVerification,
  listApiLogs,
  redactInquiryRecords,
  replaceVerificationChecks,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  seedChipRead,
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
  'name-first': 'AVERY',
  'name-last': 'EXAMPLE',
  birthdate: '1990-04-12',
  sex: 'X',
  'expiration-date': '2031-04-11',
  'identification-number': 'UT1234567',
  nationality: 'UTO',
  'issuing-country': 'UTO',
  'document-code': 'P',
  'id-class': 'passport',
};
const PII = {
  'name-first': 'AVERY',
  'name-last': 'EXAMPLE',
  birthdate: '1990-04-12',
  sex: 'X',
  'expiration-date': '2031-04-11',
  'identification-number': 'UT1234567',
  nationality: 'UTO',
};
const PII_NULLS = Object.fromEntries(Object.keys(PII).map((name) => [name, null]));

const SUMMARIES = {
  'passive-authentication': {
    outcome: 'passed',
    integrity: 'established',
    'anchor-source': 'openverify-sandbox',
    'hash-algorithm': 'sha256',
    revocation: 'unrevoked',
  },
  'active-authentication': { outcome: 'passed' },
};
const SERVED = { ...PII, 'id-class': 'passport', 'issuing-country': 'UT', ...SUMMARIES };
const MASKED = { ...PII_NULLS, 'id-class': 'passport', 'issuing-country': 'UT', ...SUMMARIES };
const REDACTED = { ...PII_NULLS, 'id-class': null, 'issuing-country': null, ...SUMMARIES };

/** The checks the job writes, as their metadata names the summaries' values. */
const CHECKS = [
  {
    name: 'id_nfc_passive_authentication_detection',
    status: 'passed' as const,
    type: 'fraud' as const,
    requirement: 'required' as const,
    reasons: [],
    metadata: { integrity: 'established', revocation: 'unrevoked', 'hash-algorithm': 'sha256' },
  },
  {
    name: 'id_nfc_chip_authentication_detection',
    status: 'passed' as const,
    type: 'fraud' as const,
    requirement: 'required' as const,
    reasons: [],
    metadata: { outcome: 'verified', scheme: 'ecdsa-plain' },
  },
];

/** A chip read of the synthetic holder, its integrity established, its summary naming the source. */
async function seedRead(db: Db, environmentId: string, inquiryId: string, verificationId: string) {
  await seedChipRead(db, environmentId, {
    verificationId,
    inquiryId,
    fields: FIELDS,
    integrity: 'established',
    selfieBound: true,
    issuingCountry: 'UTO',
    paSummary: {
      integrity: 'established',
      revocation: 'unrevoked',
      hashAlgorithm: 'sha256',
      anchorSource: 'openverify-sandbox',
    },
  });
}

function expectNoValue(text: string): void {
  for (const value of Object.values(PII)) {
    expect(text).not.toContain(JSON.stringify(value));
  }
}

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

describe('the server API exits (C52.8, C53.7)', () => {
  let api: TestApi;
  let viewer: string;
  let reviewer: string;
  let inquiryId: string;
  let verificationId: string;

  async function chipVerification(): Promise<{ inquiryId: string; verificationId: string }> {
    const inquiry = await createInquiry(api);
    const { id } = await seedVerification(api, api.environmentId, inquiry, {
      type: 'government_id_nfc',
      status: 'passed',
      checks: CHECKS,
    });
    await seedRead(api.database.db, api.environmentId, inquiry, id);
    return { inquiryId: inquiry, verificationId: id };
  }

  beforeAll(async () => {
    api = await createTestApi();
    viewer = api.newUserToken(api.environmentId, {
      permissions: PERMISSIONS.filter((permission: Permission) => permission !== 'pii:view'),
    });
    reviewer = api.newUserToken(api.environmentId);
    ({ inquiryId, verificationId } = await chipVerification());
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

  it('serves nulls before the job wrote a read or checks', async () => {
    const inquiry = await createInquiry(api);
    const { id } = await seedVerification(api, api.environmentId, inquiry, {
      type: 'government_id_nfc',
    });

    const response = await api.app.inject({
      url: `/api/v1/verifications/${id}`,
      headers: bearer(reviewer),
    });

    expect(typeAttributes(expectStatus(response, 200).data)).toEqual({
      ...PII_NULLS,
      'id-class': null,
      'issuing-country': null,
      'passive-authentication': null,
      'active-authentication': null,
    });
  });

  it('GET /inquiries/:id?include=verifications: the same', async () => {
    const url = `/api/v1/inquiries/${inquiryId}?include=verifications`;
    const included = (document: { included?: unknown[] }) =>
      document.included?.find((resource) => (resource as { id: string }).id === verificationId);

    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const hidden = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(included(seen))).toEqual(SERVED);
    expect(typeAttributes(included(hidden))).toEqual(MASKED);
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
    const hidden = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(eventData(seen))).toEqual(SERVED);
    expect(typeAttributes(eventData(hidden))).toEqual(MASKED);
  });

  it('a stored API log body keeps them for pii:view and masks them without it', async () => {
    const requestId = `req-nfc-${newId('evt')}`;
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

  it('is null once the inquiry is redacted, even with pii:view (the summaries stay)', async () => {
    const redacted = await chipVerification();
    await redactInquiryRecords(api.database.db, api.environmentId, redacted.inquiryId);

    const response = await api.app.inject({
      url: `/api/v1/verifications/${redacted.verificationId}`,
      headers: bearer(reviewer),
    });

    expect(typeAttributes(expectStatus(response, 200).data)).toEqual(REDACTED);
    expectNoValue(response.body);
  });
});

describe('the dashboard inquiry document (C52.8, C53.7)', () => {
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
        type: 'government_id_nfc',
      })
    ).id;
    await replaceVerificationChecks(database.db, organization.sandboxId, verificationId, CHECKS);
    await seedRead(database.db, organization.sandboxId, inquiryId, verificationId);
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

  it('shows them to a reviewer with pii:view and masks the DG1 fields for a viewer', async () => {
    expect(typeAttributes(await included(reviewer))).toEqual(SERVED);
    const hidden = await included(viewer);
    expect(typeAttributes(hidden)).toEqual(MASKED);
    expectNoValue(JSON.stringify(hidden));
  });
});
