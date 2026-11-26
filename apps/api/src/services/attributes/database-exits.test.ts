/**
 * C52.8, C53.7 acceptance with the real database and AAMVA attribute hooks, at every exit: served
 * unmasked to a key and to a user with `pii:view`, masked for a user without it, in
 * `GET /verifications/:id`, `?include=verifications`, the `verification.*` payload as the Events
 * API serves it, a stored API log body and the dashboard inquiry document; and `null` once the
 * inquiry is redacted, even with `pii:view` (the AAMVA source stays). Every value is synthetic.
 */
import {
  AAMVA_VERIFICATION_ATTRIBUTES,
  DATABASE_VERIFICATION_ATTRIBUTES,
  dashboardInquiryDocumentSchema,
  newId,
} from '@openverify/contracts';
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
  seedVerificationInputs,
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

const DATABASE_VALUES = {
  'name-first': 'Synthia',
  'name-last': 'Testerton',
  birthdate: '1990-05-17',
  'address-street-1': '123 Main Street',
  'address-country-code': 'US',
};
const AAMVA_VALUES = {
  'name-first': 'Avery',
  'name-last': 'Example',
  birthdate: '1990-04-12',
  'identification-number': 'D1234567',
  'issuing-authority': 'CA',
};

/** A fixed, synthetic verification id whose letters hold `CA` (see the dashboard case). */
const ID_HOLDING_A_VALUE = 'ver_01M5MYNQF59Z6NRCAFSWWNYM7Z';

const nullsOf = (names: readonly string[]) => Object.fromEntries(names.map((name) => [name, null]));
const DATABASE_NULLS = nullsOf(Object.keys(DATABASE_VERIFICATION_ATTRIBUTES));
const AAMVA_NULLS = nullsOf(
  Object.keys(AAMVA_VERIFICATION_ATTRIBUTES).filter((name) => name !== 'source'),
);

/** Each type: its stored values, what is served, and what a masked principal sees. */
const CASES = [
  {
    type: 'database' as const,
    values: DATABASE_VALUES,
    served: { ...DATABASE_NULLS, ...DATABASE_VALUES },
    masked: DATABASE_NULLS,
  },
  {
    type: 'aamva' as const,
    values: AAMVA_VALUES,
    served: { source: 'form', ...AAMVA_NULLS, ...AAMVA_VALUES },
    masked: { source: 'form', ...AAMVA_NULLS },
  },
];

/**
 * Fails when any entered value appears in `text` as a JSON string of its own. A value is searched
 * for with its quotes, so a two-letter value such as `CA` is never mistaken for the letters of an
 * id or a timestamp (a masked member is `null`, so a leak is the value as a JSON string).
 */
function expectNoValue(text: string, values: Readonly<Record<string, string>>): void {
  for (const value of Object.values(values)) {
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

describe('the server API exits (C52.8, C53.7)', () => {
  let api: TestApi;
  let viewer: string;
  let reviewer: string;

  beforeAll(async () => {
    api = await createTestApi();
    viewer = api.newUserToken(api.environmentId, {
      permissions: PERMISSIONS.filter((permission: Permission) => permission !== 'pii:view'),
    });
    reviewer = api.newUserToken(api.environmentId);
  });

  afterAll(async () => {
    await api.close();
  });

  describe.each(CASES)('$type attributes', ({ type, values, served, masked }) => {
    let inquiryId: string;
    let verificationId: string;

    beforeAll(async () => {
      inquiryId = await createInquiry(api);
      verificationId = (await seedVerification(api, api.environmentId, inquiryId, { type })).id;
      await seedVerificationInputs(api.database.db, api.environmentId, {
        verificationId,
        inquiryId,
        values,
      });
    });

    it('GET /verifications/:id: unmasked for a key and with pii:view, masked without it', async () => {
      const url = `/api/v1/verifications/${verificationId}`;

      const key = expectStatus(await api.app.inject({ url, headers: bearer(api.token) }), 200);
      const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
      const hidden = await api.app.inject({ url, headers: bearer(viewer) });

      expect(typeAttributes(key.data)).toEqual(served);
      expect(typeAttributes(seen.data)).toEqual(served);
      expect(typeAttributes(expectStatus(hidden, 200).data)).toEqual(masked);
      expectNoValue(hidden.body, values);
    });

    it('GET /inquiries/:id?include=verifications: the same', async () => {
      const url = `/api/v1/inquiries/${inquiryId}?include=verifications`;
      const included = (document: { included?: unknown[] }) =>
        document.included?.find((resource) => (resource as { id: string }).id === verificationId);

      const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
      const hidden = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

      expect(typeAttributes(included(seen))).toEqual(served);
      expect(typeAttributes(included(hidden))).toEqual(masked);
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
      expect(typeAttributes(payload?.data)).toEqual(served);
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

      expect(typeAttributes(eventData(seen))).toEqual(served);
      expect(typeAttributes(eventData(hidden))).toEqual(masked);
    });

    it('a stored API log body keeps them for pii:view and masks them without it', async () => {
      const requestId = `req-${type}-${newId('evt')}`;
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

      expect(typeAttributes(body(seen))).toEqual(served);
      expect(typeAttributes(body(hidden))).toEqual(masked);
      expectNoValue(JSON.stringify(body(hidden)), values);
    });

    it('is null once the inquiry is redacted, even with pii:view', async () => {
      const redactedInquiry = await createInquiry(api);
      const { id } = await seedVerification(api, api.environmentId, redactedInquiry, { type });
      await seedVerificationInputs(api.database.db, api.environmentId, {
        verificationId: id,
        inquiryId: redactedInquiry,
        values,
      });
      await redactInquiryRecords(api.database.db, api.environmentId, redactedInquiry);

      const response = await api.app.inject({
        url: `/api/v1/verifications/${id}`,
        headers: bearer(reviewer),
      });

      expect(typeAttributes(expectStatus(response, 200).data)).toEqual(masked);
      expectNoValue(response.body, values);
    });
  });
});

describe('the dashboard inquiry document (C52.8, C53.7)', () => {
  let database: TestDatabase;
  let dashboard: DashboardHarness;
  let reviewer: string;
  let viewer: string;
  let inquiryId: string;
  const ids = new Map<string, string>();

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
    for (const { type, values } of CASES) {
      const verification = await createVerification(database.db, organization.sandboxId, {
        // A ULID with the letters of a two-letter value in it, as random ids sometimes have
        // (`ver_…RCAF…` holds `CA`, the AAMVA state): a leak search must not mistake it for one.
        id: type === 'aamva' ? ID_HOLDING_A_VALUE : newId('ver'),
        inquiryId,
        type,
      });
      await seedVerificationInputs(database.db, organization.sandboxId, {
        verificationId: verification.id,
        inquiryId,
        values,
      });
      ids.set(type, verification.id);
    }
  }, 60_000);

  afterAll(async () => {
    await dashboard.close();
    await database.close();
  });

  async function included(token: string, type: string) {
    const document = dashboardInquiryDocumentSchema.parse(
      expectJson(await dashboard.call('GET', `/inquiries/${inquiryId}`, { token }), 200),
    );
    return document.included.find((resource) => resource.id === ids.get(type));
  }

  it.each(CASES)(
    '$type: shown to a reviewer with pii:view, masked for a viewer',
    async ({ type, values, served, masked }) => {
      expect(typeAttributes(await included(reviewer, type))).toEqual(served);
      const hidden = await included(viewer, type);
      expect(typeAttributes(hidden)).toEqual(masked);
      expectNoValue(JSON.stringify(hidden), values);
    },
  );
});
