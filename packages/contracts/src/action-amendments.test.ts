/**
 * The attributes Workflow 8A's actions add to earlier resources (C122.1, C127.9, C128): each with its
 * default, so a resource written before the column reads as the default, which fails closed.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAccountTypeResource,
  createAccountTypeBodySchema,
  updateAccountTypeBodySchema,
} from './account-types.js';
import { buildDeviceResource, deviceDocumentSchema, trustDeviceBodySchema } from './devices.js';
import { flowSessionResponseSchema } from './flow-api.js';
import { getInquiryQuerySchema, INQUIRY_INCLUDES } from './inquiries.js';
import {
  approveInquiryBodySchema,
  declineInquiryBodySchema,
  markInquiryForReviewBodySchema,
  reopenInquiryBodySchema,
} from './inquiry-actions.js';
import { buildListResource, LIST_CREATE_BODY_SCHEMAS, updateListBodySchema } from './lists.js';
import { readFixture, AT } from './test-support.js';
import {
  buildTransactionTypeResource,
  createTransactionTypeBodySchema,
  updateTransactionTypeBodySchema,
} from './transactions.js';

const ROUTE = { url: 'https://example.com/contest' };

/** The stubs have no attribute types yet, and a RED test has to compile. */
const attributesOf = (resource: { attributes: object }) =>
  resource.attributes as Record<string, unknown>;

describe('the approve and decline bodies (C128.1, C128.2)', () => {
  it.each([
    ['approve', approveInquiryBodySchema],
    ['decline', declineInquiryBodySchema],
  ] as const)('%s declares solely-automated, which stays optional', (_name, schema) => {
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ meta: { 'solely-automated': true } })).toEqual({
      meta: { 'solely-automated': true },
    });
    expect(schema.safeParse({ meta: { 'solely-automated': 'yes' } }).success).toBe(false);
    expect(schema.safeParse({ meta: { other: true } }).success).toBe(false);
  });

  it.each([
    ['approve', approveInquiryBodySchema],
    ['decline', declineInquiryBodySchema],
    ['mark for review', markInquiryForReviewBodySchema],
  ] as const)('%s takes a comment for the record', (_name, schema) => {
    expect(schema.parse({ meta: { comment: 'A synthetic note' } })).toEqual({
      meta: { comment: 'A synthetic note' },
    });
    expect(schema.safeParse({ meta: { comment: '' } }).success).toBe(false);
    expect(schema.safeParse({ meta: { comment: 'x'.repeat(2001) } }).success).toBe(false);
  });

  it('declares nothing on a mark for review: it is no decision on the person', () => {
    expect(
      markInquiryForReviewBodySchema.safeParse({ meta: { 'solely-automated': true } }).success,
    ).toBe(false);
  });
});

describe('POST /inquiries/:id/reopen (C128.6)', () => {
  it('needs a comment', () => {
    expect(
      reopenInquiryBodySchema.safeParse({ meta: { comment: 'Asked for review' } }).success,
    ).toBe(true);
    expect(reopenInquiryBodySchema.safeParse({ meta: {} }).success).toBe(false);
    expect(reopenInquiryBodySchema.safeParse({}).success).toBe(false);
    expect(reopenInquiryBodySchema.safeParse(undefined).success).toBe(false);
  });
});

describe('the decisions include (C143.6)', () => {
  it('joins the inquiry includes', () => {
    expect(INQUIRY_INCLUDES).toContain('decisions');
    expect(getInquiryQuerySchema.safeParse({ include: 'decisions' }).success).toBe(true);
  });
});

describe('the list purpose (C122.1, V10)', () => {
  const list = {
    id: 'lst_01M5CK3190XEVBM5ZXA76E1JSN',
    kind: 'name' as const,
    name: 'A list',
    status: 'active' as const,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    itemCount: 0,
    version: 1,
    itemRetentionDays: null,
    screenAtCompletion: false,
    attributes: { 'allow-fuzzy-name-first': false },
  };

  it('serves block by default, which fails closed', () => {
    expect(attributesOf(buildListResource(list)).purpose).toBe('block');
  });

  it('serves the stored purpose', () => {
    expect(attributesOf(buildListResource({ ...list, purpose: 'allow' })).purpose).toBe('allow');
  });

  it('is optional at creation and settable by PATCH, within the three', () => {
    const create = LIST_CREATE_BODY_SCHEMAS.name;
    const base = { data: { attributes: { name: 'A list' } } };
    expect(create.safeParse(base).success).toBe(true);
    const withPurpose = { data: { attributes: { name: 'A list', purpose: 'watch' } } };
    expect(create.safeParse(withPurpose).success).toBe(true);
    const wrong = { data: { attributes: { name: 'A list', purpose: 'other' } } };
    expect(create.safeParse(wrong).success).toBe(false);
    expect(
      updateListBodySchema.safeParse({ data: { attributes: { purpose: 'allow' } } }).success,
    ).toBe(true);
  });
});

