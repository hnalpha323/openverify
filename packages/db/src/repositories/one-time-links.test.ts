import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import {
  createOneTimeLink,
  redeemOneTimeLink,
  revokeOneTimeLinks,
  transitionInquiryStatus,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const token = () => hashSessionToken(`ovo_${testId('inq')}`);
const inAnHour = () => new Date(Date.now() + 3_600_000);

async function setup() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  return { env: environment.id, inquiry };
}

describe('one-time links (C10)', () => {
  it('redeem exactly once, and tell the redeemer the environment', async () => {
    const { env, inquiry } = await setup();
    const tokenHash = token();
    const { link } = await createOneTimeLink(database.db, env, {
      inquiryId: inquiry.id,
      tokenHash,
      expiresAt: inAnHour(),
    });

    const redeemed = await redeemOneTimeLink(database.db, { inquiryId: inquiry.id, tokenHash });
    const again = await redeemOneTimeLink(database.db, { inquiryId: inquiry.id, tokenHash });

    expect(link).toMatchObject({
      environmentId: env,
      inquiryId: inquiry.id,
      usedAt: null,
      revokedAt: null,
    });
    expect(redeemed).toMatchObject({
      id: link.id,
      environmentId: env,
      usedAt: expect.any(Date) as Date,
    });
    expect(again).toBeNull();
  });

  it('revoke older unused links when a new one is generated', async () => {
    const { env, inquiry } = await setup();
    const older = token();
    await createOneTimeLink(database.db, env, {
      inquiryId: inquiry.id,
      tokenHash: older,
      expiresAt: inAnHour(),
    });

    const { revokedCount } = await createOneTimeLink(database.db, env, {
      inquiryId: inquiry.id,
      tokenHash: token(),
      expiresAt: inAnHour(),
    });

    expect(revokedCount).toBe(1);
    expect(
      await redeemOneTimeLink(database.db, { inquiryId: inquiry.id, tokenHash: older }),
    ).toBeNull();
  });

  it('refuse a wrong inquiry, an expired link and an inquiry no longer open', async () => {
    const { env, inquiry } = await setup();
    const other = await setup();
    const wrongInquiry = token();
    const expired = token();
    const closed = token();
    await createOneTimeLink(database.db, env, {
      inquiryId: inquiry.id,
      tokenHash: wrongInquiry,
      expiresAt: inAnHour(),
    });
    await createOneTimeLink(database.db, other.env, {
      inquiryId: other.inquiry.id,
      tokenHash: expired,
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(
      await redeemOneTimeLink(database.db, {
        inquiryId: other.inquiry.id,
        tokenHash: wrongInquiry,
      }),
    ).toBeNull();
    expect(
      await redeemOneTimeLink(database.db, { inquiryId: other.inquiry.id, tokenHash: expired }),
    ).toBeNull();
    await createOneTimeLink(database.db, other.env, {
      inquiryId: other.inquiry.id,
      tokenHash: closed,
      expiresAt: inAnHour(),
    });
    await transitionInquiryStatus(database.db, other.env, other.inquiry.id, {
      from: 'created',
      to: 'expired',
    });
    expect(
      await redeemOneTimeLink(database.db, { inquiryId: other.inquiry.id, tokenHash: closed }),
    ).toBeNull();
    expect(
      await redeemOneTimeLink(database.db, { inquiryId: inquiry.id, tokenHash: token() }),
    ).toBeNull();
  });

  it('can be revoked for an inquiry, inside its environment only', async () => {
    const { env, inquiry } = await setup();
    const tokenHash = token();
    await createOneTimeLink(database.db, env, {
      inquiryId: inquiry.id,
      tokenHash,
      expiresAt: inAnHour(),
    });

    expect(await revokeOneTimeLinks(database.db, testId('env'), inquiry.id)).toBe(0);
    expect(await revokeOneTimeLinks(database.db, env, inquiry.id)).toBe(1);
    expect(await redeemOneTimeLink(database.db, { inquiryId: inquiry.id, tokenHash })).toBeNull();
  });
});
