/**
 * C42 worker repository (Workflow 4A Stage 3, `api-worker`) on PGlite with pgvector: the face data
 * write, the account lookups, the nearest backgrounds, retention and the rebuild helpers. Row
 * locks against concurrent writers are tested on Postgres in the api's race tests. Every
 * embedding and layout here is a seeded synthetic vector.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgErrorCode } from '../errors.js';
import { faceTemplates, inquiries, selfieBackgrounds } from '../schema.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import { createAccount } from './accounts.js';
import {
  deleteExpiredFaceData,
  deleteFaceTemplate,
  findNearestSelfieBackgrounds,
  listAccountFaceTemplates,
  listFaceTemplateRefs,
  listInquiryIdsOfAccount,
  lockFaceTemplate,
  rewriteFaceTemplate,
  rewriteSelfieBackground,
  writeFaceData,
} from './face-templates.js';
import { updateEnvironmentSettings } from './organizations.js';
import { openFaceTemplate } from './selfie-captures.js';
import { createVerification } from './verifications.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const NOW = new Date('2026-10-21T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

/** A deterministic 128-dimension unit vector: a synthetic embedding. */
function unitVector(seed: number, length = 128): number[] {
  let state = seed >>> 0;
  const values = Array.from({ length }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32 - 0.5;
  });
  const norm = Math.hypot(...values);
  return values.map((value) => value / norm);
}

/** A synthetic 144-value layout: every cell `value` (Lab units). */
const layout = (value: number) => Array.from({ length: 144 }, () => value);
const ALL_VALID = '1'.repeat(48);

async function tenant() {
  return (await createTestTenant(database.db)).environment.id;
}