describe('the trust mark of a device (C127.9)', () => {
  const device = {
    id: 'dev_01M5CJZC30W7PFE0GD30HJWEC6',
    createdAt: AT,
    deviceFingerprint: null,
    browserFingerprint: null,
    deviceClass: null,
    platform: 'web' as const,
    collectorVersion: 1,
    fingerprintRandomised: false,
    keyId: 'Qm9xZXN0ZXI',
    sessionCount: 1,
    firstSeenAt: AT,
    lastSeenAt: AT,
  };
  const RUN = 'wfr_01M5CM00000000000000000006';

  it('reads untrusted by default', () => {
    expect(attributesOf(buildDeviceResource(device))).toMatchObject({
      'trusted-at': null,
      'trusted-by': null,
      'trust-reason': null,
    });
  });

  it('names a run as who trusted it, with a code', () => {
    const resource = buildDeviceResource({
      ...device,
      trustedAt: AT,
      trustedBy: { type: 'workflow-run', id: RUN },
      trustReason: 'manual_review_passed',
    });
    expect(attributesOf(resource)['trusted-by']).toEqual({ type: 'workflow-run', id: RUN });
    expect(attributesOf(resource)['trust-reason']).toBe('manual_review_passed');
  });

  it('refuses a half mark: a time with no one behind it, or free text as a reason', () => {
    expect(() => buildDeviceResource({ ...device, trustedAt: AT })).toThrow();
    expect(() =>
      buildDeviceResource({
        ...device,
        trustedAt: AT,
        trustedBy: { type: 'workflow-run', id: RUN },
        trustReason: 'Jane reviewed this',
      }),
    ).toThrow();
  });

  it('parses the golden device with its mark', () => {
    expect(deviceDocumentSchema.safeParse(readFixture('api/device.json')).success).toBe(true);
  });

  it('takes a reason to trust, or untrust, never both and never neither', () => {
    const parse = (meta: object) => trustDeviceBodySchema.safeParse({ meta }).success;
    expect(parse({ 'trust-reason': 'manual_review_passed' })).toBe(true);
    expect(parse({ untrust: true })).toBe(true);
    expect(parse({ 'trust-reason': 'manual_review_passed', untrust: true })).toBe(false);
    expect(parse({})).toBe(false);
    expect(parse({ untrust: false })).toBe(false);
  });
});

describe('transaction and account types (C122.1, C128.3)', () => {
  const type = {
    id: 'txntp_01M5CK3190XEVBM5ZXA76E1JSN',
    name: 'Payment',
    status: 'active' as const,
    fieldSchemas: [],
    statuses: ['open', 'declined'],
    relationSchemas: [],
    latestVersion: 1,
    publishedVersion: 1,
    createdAt: AT,
    updatedAt: AT,
  };

  it('defaults a transaction type to declined being adverse, with no contest route', () => {
    expect(attributesOf(buildTransactionTypeResource(type))).toMatchObject({
      'adverse-statuses': ['declined'],
      'contest-route': null,
    });
  });

  it('serves what the type declares', () => {
    const attributes = attributesOf(
      buildTransactionTypeResource({
        ...type,
        adverseStatuses: ['blocked'],
        contestRoute: ROUTE,
      }),
    );
    expect(attributes['adverse-statuses']).toEqual(['blocked']);
    expect(attributes['contest-route']).toEqual(ROUTE);
  });

  it('takes them at creation and by PATCH, which no longer needs a name', () => {
    const attributes = {
      name: 'Payment',
      'adverse-statuses': ['declined'],
      'contest-route': ROUTE,
    };
    expect(
      createTransactionTypeBodySchema.safeParse({ data: { type: 'transaction-type', attributes } })
        .success,
    ).toBe(true);
    const patch = (value: object) =>
      updateTransactionTypeBodySchema.safeParse({
        data: { type: 'transaction-type', attributes: value },
      }).success;
    expect(patch({ name: 'Renamed' })).toBe(true);
    expect(patch({ 'adverse-statuses': ['blocked'] })).toBe(true);
    expect(patch({ 'contest-route': null })).toBe(true);
    expect(patch({})).toBe(false);
  });

  it('gives an account type an optional contest route', () => {
    const accountType = {
      id: 'acctp_01M5CJXHZMQ72CZPQ5Y3XGC48W',
      name: 'User',
      fieldsSchema: {},
      createdAt: AT,
    };
    expect(attributesOf(buildAccountTypeResource(accountType))['contest-route']).toBeNull();
    expect(
      attributesOf(buildAccountTypeResource({ ...accountType, contestRoute: ROUTE }))[
        'contest-route'
      ],
    ).toEqual(ROUTE);
    expect(
      createAccountTypeBodySchema.safeParse({
        data: { type: 'account-type', attributes: { name: 'User', 'contest-route': ROUTE } },
      }).success,
    ).toBe(true);
    expect(
      updateAccountTypeBodySchema.safeParse({
        data: { type: 'account-type', attributes: { 'contest-route': null } },
      }).success,
    ).toBe(true);
  });
});

describe('the flow session answer (C3 amended, C128.7)', () => {
  it('takes decision-contest-route, and an older answer without it still parses', () => {
    const session = readFixture('api/flow-session.json') as Record<string, unknown>;
    expect(flowSessionResponseSchema.safeParse(session).success).toBe(true);
    const route = { url: 'https://example.com/contest', host: 'example.com', contact: null };
    expect(
      flowSessionResponseSchema.safeParse({ ...session, 'decision-contest-route': route }).success,
    ).toBe(true);
    expect(
      flowSessionResponseSchema.safeParse({ ...session, 'decision-contest-route': null }).success,
    ).toBe(true);
  });
});
