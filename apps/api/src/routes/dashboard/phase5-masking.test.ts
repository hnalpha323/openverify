/**
 * C52.8, C53.7 acceptance on the dashboard inquiry document (what the console's server components
 * receive and render): each Phase 5 type's attributes unmasked for a reviewer (`pii:view`) and
 * masked for a viewer. The server API exits are `src/phase5-masking.test.ts`.
 */
import { dashboardInquiryDocumentSchema, newId } from '@openverify/contracts';
import { createVerification } from '@openverify/db';
import { createTestDatabase, createTestInquiry, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  fixtureAttributes,
  maskedFixtureAttributes,
  PHASE5_ATTRIBUTE_TYPES,
  piiValuesOf,
} from '../../test-support/phase5-attributes.js';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
  type TestOrganization,
} from './dashboard.test-support.js';

// Hoisted with the mocks below, which run before this module's top-level code.
const { fixtureModule } = vi.hoisted(() => ({
  fixtureModule: async (apiType: string, hook: string) =>
    (await import('../../test-support/phase5-attributes.js')).fixtureAttributeModule(
      apiType as never,
      hook,
    ),
}));
vi.mock('../../services/attributes/document.js', () =>
  fixtureModule('document', 'documentAttributes'),
);
vi.mock('../../services/attributes/database.js', () =>
  fixtureModule('database', 'databaseAttributes'),
);
vi.mock('../../services/attributes/aamva.js', () => fixtureModule('aamva', 'aamvaAttributes'));
vi.mock('../../services/attributes/phone-number.js', () =>
  fixtureModule('phone-number', 'phoneNumberAttributes'),
);
vi.mock('../../services/attributes/email-address.js', () =>
  fixtureModule('email-address', 'emailAddressAttributes'),
);
vi.mock('../../services/attributes/government-id-nfc.js', () =>
  fixtureModule('government-id-nfc', 'governmentIdNfcAttributes'),
);
vi.mock('../../services/attributes/crypto-wallet.js', () =>
  fixtureModule('crypto-wallet', 'cryptoWalletAttributes'),
);
vi.mock('../../services/attributes/database-business.js', () =>
  fixtureModule('database-business', 'databaseBusinessAttributes'),
);
vi.mock('../../services/attributes/business-website.js', () =>
  fixtureModule('business-website', 'businessWebsiteAttributes'),
);

let database: TestDatabase;
let api: DashboardHarness;
let organization: TestOrganization;
let reviewer: string;
let viewer: string;
let inquiryId: string;
const verificationIds = new Map<string, string>();

beforeAll(async () => {
  database = await createTestDatabase();
  api = await createDashboardHarness(database);
  organization = await api.organization();
  reviewer = await api.signIn((await api.operator(organization, { roles: ['reviewer'] })).email);
  viewer = await api.signIn((await api.operator(organization, { roles: ['viewer'] })).email);
  const { inquiry } = await createTestInquiry(database.db, organization.sandboxId);
  inquiryId = inquiry.id;
  for (const { type } of PHASE5_ATTRIBUTE_TYPES) {
    const verification = await createVerification(database.db, organization.sandboxId, {
      id: newId('ver'),
      inquiryId,
      type,
    });
    verificationIds.set(type, verification.id);
  }
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

function typeAttributes(resource: { attributes: Record<string, unknown> } | undefined) {
  return Object.fromEntries(
    Object.entries(resource?.attributes ?? {}).filter(
      ([name]) => !['status', 'checks', 'created-at', 'updated-at'].includes(name),
    ),
  );
}

async function included(token: string, type: string) {
  const document = dashboardInquiryDocumentSchema.parse(
    expectJson(await api.call('GET', `/inquiries/${inquiryId}`, { token }), 200),
  );
  return document.included.find((resource) => resource.id === verificationIds.get(type)) as
    { attributes: Record<string, unknown> } | undefined;
}

describe.each(PHASE5_ATTRIBUTE_TYPES)(
  'the dashboard inquiry document: $apiType attributes',
  ({ type, apiType }) => {
    it('shows them to a reviewer with pii:view', async () => {
      expect(typeAttributes(await included(reviewer, type))).toEqual(fixtureAttributes(apiType));
    });

    it('masks them for a viewer without pii:view', async () => {
      const resource = await included(viewer, type);

      expect(typeAttributes(resource)).toEqual(maskedFixtureAttributes(apiType));
      for (const value of piiValuesOf(apiType)) {
        expect(JSON.stringify(resource)).not.toContain(value);
      }
    });
  },
);
