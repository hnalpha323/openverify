import { InvalidInquiryTransitionError } from '@openverify/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { InvalidCursorError } from '../errors.js';
import { inquiries as inquiriesTable } from '../schema.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import type { InquiryStatus } from '../tables/enums.js';
import {
  createInquiry,
  getInquiry,
  listInquiries,
  lockInquiry,
  transitionInquiryStatus,
} from './inquiries.js';
import { resolveInquiryAccount } from './accounts.js';
import { createInquiryTemplate } from './inquiry-templates.js';
import { redactInquiryRecords } from './redaction.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function tenantWithTemplate() {
  const tenant = await createTestTenant(database.db);
  const template = await createInquiryTemplate(database.db, tenant.environment.id, {
    id: testId('itmpl'),
    name: 'KYC',
    version: { id: testId('itmplv'), flow: {}, verificationConfig: {} },
  });
  const create = (input: { referenceId?: string | null; fields?: Record<string, unknown> } = {}) =>
    createInquiry(database.db, tenant.environment.id, {
      id: testId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.latestVersion.id,
      ...input,
    });
  return { ...tenant, template, create };
}

describe('inquiries', () => {
  it('creates an inquiry in status created with encrypted fields', async () => {
    const { environment, template, create } = await tenantWithTemplate();

    const inquiry = await create({
      referenceId: 'customer-42',
      fields: { 'name-first': 'Jane', birthdate: '1990-01-01' },
    });
    const raw = await database.db.execute<{ fields: string }>(
      sql`select fields from inquiries where id = ${inquiry.id}`,
    );

    expect(inquiry).toMatchObject({
      environmentId: environment.id,
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.latestVersion.id,
      status: 'created',
      referenceId: 'customer-42',
      fields: { 'name-first': 'Jane', birthdate: '1990-01-01' },
      startedAt: null,
      completedAt: null,
    });
    expect(raw.rows[0]?.fields).toMatch(/^ov1\./);
    expect(raw.rows[0]?.fields).not.toContain('Jane');
    expect(await getInquiry(database.db, environment.id, inquiry.id)).toEqual(inquiry);
  });

  it('defaults fields to an empty object and the reference to null', async () => {
    const { create } = await tenantWithTemplate();

    expect(await create()).toMatchObject({ fields: {}, referenceId: null });
  });

  it('returns null for an inquiry in another environment', async () => {
    const { create } = await tenantWithTemplate();
    const other = await createTestTenant(database.db);

    expect(await getInquiry(database.db, other.environment.id, (await create()).id)).toBeNull();
  });

  it('refuses a template version from another environment', async () => {
    const { template } = await tenantWithTemplate();
    const other = await createTestTenant(database.db);

    await expect(
      createInquiry(database.db, other.environment.id, {
        id: testId('inq'),
        inquiryTemplateId: template.id,
        inquiryTemplateVersionId: template.latestVersion.id,
      }),
    ).rejects.toThrow();
  });
});

