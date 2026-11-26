/**
 * C52.8, C53.7: the crypto wallet attributes from real rows (no mocked hook): the claimed address
 * and chain of the consumed challenge (else the newest one), the signature scheme once consumed,
 * and the inquiry's expected address. They are served unmasked with `pii:view`, masked without
 * it and `null` after redaction, in `GET /verifications/:id`, `?include=verifications`, the
 * dashboard inquiry document, the `verification.*` payloads the Events API serves, and stored
 * API logs. Every value is synthetic.
 */
import { dashboardInquiryDocumentSchema, newId } from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  consumeCryptoChallenge,
  createCryptoChallenge,
  createEvent,
  createVerification,
  getVerification,
  listApiLogs,
  markCryptoChallengeProcessed,
  redactInquiryRecords,
  supersedeOpenCryptoChallenges,
  type Db,
  type VerificationWithChecks,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED, piiMaskFor } from '../../auth/pii.js';
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
import { cryptoWalletAttributes } from './crypto-wallet.js';
import { TEST_CHAINS, testWalletAddress } from '../crypto-challenges/testing.js';

const AT = new Date('2026-10-20T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(0x5b);
/** EIP-55's first published example address, claimed in its checksummed form. */
const CLAIMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const EXPECTED = CLAIMED.toLowerCase();

/** A challenge of `verificationId` at `minutes` past {@link AT}, optionally consumed. */
async function challenge(
  db: Db,
  environmentId: string,
  verification: { id: string; inquiryId: string },
  options: {
    minutes: number;
    address?: string;
    chainId?: string;
    consume?: { scheme: string | null; processedAs?: string };
  },
) {
  const createdAt = new Date(AT.getTime() + options.minutes * 60_000);
  await supersedeOpenCryptoChallenges(db, environmentId, verification.id);
  const created = await createCryptoChallenge(db, environmentId, {
    id: newId('cwc'),
    verificationId: verification.id,
    inquiryId: verification.inquiryId,
    chainId: options.chainId ?? TEST_CHAINS.ethereum,
    walletAddress: options.address ?? CLAIMED,
    message: `synthetic challenge ${String(options.minutes)}`,
    blindIndexKey: KEY,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 600_000),
  });
  if (options.consume !== undefined) {
    await consumeCryptoChallenge(db, environmentId, {
      id: created.id,
      verificationId: verification.id,
      now: createdAt,
      submission: { signature: '0xsynthetic', signedMessage: null, scheme: options.consume.scheme },
    });
    if (options.consume.processedAs !== undefined) {
      await markCryptoChallengeProcessed(db, environmentId, created.id, {
        scheme: options.consume.processedAs,
      });
    }
  }
  return created;
}

describe('the crypto wallet attribute hook (C52.8)', () => {
  let database: TestDatabase;
  let environmentId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    environmentId = (await createTestTenant(database.db)).environment.id;
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  async function wallet(fields: Record<string, unknown> = {}): Promise<VerificationWithChecks> {
    const { inquiry } = await createTestInquiry(database.db, environmentId, { fields });
    const created = await createVerification(database.db, environmentId, {
      id: newId('ver'),
      inquiryId: inquiry.id,
      type: 'crypto_wallet',
    });
    const loaded = await getVerification(database.db, environmentId, created.id);
    if (loaded === null) {
      throw new Error('verification missing');
    }
    return loaded;
  }

  it('is null before any challenge, but for the inquiry’s expected address', async () => {
    expect(await cryptoWalletAttributes.load(database.db, await wallet())).toEqual({
      'wallet-address': null,
      'expected-address': null,
      'chain-id': null,
      'signature-scheme': null,
    });
    expect(
      await cryptoWalletAttributes.load(
        database.db,
        await wallet({ crypto_wallet_address: EXPECTED }),
      ),
    ).toMatchObject({ 'expected-address': EXPECTED });
  });

  it('names the newest challenge’s address and chain before a submit, without a scheme', async () => {
    const verification = await wallet();
    await challenge(database.db, environmentId, verification, { minutes: 0 });
    const bitcoin = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    await challenge(database.db, environmentId, verification, {
      minutes: 1,
      address: bitcoin,
      chainId: TEST_CHAINS.bitcoin,
    });

    expect(await cryptoWalletAttributes.load(database.db, verification)).toEqual({
      'wallet-address': bitcoin,
      'expected-address': null,
      'chain-id': TEST_CHAINS.bitcoin,
      'signature-scheme': null,
    });
  });

  it('names the consumed challenge’s address, chain and scheme, even beside a newer one', async () => {
    const verification = await wallet({ crypto_wallet_address: EXPECTED });
    await challenge(database.db, environmentId, verification, {
      minutes: 0,
      consume: { scheme: null, processedAs: 'eip191' },
    });
    await challenge(database.db, environmentId, verification, {
      minutes: 1,
      address: testWalletAddress('attributes/other'),
      chainId: TEST_CHAINS.base,
    });

    expect(await cryptoWalletAttributes.load(database.db, verification)).toEqual({
      'wallet-address': CLAIMED,
      'expected-address': EXPECTED,
      'chain-id': TEST_CHAINS.ethereum,
      'signature-scheme': 'eip191',
    });
  });

  it('names the scheme a submit named while the job has not processed it', async () => {
    const verification = await wallet();
    await challenge(database.db, environmentId, verification, {
      minutes: 0,
      consume: { scheme: 'eip191' },
    });

    expect(await cryptoWalletAttributes.load(database.db, verification)).toMatchObject({
      'signature-scheme': 'eip191',
    });
  });

  it('masks the addresses, never the chain or the scheme', () => {
    const attributes = {
      'wallet-address': CLAIMED,
      'expected-address': EXPECTED,
      'chain-id': TEST_CHAINS.ethereum,
      'signature-scheme': 'eip191',
    };
    const masked = piiMaskFor({
      kind: 'user',
      userId: 'usr_X',
      userSessionId: 'uss_X',
      organizationId: 'org_X',
      environmentId,
      environmentKind: 'sandbox',
      permissions: new Set(),
      mfaSatisfied: true,
    });

    expect(cryptoWalletAttributes.mask(attributes, UNMASKED)).toEqual(attributes);
    expect(cryptoWalletAttributes.mask(attributes, masked)).toEqual({
      'wallet-address': null,
      'expected-address': null,
      'chain-id': TEST_CHAINS.ethereum,
      'signature-scheme': 'eip191',
    });
  });
});

