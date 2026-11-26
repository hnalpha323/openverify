/**
 * C52.8, C53.7 acceptance, per Phase 5 type and per exit: every attribute is served unmasked to a
 * principal that may see PII and masked (PII members `null`, a document's `fields` member-wise)
 * to a user without `pii:view`, in `GET /verifications/:id`, `?include=verifications`, the
 * `verification.*` event payload as the Events API serves it, and a stored API log body. The
 * dashboard inquiry document is `routes/dashboard/phase5-masking.test.ts`.
 *
 * Each type's attribute hook is replaced by one that loads its golden fixture's attributes, so
 * real (synthetic) values reach every exit before the type's builder lands.
 */
import { newId, PII_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import { createEvent, getVerification, listApiLogs } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { stageVerificationEvent } from './services/verifications.js';
import {
  bearer,
  createInquiry,
  createTestApi,
  expectStatus,
  seedVerification,
  type TestApi,
} from './test-support/harness.js';
import {
  fixtureAttributes,
  maskedFixtureAttributes,
  PHASE5_ATTRIBUTE_TYPES,
  piiValuesOf,
} from './test-support/phase5-attributes.js';

// Hoisted with the mocks below, which run before this module's top-level code.
const { fixtureModule } = vi.hoisted(() => ({
  fixtureModule: async (apiType: string, hook: string) =>
    (await import('./test-support/phase5-attributes.js')).fixtureAttributeModule(
      apiType as never,
      hook,
    ),
}));
vi.mock('./services/attributes/document.js', () => fixtureModule('document', 'documentAttributes'));
vi.mock('./services/attributes/database.js', () => fixtureModule('database', 'databaseAttributes'));
vi.mock('./services/attributes/aamva.js', () => fixtureModule('aamva', 'aamvaAttributes'));
vi.mock('./services/attributes/phone-number.js', () =>
  fixtureModule('phone-number', 'phoneNumberAttributes'),
);
vi.mock('./services/attributes/email-address.js', () =>
  fixtureModule('email-address', 'emailAddressAttributes'),
);
vi.mock('./services/attributes/government-id-nfc.js', () =>
  fixtureModule('government-id-nfc', 'governmentIdNfcAttributes'),
);
vi.mock('./services/attributes/crypto-wallet.js', () =>
  fixtureModule('crypto-wallet', 'cryptoWalletAttributes'),
);
vi.mock('./services/attributes/database-business.js', () =>
  fixtureModule('database-business', 'databaseBusinessAttributes'),
);
vi.mock('./services/attributes/business-website.js', () =>
  fixtureModule('business-website', 'businessWebsiteAttributes'),
);

let api: TestApi;
/** A dashboard user with every permission but `pii:view`. */
let viewer: string;
/** A dashboard user with every permission. */
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

/** The type attributes of a served verification resource. */
function typeAttributes(resource: unknown): Record<string, unknown> {
  const attributes = (resource as { attributes: Record<string, unknown> }).attributes;
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([name]) => !['status', 'checks', 'created-at', 'updated-at', 'redacted-at'].includes(name),
    ),
  );
}

describe.each(PHASE5_ATTRIBUTE_TYPES)('$apiType attributes', ({ type, apiType }) => {
  let inquiryId: string;
  let verificationId: string;

  beforeAll(async () => {
    inquiryId = await createInquiry(api);
    verificationId = (await seedVerification(api, api.environmentId, inquiryId, { type })).id;
  });

  it('has PII values in its fixture for masking to remove', () => {
    expect(piiValuesOf(apiType).length).toBeGreaterThan(0);
    expect(
      Object.keys(fixtureAttributes(apiType)).some((name) =>
        PII_VERIFICATION_ATTRIBUTES.includes(name),
      ),
    ).toBe(true);
  });

  it('GET /verifications/:id: unmasked with pii:view, masked without it', async () => {
    const url = `/api/v1/verifications/${verificationId}`;

    const key = expectStatus(await api.app.inject({ url, headers: bearer(api.token) }), 200);
    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const masked = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(key.data)).toEqual(fixtureAttributes(apiType));
    expect(typeAttributes(seen.data)).toEqual(fixtureAttributes(apiType));
    expect(typeAttributes(masked.data)).toEqual(maskedFixtureAttributes(apiType));
  });

  it('GET /inquiries/:id?include=verifications: the same', async () => {
    const url = `/api/v1/inquiries/${inquiryId}?include=verifications`;
    const included = (document: { included?: unknown[] }) =>
      document.included?.find((resource) => (resource as { id: string }).id === verificationId);

    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const masked = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(included(seen))).toEqual(fixtureAttributes(apiType));
    expect(typeAttributes(included(masked))).toEqual(maskedFixtureAttributes(apiType));
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
    expect(typeAttributes(payload?.data)).toEqual(fixtureAttributes(apiType));
    const event = await createEvent(api.database.db, api.environmentId, {
      id: newId('evt'),
      name: 'verification.passed',
      payload: payload as never,
    });
    const url = `/api/v1/events/${event.id}`;
    const eventPayload = (document: { data: unknown }) =>
      (document.data as { attributes: { payload: { data: unknown } } }).attributes.payload.data;

    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const masked = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(eventPayload(seen))).toEqual(fixtureAttributes(apiType));
    expect(typeAttributes(eventPayload(masked))).toEqual(maskedFixtureAttributes(apiType));
  });

  it('a stored API log body keeps them for pii:view and masks them without it', async () => {
    const requestId = `req-${apiType}-${newId('evt')}`;
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
    const masked = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(body(seen))).toEqual(fixtureAttributes(apiType));
    expect(typeAttributes(body(masked))).toEqual(maskedFixtureAttributes(apiType));
    for (const value of piiValuesOf(apiType)) {
      expect(JSON.stringify(body(masked))).not.toContain(value);
    }
  });
});