describe('listInquiries', () => {
  it('pages newest first, then by id, across rows created in the same instant', async () => {
    const { environment, template } = await tenantWithTemplate();
    const at = new Date('2026-10-20T08:00:00.000Z');
    const ids = Array.from({ length: 5 }, () => testId('inq'));
    // Schema v2: direct inserts name the inquiry's account (C13).
    const accountId = (await resolveInquiryAccount(database.db, environment.id, {})) ?? '';
    // One timestamp for all rows: ordering must fall back to id desc without gaps.
    await database.db.insert(inquiriesTable).values(
      ids.map((id) => ({
        id,
        environmentId: environment.id,
        inquiryTemplateId: template.id,
        inquiryTemplateVersionId: template.latestVersion.id,
        accountId,
        fields: {},
        createdAt: at,
      })),
    );

    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = await listInquiries(database.db, environment.id, { size: 2, after });
      seen.push(...page.items.map((inquiry) => inquiry.id));
      after = page.next ?? undefined;
    } while (after !== undefined);

    expect(seen).toEqual([...ids].sort().reverse());
  });

  it('orders by created_at before id', async () => {
    const { environment, template } = await tenantWithTemplate();
    const older = 'inq_ZZZZZZZZZZZZZZZZZZZZZZZZZZ';
    const newer = 'inq_00000000000000000000000000';
    const accountId = (await resolveInquiryAccount(database.db, environment.id, {})) ?? '';
    await database.db.insert(inquiriesTable).values(
      [
        [older, '2026-01-01T00:00:00.000Z'],
        [newer, '2026-06-01T00:00:00.000Z'],
      ].map(([id, createdAt]) => ({
        id: id ?? '',
        environmentId: environment.id,
        inquiryTemplateId: template.id,
        inquiryTemplateVersionId: template.latestVersion.id,
        accountId,
        fields: {},
        createdAt: new Date(createdAt ?? ''),
      })),
    );

    const page = await listInquiries(database.db, environment.id);

    expect(page.items.map((inquiry) => inquiry.id)).toEqual([newer, older]);
  });

  it('filters by one or several statuses and by reference id', async () => {
    onTestFinished(wallClockStepsBack());
    const { environment, create } = await tenantWithTemplate();
    const clock = createdAtClock(database.db);
    const a = await create({ referenceId: 'ref-a' });
    await clock.at('inquiries', a.id);
    const b = await create({ referenceId: 'ref-a' });
    await clock.at('inquiries', b.id);
    const c = await create({ referenceId: 'ref-b' });
    await clock.at('inquiries', c.id);
    await transitionInquiryStatus(database.db, environment.id, b.id, {
      from: 'created',
      to: 'pending',
    });

    const ids = async (options: Parameters<typeof listInquiries>[2]) =>
      (await listInquiries(database.db, environment.id, options)).items.map(
        (inquiry) => inquiry.id,
      );

    expect(await ids({ status: 'pending' })).toEqual([b.id]);
    expect(await ids({ status: ['created', 'pending'] })).toEqual([c.id, b.id, a.id]);
    expect(await ids({ referenceId: 'ref-a' })).toEqual([b.id, a.id]);
    expect(await ids({ referenceId: 'ref-a', status: 'created' })).toEqual([a.id]);
    expect(await ids({ status: [] })).toEqual([]);
  });

  it('never lists another environment’s inquiries and rejects their ids as cursors', async () => {
    const { create } = await tenantWithTemplate();
    const foreign = await create();
    const other = await createTestTenant(database.db);

    expect((await listInquiries(database.db, other.environment.id)).items).toEqual([]);
    await expect(
      listInquiries(database.db, other.environment.id, { after: foreign.id }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });
});

describe('transitionInquiryStatus', () => {
  it.each([
    ['pending', 'startedAt'],
    ['expired', 'expiredAt'],
  ] as const)('moves created to %s and stamps %s', async (to, stamp) => {
    const { environment, create } = await tenantWithTemplate();
    const inquiry = await create();
    const at = new Date('2026-10-20T09:30:00.000Z');

    const updated = await transitionInquiryStatus(database.db, environment.id, inquiry.id, {
      from: 'created',
      to,
      at,
    });

    expect(updated).toMatchObject({ status: to, [stamp]: at });
  });

  it.each([
    ['completed', 'completedAt'],
    ['failed', 'failedAt'],
  ] as const)('moves pending to %s and stamps %s', async (to, stamp) => {
    const { environment, create } = await tenantWithTemplate();
    const inquiry = await create();
    await transitionInquiryStatus(database.db, environment.id, inquiry.id, {
      from: 'created',
      to: 'pending',
    });

    const updated = await transitionInquiryStatus(database.db, environment.id, inquiry.id, {
      from: 'pending',
      to,
    });

    expect(updated?.status).toBe(to);
    expect(updated?.[stamp]).toBeInstanceOf(Date);
  });

  it('stamps decisioned_at for approve and decline, and nothing for review', async () => {
    const { environment, create } = await tenantWithTemplate();
    const inquiry = await create();
    const steps = [
      ['created', 'pending'],
      ['pending', 'completed'],
      ['completed', 'needs_review'],
    ] as const;
    for (const [from, to] of steps) {
      await transitionInquiryStatus(database.db, environment.id, inquiry.id, { from, to });
    }
    const review = await getInquiry(database.db, environment.id, inquiry.id);

    const approved = await transitionInquiryStatus(database.db, environment.id, inquiry.id, {
      from: 'needs_review',
      to: 'approved',
    });

    expect(review?.decisionedAt).toBeNull();
    expect(approved?.decisionedAt).toBeInstanceOf(Date);
  });

  it('returns null when the inquiry is no longer in the expected status', async () => {
    const { environment, create } = await tenantWithTemplate();
    const inquiry = await create();
    await transitionInquiryStatus(database.db, environment.id, inquiry.id, {
      from: 'created',
      to: 'pending',
    });

    const stale = await transitionInquiryStatus(database.db, environment.id, inquiry.id, {
      from: 'created',
      to: 'pending',
    });

    expect(stale).toBeNull();
    expect((await getInquiry(database.db, environment.id, inquiry.id))?.status).toBe('pending');
  });

  it('returns null for an inquiry in another environment', async () => {
    const { create } = await tenantWithTemplate();
    const inquiry = await create();
    const other = await createTestTenant(database.db);

    expect(
      await transitionInquiryStatus(database.db, other.environment.id, inquiry.id, {
        from: 'created',
        to: 'pending',
      }),
    ).toBeNull();
  });

  it('rejects a transition the state machine forbids, before touching the database', async () => {
    const { environment, create } = await tenantWithTemplate();
    const inquiry = await create();

    await expect(
      transitionInquiryStatus(database.db, environment.id, inquiry.id, {
        from: 'created',
        to: 'completed',
      }),
    ).rejects.toBeInstanceOf(InvalidInquiryTransitionError);
    expect((await getInquiry(database.db, environment.id, inquiry.id))?.status).toBe('created');
  });
});

/**
 * Owner decision 5 after Workflow 6C: redaction ends an open inquiry's processing, but not its
 * expiry. A move to `pending`, `completed` or `failed` is refused once `redacted_at` is set; a move
 * to `expired`, and every move out of `completed`, `failed` and `needs_review`, still applies.
 */
describe('transitionInquiryStatus on a redacted inquiry (owner decision 5 after Workflow 6C)', () => {
  /** The moves from `created` to each status, as the state machine allows them. */
  const PATHS: Record<'created' | 'pending' | 'completed' | 'failed' | 'needs_review', string[]> = {
    created: [],
    pending: ['pending'],
    completed: ['pending', 'completed'],
    failed: ['pending', 'failed'],
    needs_review: ['pending', 'completed', 'needs_review'],
  };

  /** An inquiry moved to `status`, then redacted. */
  async function redactedIn(status: keyof typeof PATHS) {
    const { environment, create } = await tenantWithTemplate();
    const inquiry = await create({ fields: { 'name-first': 'Avery' } });
    let from: InquiryStatus = 'created';
    for (const to of PATHS[status] as InquiryStatus[]) {
      await transitionInquiryStatus(database.db, environment.id, inquiry.id, { from, to });
      from = to;
    }
    const at = new Date('2026-10-29T09:00:00.000Z');
    await redactInquiryRecords(database.db, environment.id, inquiry.id, { at });
    return { environmentId: environment.id, id: inquiry.id, at };
  }

  it.each([
    ['created', 'pending', 'startedAt'],
    ['pending', 'completed', 'completedAt'],
    ['pending', 'failed', 'failedAt'],
  ] as const)(
    'refuses %s -> %s once redacted: null, and the row keeps its status',
    async (from, to, stamp) => {
      const { environmentId, id, at } = await redactedIn(from);

      const moved = await transitionInquiryStatus(database.db, environmentId, id, { from, to });

      expect(moved).toBeNull();
      const row = await getInquiry(database.db, environmentId, id);
      expect(row).toMatchObject({ status: from, redactedAt: at });
      expect(row?.[stamp]).toBeNull();
    },
  );

  it.each(['created', 'pending'] as const)(
    'still expires a redacted %s inquiry, and stamps expired_at',
    async (from) => {
      const { environmentId, id, at } = await redactedIn(from);
      const expiredAt = new Date('2026-10-30T09:00:00.000Z');

      const moved = await transitionInquiryStatus(database.db, environmentId, id, {
        from,
        to: 'expired',
        at: expiredAt,
      });

      expect(moved).toMatchObject({ status: 'expired', expiredAt, redactedAt: at });
    },
  );

  it.each([
    ['completed', 'approved'],
    ['completed', 'declined'],
    ['completed', 'needs_review'],
    ['failed', 'approved'],
    ['failed', 'declined'],
    ['failed', 'needs_review'],
    ['needs_review', 'approved'],
    ['needs_review', 'declined'],
  ] as const)('still moves a redacted %s inquiry to %s', async (from, to) => {
    const { environmentId, id, at } = await redactedIn(from);

    const moved = await transitionInquiryStatus(database.db, environmentId, id, { from, to });

    expect(moved).toMatchObject({ status: to, redactedAt: at });
  });
});

describe('lockInquiry', () => {
  it('locks the inquiry for the transaction and returns its status, only in its environment', async () => {
    const { create } = await tenantWithTemplate();
    const inquiry = await create();
    const other = await createTestTenant(database.db);

    const statuses = await database.db.transaction(async (tx) => [
      await lockInquiry(tx, inquiry.environmentId, inquiry.id),
      await lockInquiry(tx, other.environment.id, inquiry.id),
    ]);

    expect(statuses).toEqual(['created', null]);
  });
});