const SHOWN = {
  'wallet-address': CLAIMED,
  'expected-address': EXPECTED,
  'chain-id': TEST_CHAINS.ethereum,
  'signature-scheme': 'eip191',
};
const MASKED = { ...SHOWN, 'wallet-address': null, 'expected-address': null };
const REDACTED = MASKED;

/** The type attributes of a served verification resource. */
function typeAttributes(resource: unknown): Record<string, unknown> {
  const attributes = (resource as { attributes: Record<string, unknown> }).attributes;
  return Object.fromEntries(
    Object.entries(attributes).filter(
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

describe('the crypto wallet attributes at every exit (C52.8 acceptance)', () => {
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
    inquiryId = await createInquiry(api, { fields: { crypto_wallet_address: EXPECTED } });
    verificationId = (
      await seedVerification(api, api.environmentId, inquiryId, { type: 'crypto_wallet' })
    ).id;
    await challenge(
      api.database.db,
      api.environmentId,
      { id: verificationId, inquiryId },
      { minutes: 0, consume: { scheme: 'eip191', processedAs: 'eip191' } },
    );
  });

  afterAll(async () => {
    await api.close();
  });

  it('GET /verifications/:id: unmasked for a key and with pii:view, masked without it', async () => {
    const url = `/api/v1/verifications/${verificationId}`;

    const key = expectStatus(await api.app.inject({ url, headers: bearer(api.token) }), 200);
    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const masked = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(key.data)).toEqual(SHOWN);
    expect(typeAttributes(seen.data)).toEqual(SHOWN);
    expect(typeAttributes(masked.data)).toEqual(MASKED);
  });

  it('GET /inquiries/:id?include=verifications: the same', async () => {
    const url = `/api/v1/inquiries/${inquiryId}?include=verifications`;
    const included = (document: { included?: unknown[] }) =>
      document.included?.find((resource) => (resource as { id: string }).id === verificationId);

    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const masked = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(included(seen))).toEqual(SHOWN);
    expect(typeAttributes(included(masked))).toEqual(MASKED);
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
    expect(typeAttributes(payload?.data)).toEqual(SHOWN);
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

    expect(typeAttributes(eventPayload(seen))).toEqual(SHOWN);
    expect(typeAttributes(eventPayload(masked))).toEqual(MASKED);
    expect(JSON.stringify(eventPayload(masked))).not.toContain(EXPECTED.slice(2, 20));
  });

  it('a stored API log body keeps them for pii:view and masks them without it', async () => {
    const requestId = `req-crypto-${newId('evt')}`;
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

    expect(typeAttributes(body(seen))).toEqual(SHOWN);
    expect(typeAttributes(body(masked))).toEqual(MASKED);
    expect(JSON.stringify(body(masked)).toLowerCase()).not.toContain(EXPECTED.slice(2, 20));
  });

  it('is null after the inquiry is redacted, even with pii:view', async () => {
    const other = await createInquiry(api, { fields: { crypto_wallet_address: EXPECTED } });
    const { id } = await seedVerification(api, api.environmentId, other, {
      type: 'crypto_wallet',
    });
    await challenge(
      api.database.db,
      api.environmentId,
      { id, inquiryId: other },
      { minutes: 0, consume: { scheme: 'eip191', processedAs: 'eip191' } },
    );
    await redactInquiryRecords(api.database.db, api.environmentId, other);

    const seen = expectStatus(
      await api.app.inject({ url: `/api/v1/verifications/${id}`, headers: bearer(reviewer) }),
      200,
    );

    expect(typeAttributes(seen.data)).toEqual(REDACTED);
  });
});

describe('the crypto wallet attributes on the dashboard inquiry document (C52.8)', () => {
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
    const { inquiry } = await createTestInquiry(database.db, organization.sandboxId, {
      fields: { crypto_wallet_address: EXPECTED },
    });
    inquiryId = inquiry.id;
    verificationId = (
      await createVerification(database.db, organization.sandboxId, {
        id: newId('ver'),
        inquiryId,
        type: 'crypto_wallet',
      })
    ).id;
    await challenge(
      database.db,
      organization.sandboxId,
      { id: verificationId, inquiryId },
      { minutes: 0, consume: { scheme: 'eip191', processedAs: 'eip191' } },
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

  it('shows them to a reviewer with pii:view and masks them for a viewer', async () => {
    expect(typeAttributes(await included(reviewer))).toEqual(SHOWN);
    const masked = await included(viewer);
    expect(typeAttributes(masked)).toEqual(MASKED);
    expect(JSON.stringify(masked).toLowerCase()).not.toContain(EXPECTED.slice(2, 20));
  });
});