/** An inquiry of `accountId` (a new account when omitted) with one selfie verification. */
async function selfieOf(environmentId: string, accountId?: string) {
  const { inquiry } = await createTestInquiry(database.db, environmentId);
  if (accountId !== undefined) {
    await database.db.update(inquiries).set({ accountId }).where(eq(inquiries.id, inquiry.id));
  }
  const verification = await createVerification(database.db, environmentId, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  return {
    inquiryId: inquiry.id,
    accountId: accountId ?? inquiry.accountId,
    verificationId: verification.id,
  };
}

async function newAccount(environmentId: string): Promise<string> {
  const account = await createAccount(database.db, environmentId, { id: testId('acc') });
  return account.id;
}

async function stored(environmentId: string, seed: number, accountId?: string, cell = 50) {
  const selfie = await selfieOf(environmentId, accountId);
  const ids = await writeFaceData(database.db, environmentId, {
    verificationId: selfie.verificationId,
    inquiryId: selfie.inquiryId,
    model: 'sface-2021dec',
    embedding: unitVector(seed),
    background: { layout: layout(cell), validCells: ALL_VALID, coverage: 0.6 },
  });
  return { ...selfie, ...ids };
}

async function backdate(templateId: string, at: Date) {
  await database.db
    .update(faceTemplates)
    .set({ createdAt: at })
    .where(eq(faceTemplates.id, templateId));
  await database.db
    .update(selfieBackgrounds)
    .set({ createdAt: at })
    .where(eq(selfieBackgrounds.faceTemplateId, templateId));
}

async function templateRow(id: string) {
  const [row] = await database.db.select().from(faceTemplates).where(eq(faceTemplates.id, id));
  return row;
}

async function backgroundRows(templateId: string) {
  return database.db
    .select()
    .from(selfieBackgrounds)
    .where(eq(selfieBackgrounds.faceTemplateId, templateId));
}

describe('writeFaceData (C42.2)', () => {
  it('seals the template to its row and writes the background row beside it', async () => {
    const environmentId = await tenant();
    const selfie = await selfieOf(environmentId);
    const embedding = unitVector(1);

    const ids = await writeFaceData(database.db, environmentId, {
      verificationId: selfie.verificationId,
      inquiryId: selfie.inquiryId,
      model: 'sface-2021dec',
      embedding,
      background: { layout: layout(40), validCells: ALL_VALID, coverage: 0.75 },
    });

    expect(ids.templateId).toMatch(/^ftpl_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ids.backgroundId).toMatch(/^sbg_[0-9A-HJKMNP-TV-Z]{26}$/);
    const row = await templateRow(ids.templateId);
    expect(row).toMatchObject({
      environmentId,
      verificationId: selfie.verificationId,
      inquiryId: selfie.inquiryId,
      source: 'selfie',
      model: 'sface-2021dec',
    });
    // Sealed: the stored value is not the embedding's encoding, and opens to it.
    expect(JSON.stringify(row)).not.toContain(String(embedding[0]));
    const opened = row === undefined ? null : openFaceTemplate(row);
    opened?.embedding.forEach((value, index) => {
      expect(value).toBeCloseTo(embedding[index] ?? 0, 6);
    });
    expect(await backgroundRows(ids.templateId)).toEqual([
      expect.objectContaining({
        id: ids.backgroundId,
        verificationId: selfie.verificationId,
        inquiryId: selfie.inquiryId,
        layout: layout(40),
        validCells: ALL_VALID,
        coverage: 0.75,
      }),
    ]);
  });

  it('writes no background row without a layout', async () => {
    const environmentId = await tenant();
    const selfie = await selfieOf(environmentId);

    const ids = await writeFaceData(database.db, environmentId, {
      verificationId: selfie.verificationId,
      inquiryId: selfie.inquiryId,
      model: 'sface-2021dec',
      embedding: unitVector(2),
      background: null,
    });

    expect(ids.backgroundId).toBeNull();
    expect(await templateRow(ids.templateId)).toBeDefined();
    expect(await backgroundRows(ids.templateId)).toEqual([]);
  });
});

describe('the account lookups (C42.4, C42.8)', () => {
  it('lists every inquiry of the account, following an inquiry moved to another account', async () => {
    const environmentId = await tenant();
    const account = await newAccount(environmentId);
    const other = await newAccount(environmentId);
    const first = await selfieOf(environmentId, account);
    const second = await selfieOf(environmentId, account);
    const elsewhere = await selfieOf(environmentId, other);

    expect((await listInquiryIdsOfAccount(database.db, environmentId, account)).sort()).toEqual(
      [first.inquiryId, second.inquiryId].sort(),
    );

    // A consolidation moves the inquiry: the lookup reads inquiries.account_id when asked.
    await database.db
      .update(inquiries)
      .set({ accountId: account })
      .where(eq(inquiries.id, elsewhere.inquiryId));
    expect(await listInquiryIdsOfAccount(database.db, environmentId, account)).toHaveLength(3);
    expect(await listInquiryIdsOfAccount(database.db, environmentId, other)).toEqual([]);
  });

  it('lists the decrypted templates of the account, without the current inquiry, other accounts or environments', async () => {
    const environmentId = await tenant();
    const elsewhere = await tenant();
    const account = await newAccount(environmentId);
    const earlier = await stored(environmentId, 10, account);
    const current = await stored(environmentId, 11, account);
    await stored(environmentId, 12);
    await stored(elsewhere, 13);

    const templates = await listAccountFaceTemplates(database.db, environmentId, {
      accountId: account,
      excludeInquiryId: current.inquiryId,
    });

    expect(templates.map((template) => template.inquiryId)).toEqual([earlier.inquiryId]);
    templates[0]?.embedding.forEach((value, index) => {
      expect(value).toBeCloseTo(unitVector(10)[index] ?? 0, 6);
    });
  });
});

describe('findNearestSelfieBackgrounds (C42.8)', () => {
  it('returns the nearest rows of other accounts in the window, nearest first, with their templates', async () => {
    const environmentId = await tenant();
    const account = await newAccount(environmentId);
    const near = await stored(environmentId, 20, undefined, 51);
    const nearer = await stored(environmentId, 21, undefined, 50.5);
    const far = await stored(environmentId, 22, undefined, 90);
    const sameAccount = await stored(environmentId, 23, account, 50);
    const old = await stored(environmentId, 24, undefined, 50);
    await backdate(old.templateId, daysAgo(40));
    await stored(await tenant(), 25, undefined, 50);

    const found = await findNearestSelfieBackgrounds(database.db, environmentId, {
      layout: layout(50),
      since: daysAgo(30),
      excludeAccountId: account,
      limit: 2,
    });

    expect(found.map((row) => row.faceTemplateId)).toEqual([nearer.templateId, near.templateId]);
    expect(found[0]).toMatchObject({
      verificationId: nearer.verificationId,
      inquiryId: nearer.inquiryId,
      distance: expect.closeTo(Math.sqrt(144 * 0.25), 3) as number,
    });
    found[0]?.template?.embedding.forEach((value, index) => {
      expect(value).toBeCloseTo(unitVector(21)[index] ?? 0, 6);
    });
    const all = await findNearestSelfieBackgrounds(database.db, environmentId, {
      layout: layout(50),
      since: daysAgo(30),
      excludeAccountId: account,
      limit: 10,
    });
    expect(all.map((row) => row.faceTemplateId)).toEqual([
      nearer.templateId,
      near.templateId,
      far.templateId,
    ]);
    expect(all.map((row) => row.inquiryId)).not.toContain(sameAccount.inquiryId);
  });

  it('gives a candidate whose template cannot be opened no template', async () => {
    const environmentId = await tenant();
    const account = await newAccount(environmentId);
    const broken = await stored(environmentId, 30);
    // Another row's sealed value: its row AAD does not match, so it cannot be opened here.
    const donor = await stored(environmentId, 31, undefined, 99);
    await database.db.execute(
      sql`update face_templates set template = (select template from face_templates where id = ${donor.templateId}) where id = ${broken.templateId}`,
    );

    const [first] = await findNearestSelfieBackgrounds(database.db, environmentId, {
      layout: layout(50),
      since: daysAgo(30),
      excludeAccountId: account,
      limit: 1,
    });

    expect(first).toMatchObject({ faceTemplateId: broken.templateId, template: null });
  });
});

describe('deleteExpiredFaceData (C42.6)', () => {
  it("deletes templates and backgrounds older than the environment's retention, 365 days by default", async () => {
    const defaults = await tenant();
    const strict = await tenant();
    await updateEnvironmentSettings(database.db, strict, { 'face-template-retention-days': 30 });
    const expired = await stored(defaults, 40);
    const kept = await stored(defaults, 41);
    const strictExpired = await stored(strict, 42);
    const strictKept = await stored(strict, 43);
    await backdate(expired.templateId, daysAgo(366));
    await backdate(kept.templateId, daysAgo(364));
    await backdate(strictExpired.templateId, daysAgo(31));
    await backdate(strictKept.templateId, daysAgo(29));

    const deleted = await deleteExpiredFaceData(database.db, { now: NOW, limit: 500 });

    expect(deleted.templates).toBeGreaterThanOrEqual(2);
    expect(deleted.backgrounds).toBe(deleted.templates);
    expect(await templateRow(expired.templateId)).toBeUndefined();
    expect(await templateRow(strictExpired.templateId)).toBeUndefined();
    expect(await backgroundRows(expired.templateId)).toEqual([]);
    expect(await templateRow(kept.templateId)).toBeDefined();
    expect(await templateRow(strictKept.templateId)).toBeDefined();
    expect(await backgroundRows(kept.templateId)).toHaveLength(1);
    expect(await deleteExpiredFaceData(database.db, { now: NOW })).toEqual({
      templates: 0,
      backgrounds: 0,
    });
  });

  it('works in batches of `limit` templates', async () => {
    const environmentId = await tenant();
    for (const seed of [50, 51, 52]) {
      await backdate((await stored(environmentId, seed)).templateId, daysAgo(400));
    }

    const first = await deleteExpiredFaceData(database.db, { now: NOW, limit: 2 });
    const second = await deleteExpiredFaceData(database.db, { now: NOW, limit: 2 });

    expect(first.templates).toBe(2);
    expect(second.templates).toBeLessThanOrEqual(2);
    expect(
      await database.db
        .select({ count: sql<number>`count(*)::int` })
        .from(faceTemplates)
        .where(eq(faceTemplates.environmentId, environmentId)),
    ).toEqual([{ count: 0 }]);
  });
});

describe('the rebuild helpers (C42.7)', () => {
  it('pages every environment template row by id, ids only', async () => {
    const one = await stored(await tenant(), 60);
    const two = await stored(await tenant(), 61);

    const refs: string[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await listFaceTemplateRefs(database.db, { after, limit: 1 });
      if (page.length === 0) {
        break;
      }
      expect(page[0]).not.toHaveProperty('templateSealed');
      expect(page[0]).not.toHaveProperty('embedding');
      refs.push(...page.map((ref) => ref.id));
      after = page.at(-1)?.id;
    }

    expect(refs).toContain(one.templateId);
    expect(refs).toContain(two.templateId);
    expect(refs).toEqual([...refs].sort());
  });

  it('locks a template of its environment, saying whether it has a background row', async () => {
    const environmentId = await tenant();
    const withBackground = await stored(environmentId, 70);
    const selfie = await selfieOf(environmentId);
    const without = await writeFaceData(database.db, environmentId, {
      ...selfie,
      model: 'sface-2021dec',
      embedding: unitVector(71),
      background: null,
    });

    expect(await lockFaceTemplate(database.db, environmentId, withBackground.templateId)).toEqual({
      id: withBackground.templateId,
      inquiryId: withBackground.inquiryId,
      hasBackground: true,
    });
    expect(await lockFaceTemplate(database.db, environmentId, without.templateId)).toMatchObject({
      hasBackground: false,
    });
    expect(await lockFaceTemplate(database.db, await tenant(), without.templateId)).toBeNull();
  });

  it('rewrites a template and its background in place, keeping created_at and inserting nothing', async () => {
    const environmentId = await tenant();
    const row = await stored(environmentId, 80);
    await backdate(row.templateId, daysAgo(10));

    expect(
      await rewriteFaceTemplate(database.db, environmentId, {
        id: row.templateId,
        model: 'sface-2099',
        embedding: unitVector(81),
      }),
    ).toBe(true);
    expect(
      await rewriteSelfieBackground(database.db, environmentId, {
        faceTemplateId: row.templateId,
        layout: layout(12),
        validCells: '0'.repeat(48),
        coverage: 0,
      }),
    ).toBe(true);

    const template = await templateRow(row.templateId);
    expect(template).toMatchObject({ model: 'sface-2099', createdAt: daysAgo(10) });
    const opened = template === undefined ? null : openFaceTemplate(template);
    expect(opened?.embedding[0]).toBeCloseTo(unitVector(81)[0] ?? 0, 6);
    expect(await backgroundRows(row.templateId)).toEqual([
      expect.objectContaining({ layout: layout(12), coverage: 0, createdAt: daysAgo(10) }),
    ]);
  });

  it('rewrites nothing that does not exist', async () => {
    const environmentId = await tenant();
    const selfie = await selfieOf(environmentId);
    const without = await writeFaceData(database.db, environmentId, {
      ...selfie,
      model: 'sface-2021dec',
      embedding: unitVector(90),
      background: null,
    });

    expect(
      await rewriteSelfieBackground(database.db, environmentId, {
        faceTemplateId: without.templateId,
        layout: layout(1),
        validCells: ALL_VALID,
        coverage: 1,
      }),
    ).toBe(false);
    expect(await backgroundRows(without.templateId)).toEqual([]);
    expect(
      await rewriteFaceTemplate(database.db, environmentId, {
        id: testId('ftpl'),
        model: 'sface-2021dec',
        embedding: unitVector(91),
      }),
    ).toBe(false);
  });

  it('deletes a template with its background row', async () => {
    const environmentId = await tenant();
    const row = await stored(environmentId, 95);

    expect(await deleteFaceTemplate(database.db, environmentId, row.templateId)).toBe(true);
    expect(await templateRow(row.templateId)).toBeUndefined();
    expect(await backgroundRows(row.templateId)).toEqual([]);
    expect(await deleteFaceTemplate(database.db, environmentId, row.templateId)).toBe(false);
  });
});

/**
 * Every string an error carries: its message and stack, its own properties (Drizzle's `query` and
 * `params`) and its causes, recursively, so a test can tell that no layout value is among them.
 */
function everyTextOf(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string' || typeof value === 'number') {
    return [String(value)];
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return [];
  }
  seen.add(value);
  return Object.getOwnPropertyNames(value).flatMap((key) =>
    everyTextOf((value as Record<string, unknown>)[key], seen),
  );
}

