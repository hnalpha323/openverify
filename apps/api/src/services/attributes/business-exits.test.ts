/**
 * C52.8, C53.7 acceptance with the real business registry and business website attribute hooks,
 * at every exit: served unmasked to a key and to a user with `pii:view`, masked for a user without
 * it, in `GET /verifications/:id`, `?include=verifications`, the `verification.*` payload as the
 * Events API serves it, a stored API log body and the dashboard inquiry document; and `null` once
 * the inquiry is redacted, even with `pii:view` (the register's source, which is not PII, stays;
 * the domain's registration date goes with the checks' metadata). Every value is synthetic.
 */
import { dashboardInquiryDocumentSchema, newId } from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  createEvent,
  createVerification,
  getVerification,
  listApiLogs,
  putBusinessRegistryRecord,
  redactInquiryRecords,
  replaceVerificationChecks,
  type Db,
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

const BUSINESS_VALUES = {
  'business-name': 'Utopia Synthetic Widgets Ltd',
  'country-code': 'GB',
  'registration-number': '01234567',
  'address-street-1': '1 Placeholder Row',
  'address-city': 'Utopia Town',
  'address-postal-code': 'UT1 0ZZ',
  'associated-persons': [{ 'name-first': 'Ada', 'name-last': 'Placeholder', birthdate: '1980-04' }],
};
const WEBSITE_VALUES = { 'website-url': 'https://www.utopia-widgets.example/shop' };

const BUSINESS_SERVED = {
  'business-name': 'Utopia Synthetic Widgets Ltd',
  'registration-number': '01234567',
  lei: null,
  'address-street-1': '1 Placeholder Row',
  'address-street-2': null,
  'address-city': 'Utopia Town',
  'address-subdivision': null,
  'address-postal-code': 'UT1 0ZZ',
  'address-country-code': 'GB',
  'associated-persons': [{ 'name-first': 'Ada', 'name-last': 'Placeholder', birthdate: '1980-04' }],
  'registry-record-id': '01234567',
  'registry-legal-name': 'UTOPIA SYNTHETIC WIDGETS LIMITED',
  'registry-source': 'companies-house',
  'registry-status': 'active',
};
const BUSINESS_MASKED = {
  ...BUSINESS_SERVED,
  'business-name': null,
  'address-street-1': null,
  'address-city': null,
  'address-postal-code': null,
  'address-country-code': null,
  'associated-persons': null,
  'registry-legal-name': null,
};
const BUSINESS_REDACTED = {
  ...Object.fromEntries(Object.keys(BUSINESS_SERVED).map((name) => [name, null])),
  'registry-source': 'companies-house',
};

const WEBSITE_SERVED = {
  'website-url': 'https://www.utopia-widgets.example/shop',
  'website-domain': 'www.utopia-widgets.example',
  'domain-registered-at': '2004-05-06T00:00:00.000Z',
};
const WEBSITE_MASKED = {
  'website-url': null,
  'website-domain': null,
  'domain-registered-at': '2004-05-06T00:00:00.000Z',
};

/** Each type: its stored values, what is served, what a masked principal sees, the PII text. */
const CASES = [
  {
    type: 'database_business' as const,
    values: BUSINESS_VALUES,
    served: BUSINESS_SERVED,
    masked: BUSINESS_MASKED,
    redacted: BUSINESS_REDACTED,
    pii: [
      'Utopia Synthetic Widgets Ltd',
      '1 Placeholder Row',
      'Utopia Town',
      'UT1 0ZZ',
      'Ada',
      'Placeholder',
      '1980-04',
      'UTOPIA SYNTHETIC WIDGETS LIMITED',
    ],
  },
  {
    type: 'business_website' as const,
    values: WEBSITE_VALUES,
    served: WEBSITE_SERVED,
    masked: WEBSITE_MASKED,
    // Redaction clears the checks' metadata too, the domain age check's date with it.
    redacted: { 'website-url': null, 'website-domain': null, 'domain-registered-at': null },
    pii: ['https://www.utopia-widgets.example/shop', 'www.utopia-widgets.example'],
  },
];

/** Writes what the type's job leaves: the register's record, or the domain age check. */
async function judged(
  db: Db,
  environmentId: string,
  type: (typeof CASES)[number]['type'],
  verificationId: string,
  inquiryId: string,
) {
  if (type === 'database_business') {
    await putBusinessRegistryRecord(db, environmentId, {
      verificationId,
      inquiryId,
      source: 'companies-house',
      record: {
        recordId: '01234567',
        legalName: 'UTOPIA SYNTHETIC WIDGETS LIMITED',
        status: 'active',
        jurisdiction: 'england-wales',
        registeredAddress: '1 Placeholder Row, Utopia Town, UT1 0ZZ, GB',
      },
      fetchedAt: new Date('2026-10-24T12:00:00.000Z'),
    });
    return;
  }
  await replaceVerificationChecks(db, environmentId, verificationId, [
    {
      name: 'business_website_domain_age_detection',
      status: 'passed',
      type: 'fraud',
      requirement: 'not_required',
      reasons: [],
      metadata: { 'registered-at': '2004-05-06', 'age-days': 8207 },
    },
  ]);
}

/** Fails when any PII value appears in `text` as a JSON string of its own. */
function expectNoValue(text: string, values: readonly string[]): void {
  for (const value of values) {
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

  describe.each(CASES)('$type attributes', ({ type, values, served, masked, redacted, pii }) => {
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
      await judged(api.database.db, api.environmentId, type, verificationId, inquiryId);
    });

    it('GET /verifications/:id: unmasked for a key and with pii:view, masked without it', async () => {
      const url = `/api/v1/verifications/${verificationId}`;

      const key = expectStatus(await api.app.inject({ url, headers: bearer(api.token) }), 200);
      const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
      const hidden = await api.app.inject({ url, headers: bearer(viewer) });

      expect(typeAttributes(key.data)).toEqual(served);
      expect(typeAttributes(seen.data)).toEqual(served);
      expect(typeAttributes(expectStatus(hidden, 200).data)).toEqual(masked);
      expectNoValue(hidden.body, pii);
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
      expectNoValue(JSON.stringify(body(hidden)), pii);
    });

    it('is null once the inquiry is redacted, even with pii:view', async () => {
      const redactedInquiry = await createInquiry(api);
      const { id } = await seedVerification(api, api.environmentId, redactedInquiry, { type });
      await seedVerificationInputs(api.database.db, api.environmentId, {
        verificationId: id,
        inquiryId: redactedInquiry,
        values,
      });
      await judged(api.database.db, api.environmentId, type, id, redactedInquiry);
      await redactInquiryRecords(api.database.db, api.environmentId, redactedInquiry);

      const response = await api.app.inject({
        url: `/api/v1/verifications/${id}`,
        headers: bearer(reviewer),
      });

      expect(typeAttributes(expectStatus(response, 200).data)).toEqual(redacted);
      expectNoValue(response.body, pii);
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
        id: newId('ver'),
        inquiryId,
        type,
      });
      await seedVerificationInputs(database.db, organization.sandboxId, {
        verificationId: verification.id,
        inquiryId,
        values,
      });
      await judged(database.db, organization.sandboxId, type, verification.id, inquiryId);
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
    async ({ type, served, masked, pii }) => {
      expect(typeAttributes(await included(reviewer, type))).toEqual(served);
      const hidden = await included(viewer, type);
      expect(typeAttributes(hidden)).toEqual(masked);
      expectNoValue(JSON.stringify(hidden), pii);
    },
  );
});
