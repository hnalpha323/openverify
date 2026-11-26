/** C10: every verification status write goes through the state machine. */
import { newId } from '@openverify/contracts';
import { InvalidVerificationTransitionError } from '@openverify/core';
import { createVerification, getVerification, setVerificationStatus, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moveVerification } from './verifications.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');

let database: TestDatabase;
let db: Db;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

async function verificationIn(status: 'initiated' | 'submitted' | 'passed') {
  const { inquiry } = await createTestInquiry(db, environmentId);
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId: inquiry.id, type: 'selfie' });
  if (status !== 'initiated') {
    await setVerificationStatus(db, environmentId, id, { to: status });
  }
  return { id, environmentId, status };
}

describe('moveVerification', () => {
  it('moves an allowed transition and names its event', async () => {
    const verification = await verificationIn('submitted');

    const moved = await moveVerification(db, verification, 'passed', NOW);

    expect(moved?.event).toBe('verification.passed');
    expect(moved?.verification).toMatchObject({ status: 'passed', completedAt: NOW });
  });

  it('names no event for a move into confirmed', async () => {
    const verification = await verificationIn('initiated');

    expect((await moveVerification(db, verification, 'confirmed', NOW))?.event).toBeNull();
  });

  it('refuses a transition the C10 state machine forbids, writing nothing', async () => {
    const verification = await verificationIn('passed');

    await expect(moveVerification(db, verification, 'failed', NOW)).rejects.toBeInstanceOf(
      InvalidVerificationTransitionError,
    );
    expect((await getVerification(db, environmentId, verification.id))?.status).toBe('passed');
  });

  it('returns null when the status changed since it was read', async () => {
    const verification = await verificationIn('initiated');
    await setVerificationStatus(db, environmentId, verification.id, { to: 'submitted' });

    expect(await moveVerification(db, verification, 'canceled', NOW)).toBeNull();
    expect((await getVerification(db, environmentId, verification.id))?.status).toBe('submitted');
  });
});