describe('a failed layout query (Workflow 4B review H001)', () => {
  /** A synthetic 143-value layout: one value short, so pgvector refuses it (SQLSTATE 22000). */
  const short = Array.from({ length: 143 }, () => 37.123);

  async function refusal(run: () => Promise<unknown>): Promise<Error> {
    const error: unknown = await run().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  /** The error names the operation and its SQLSTATE only: no query parameter, no layout. */
  function expectNoLayout(error: Error, operation: string) {
    expect(everyTextOf(error).filter((text) => text.includes('37.123'))).toEqual([]);
    expect(error.name).toBe('SensitiveQueryError');
    expect(error.message).toBe(`${operation} failed (SQLSTATE 22000)`);
    expect(pgErrorCode(error)).toBe('22000');
  }

  it('findNearestSelfieBackgrounds: never in the error', async () => {
    const environmentId = await tenant();
    // A stored row, so the query measures a distance against the short probe.
    await stored(environmentId, 102);
    const error = await refusal(() =>
      findNearestSelfieBackgrounds(database.db, environmentId, {
        layout: short,
        since: daysAgo(30),
        excludeAccountId: testId('acc'),
        limit: 5,
      }),
    );
    expectNoLayout(error, 'findNearestSelfieBackgrounds');
  });

  it('writeFaceData (createSelfieBackground): never in the error', async () => {
    const environmentId = await tenant();
    const selfie = await selfieOf(environmentId);
    const error = await refusal(() =>
      writeFaceData(database.db, environmentId, {
        verificationId: selfie.verificationId,
        inquiryId: selfie.inquiryId,
        model: 'sface-2021dec',
        embedding: unitVector(100),
        background: { layout: short, validCells: ALL_VALID, coverage: 0.6 },
      }),
    );
    expectNoLayout(error, 'createSelfieBackground');
  });

  it('rewriteSelfieBackground: never in the error', async () => {
    const environmentId = await tenant();
    const row = await stored(environmentId, 101);
    const error = await refusal(() =>
      rewriteSelfieBackground(database.db, environmentId, {
        faceTemplateId: row.templateId,
        layout: short,
        validCells: ALL_VALID,
        coverage: 0.6,
      }),
    );
    expectNoLayout(error, 'rewriteSelfieBackground');
  });
});
