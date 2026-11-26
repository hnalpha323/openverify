/**
 * C42.4 and C42.8 face search on PGlite: the 1:N scan over sealed templates (newest first, in
 * batches, up to the cap, the current account excluded), the account comparison's best cosine and
 * the face groups of background candidates. Every embedding is a seeded synthetic vector.
 */
import { newId } from '@openverify/contracts';
import { createVerification, faceTemplates, writeFaceData } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bestTemplateCosine, faceGroups, scanFaceTemplates } from './face-search.js';
import { unitVector, vectorAtCosine } from './selfie-testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const PROBE = unitVector(1);
const FLOOR = 0.363;
const T0 = new Date('2026-10-01T00:00:00.000Z');

/** A stored template at `cosine` to the probe, created `minutes` after T0. */
async function template(environmentId: string, cosine: number, minutes: number, seed: number) {
  const { inquiry } = await createTestInquiry(database.db, environmentId);
  const verificationId = newId('ver');
  await createVerification(database.db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  const { templateId } = await writeFaceData(database.db, environmentId, {
    verificationId,
    inquiryId: inquiry.id,
    model: 'sface-2021dec',
    embedding: vectorAtCosine(PROBE, seed, cosine),
    background: null,
  });
  await database.db
    .update(faceTemplates)
    .set({ createdAt: new Date(T0.getTime() + minutes * 60_000) })
    .where(eq(faceTemplates.id, templateId));
  return inquiry.id;
}

const tenant = async () => (await createTestTenant(database.db)).environment.id;
const near = (value: number) => expect.closeTo(value, 4) as number;

describe('scanFaceTemplates (C42.4)', () => {
  it('scores every template outside the excluded inquiries, reporting cosines at or above the floor', async () => {
    const environmentId = await tenant();
    const own = await template(environmentId, 0.99, 1, 10);
    const sameAccount = await template(environmentId, 0.98, 2, 11);
    await template(environmentId, 0.9, 3, 12);
    await template(environmentId, 0.2, 4, 13);
    await template(environmentId, 0.4, 5, 14);

    const scan = await scanFaceTemplates(database.db, environmentId, {
      embedding: PROBE,
      excludeInquiryIds: [own, sameAccount],
      maxTemplates: 50_000,
      floor: FLOOR,
    });

    expect(scan).toEqual({
      kind: 'searched',
      searched: 3,
      truncated: false,
      bestCosine: near(0.9),
      matchCosines: [near(0.4), near(0.9)],
    });
  });

  it('reads newest first in batches and stops at the cap, saying the search was truncated', async () => {
    const environmentId = await tenant();
    await template(environmentId, 0.95, 1, 20);
    await template(environmentId, 0.1, 2, 21);
    await template(environmentId, 0.5, 3, 22);
    await template(environmentId, 0.3, 4, 23);
    await template(environmentId, 0.6, 5, 24);

    const scan = await scanFaceTemplates(database.db, environmentId, {
      embedding: PROBE,
      excludeInquiryIds: [],
      maxTemplates: 3,
      floor: FLOOR,
      batchSize: 2,
    });

    // The oldest templates (0.95 and 0.1) are past the cap.
    expect(scan).toEqual({
      kind: 'searched',
      searched: 3,
      truncated: true,
      bestCosine: near(0.6),
      matchCosines: [near(0.6), near(0.5)],
    });
  });

  it('is not truncated when the cap covers the whole gallery', async () => {
    const environmentId = await tenant();
    await template(environmentId, 0.2, 1, 30);
    await template(environmentId, 0.3, 2, 31);

    const scan = await scanFaceTemplates(database.db, environmentId, {
      embedding: PROBE,
      excludeInquiryIds: [],
      maxTemplates: 2,
      floor: FLOOR,
      batchSize: 1,
    });

    expect(scan).toMatchObject({ searched: 2, truncated: false, matchCosines: [] });
  });

  it('searches an empty gallery completely', async () => {
    expect(
      await scanFaceTemplates(database.db, await tenant(), {
        embedding: PROBE,
        excludeInquiryIds: [],
        maxTemplates: 1000,
        floor: FLOOR,
      }),
    ).toEqual({
      kind: 'searched',
      searched: 0,
      truncated: false,
      bestCosine: null,
      matchCosines: [],
    });
  });
});

describe('bestTemplateCosine (C42.8)', () => {
  it('is the highest cosine, or null without templates', () => {
    expect(bestTemplateCosine(PROBE, [])).toBeNull();
    expect(
      bestTemplateCosine(PROBE, [vectorAtCosine(PROBE, 2, 0.3), vectorAtCosine(PROBE, 3, 0.7)]),
    ).toBeCloseTo(0.7, 6);
  });
});

describe('faceGroups (C42.8)', () => {
  it('puts faces that match at the threshold in one group, transitively', () => {
    const a = unitVector(40);
    const b = vectorAtCosine(a, 41, 0.6);
    const c = vectorAtCosine(b, 42, 0.6);
    const other = unitVector(43);

    expect(faceGroups([a, other, b, c], FLOOR)).toEqual([0, 1, 0, 0]);
  });

  it('gives every face its own group when none match', () => {
    expect(faceGroups([unitVector(50), unitVector(51), unitVector(52)], FLOOR)).toEqual([0, 1, 2]);
    expect(faceGroups([], FLOOR)).toEqual([]);
  });
});
