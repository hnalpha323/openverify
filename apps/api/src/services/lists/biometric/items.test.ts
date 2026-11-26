/**
 * C97.4, C99.7 (Workflow 7B): adding a face or background item from a consenting inquiry, on PGlite.
 * The selfie is random bytes behind a JPEG signature, and no vision call happens here.
 */
import {
  getBiometricItem,
  inquiries,
  lists,
  listItems,
  verifications,
  type Db,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedList,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { LIST_LIMITS } from '@openverify/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../../auth/pii.js';
import { createMemoryStorage } from '../../../jobs/testing.js';
import type { ListItemEmbedJob } from '../../../ports.js';
import { createRecordingAuditLogger } from '../../../test-support/fakes.js';
import { biometricListsGate } from './index.js';
import { createBiometricListItem, type BiometricItemDeps } from './items.js';
import { latestSelfieOf, selfieConsentHolds } from './source-selfie.js';
import { acknowledge, consentingSession, seedSelfieSource } from './testing.js';

let database: TestDatabase;
let db: Db;
let keyring: Keyring;
const storage = createMemoryStorage();
const audit = createRecordingAuditLogger();
const enqueued: ListItemEmbedJob[] = [];
let deps: BiometricItemDeps;

beforeAll(async () => {
  database = await createTestDatabase();
  ({ db, keyring } = database);
  deps = {
    db,
    audit,
    biometricListsGate,
    listItemEmbeds: {
      enqueueListItemEmbed: (job) => {
        enqueued.push(job);
        return Promise.resolve();
      },
    },
  };
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  enqueued.length = 0;
});

const seeded = (options: Parameters<typeof seedSelfieSource>[1] = {}) =>
  seedSelfieSource({ db, keyring, storage }, options);

function actingIn(environmentId: string) {
  return {
    ctx: { environmentId, organizationId: testId('org') },
    actor: { type: 'api-key', id: testId('key') },
    mask: UNMASKED,
  } as Parameters<typeof createBiometricListItem>[1];
}

async function adding(
  source: { environmentId: string; inquiryId: string },
  kind: 'face' | 'selfie-background' = 'face',
  listId?: string,
) {
  const list = listId ?? (await seedList(db, source.environmentId, { kind })).id;
  return createBiometricListItem(deps, actingIn(source.environmentId), kind, {
    'list-id': list,
    'inquiry-id': source.inquiryId,
  });
}

async function acknowledged(options: Parameters<typeof seedSelfieSource>[1] = {}) {
  const source = await seeded(options);
  await acknowledge(db, source.environmentId);
  return source;
}

describe('adding an item (C99.7)', () => {
  it('creates it pending, names its source, and enqueues the embedding', async () => {
    const source = await acknowledged();
    const document = await adding(source);
    expect(document.data).toMatchObject({
      type: 'list-item/face',
      attributes: {
        status: 'pending',
        model: null,
        'source-inquiry-id': source.inquiryId,
        'match-count': 0,
      },
    });
    expect(enqueued).toEqual([
      { environmentId: source.environmentId, itemId: document.data.id },
    ]);
  });

  it('adds a background item the same way', async () => {
    const source = await acknowledged();
    const document = await adding(source, 'selfie-background');
    expect(document.data).toMatchObject({
      type: 'list-item/selfie-background',
      attributes: { status: 'pending', 'source-inquiry-id': source.inquiryId },
    });
    expect(enqueued).toHaveLength(1);
  });

  it('records who added it, and an audit entry of ids alone', async () => {
    const source = await acknowledged();
    const acting = actingIn(source.environmentId);
    const { id: listId } = await seedList(db, source.environmentId, { kind: 'face' });
    const document = await createBiometricListItem(deps, acting, 'face', {
      'list-id': listId,
      'inquiry-id': source.inquiryId,
    });
    expect(document.data.relationships.creator.data).toEqual({
      type: 'api-key',
      id: acting.actor.id,
    });
    expect(audit.entries.at(-1)).toMatchObject({
      action: 'list-item.created',
      resourceId: document.data.id,
      metadata: { 'list-id': listId, kind: 'face', 'source-inquiry-id': source.inquiryId },
    });
  });

  it('answers the item even when the queue is down: the sweep recovers it', async () => {
    const source = await acknowledged();
    const { id: listId } = await seedList(db, source.environmentId, { kind: 'face' });
    const document = await createBiometricListItem(
      {
        ...deps,
        listItemEmbeds: {
          enqueueListItemEmbed: () => Promise.reject(new Error('the queue is down')),
        },
      },
      actingIn(source.environmentId),
      'face',
      { 'list-id': listId, 'inquiry-id': source.inquiryId },
    );
    expect(document.data.attributes.status).toBe('pending');
  });
});

describe('the refusals', () => {
  it('needs the acknowledgement, 409, writing nothing (C97.4)', async () => {
    const source = await seeded();
    const { id: listId } = await seedList(db, source.environmentId, { kind: 'face' });
    await expect(
      createBiometricListItem(deps, actingIn(source.environmentId), 'face', {
        'list-id': listId,
        'inquiry-id': source.inquiryId,
      }),
    ).rejects.toMatchObject({ code: 'biometric_lists_not_acknowledged', status: 409 });
    expect(enqueued).toEqual([]);
    const rows = await db.select().from(listItems).where(eq(listItems.listId, listId));
    expect(rows).toEqual([]);
  });

  it('needs the source inquiry to have ticked biometric matching, 422', async () => {
    const source = await acknowledged({ consent: [] });
    await expect(adding(source)).rejects.toMatchObject({
      code: 'consent_not_given',
      status: 422,
    });
    expect(enqueued).toEqual([]);
  });

  it('needs any consent at all, 422', async () => {
    const source = await acknowledged({ consent: null });
    await expect(adding(source)).rejects.toMatchObject({ code: 'consent_not_given' });
  });

  it('never takes a redacted inquiry as a source', async () => {
    const source = await acknowledged();
    await db.execute(
      sql`update inquiries set redacted_at = now() where id = ${source.inquiryId}`,
    );
    await expect(adding(source)).rejects.toMatchObject({ code: 'consent_not_given' });
  });

  it('answers 404 for an inquiry of another environment', async () => {
    const source = await acknowledged();
    const stranger = await acknowledged();
    await expect(
      adding({ environmentId: stranger.environmentId, inquiryId: source.inquiryId }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('answers 404 for a list of another environment', async () => {
    const source = await acknowledged();
    const stranger = await seedList(
      db,
      (await createTestTenant(db)).environment.id,
      { kind: 'face' },
    );
    await expect(adding(source, 'face', stranger.id)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a list of the other biometric kind, 422', async () => {
    const source = await acknowledged();
    const { id } = await seedList(db, source.environmentId, { kind: 'selfie-background' });
    await expect(adding(source, 'face', id)).rejects.toMatchObject({
      code: 'list_kind_mismatch',
    });
  });

  it('refuses an archived list, 409', async () => {
    const source = await acknowledged();
    const { id } = await seedList(db, source.environmentId, { kind: 'face', status: 'archived' });
    await expect(adding(source, 'face', id)).rejects.toMatchObject({
      code: 'list_archived',
      status: 409,
    });
  });

  it('holds a list to its cap of 10,000 items, 409 (C97.5)', async () => {
    const source = await acknowledged();
    const { id } = await seedList(db, source.environmentId, { kind: 'face' });
    await db
      .update(lists)
      .set({ itemCount: LIST_LIMITS.itemsPerBiometricList })
      .where(eq(lists.id, id));
    await expect(adding(source, 'face', id)).rejects.toMatchObject({
      code: 'list_limit_reached',
      status: 409,
    });
  });

  it('adds a source once per list, 409, and again once its item is archived', async () => {
    const source = await acknowledged();
    const { id } = await seedList(db, source.environmentId, { kind: 'face' });
    const first = await adding(source, 'face', id);
    await expect(adding(source, 'face', id)).rejects.toMatchObject({
      code: 'list_item_exists',
      status: 409,
    });
    await db
      .update(listItems)
      .set({ status: 'archived', archivedAt: new Date() })
      .where(eq(listItems.id, first.data.id));
    await expect(adding(source, 'face', id)).resolves.toBeDefined();
  });
});

describe('the source selfie (C99.5)', () => {
  it('is the latest decided selfie, with its centre file and its session', async () => {
    const source = await seeded();
    const selfie = await latestSelfieOf(db, source.environmentId, source.inquiryId);
    expect(selfie).toMatchObject({
      verificationId: source.verificationId,
      sessionId: source.sessionId,
    });
    expect(selfie?.center?.kind).toBe('selfie-center');
  });

  it.each(['passed', 'failed', 'needs_review'] as const)('reads a %s selfie', async (status) => {
    const source = await seeded({ status });
    expect(await latestSelfieOf(db, source.environmentId, source.inquiryId)).not.toBeNull();
  });

  it('reads no selfie still to be retried', async () => {
    const source = await seeded({ status: 'requires_retry' });
    expect(await latestSelfieOf(db, source.environmentId, source.inquiryId)).toBeNull();
  });

  it('leaves out a selfie of a rejected handoff (C96.3)', async () => {
    const source = await seeded({ fromRejectedHandoff: true });
    expect(await latestSelfieOf(db, source.environmentId, source.inquiryId)).toBeNull();
  });

  it('answers null for an inquiry with no selfie', async () => {
    const source = await seeded();
    await db.delete(verifications).where(eq(verifications.id, source.verificationId));
    expect(await latestSelfieOf(db, source.environmentId, source.inquiryId)).toBeNull();
  });

  it('asks the consent of the session that captured the selfie (C94.6, V03)', async () => {
    const source = await seeded({ consent: [] });
    await consentingSession(db, source.environmentId, source.inquiryId);
    const inquiry = {
      id: source.inquiryId,
      environmentId: source.environmentId,
      inquiryTemplateVersionId: await versionOf(source.inquiryId),
    };
    const selfie = await latestSelfieOf(db, source.environmentId, source.inquiryId);
    // A later session ticked the box; a session outside a handoff answers the inquiry's latest.
    expect(await selfieConsentHolds(db, inquiry, selfie)).toBe(true);
    // A handoff session answers for itself: its own refusal stands whatever the desktop ticked.
    await markHandoff(source.sessionId ?? '', await consentingSession(
      db,
      source.environmentId,
      source.inquiryId,
    ));
    expect(await selfieConsentHolds(db, inquiry, selfie)).toBe(false);
  });

  it('never counts a consent the template does not list', async () => {
    const source = await seeded();
    await db.execute(sql`
      update inquiry_template_versions set flow = jsonb_set(flow, '{steps}', '[]'::jsonb)
      where id = ${await versionOf(source.inquiryId)}`);
    const inquiry = {
      id: source.inquiryId,
      environmentId: source.environmentId,
      inquiryTemplateVersionId: await versionOf(source.inquiryId),
    };
    expect(
      await selfieConsentHolds(
        db,
        inquiry,
        await latestSelfieOf(db, source.environmentId, source.inquiryId),
      ),
    ).toBe(false);
  });
});

async function versionOf(inquiryId: string): Promise<string> {
  const [row] = await db
    .select({ id: inquiries.inquiryTemplateVersionId })
    .from(inquiries)
    .where(eq(inquiries.id, inquiryId));
  return row?.id ?? '';
}

async function markHandoff(sessionId: string, fromSessionId: string): Promise<void> {
  await db.execute(sql`
    update inquiry_sessions set device_handoff_method = 'qr',
      handoff_from_session_id = ${fromSessionId}, handoff_redeemed_at = now()
    where id = ${sessionId}`);
}

describe('getBiometricItem after adding', () => {
  it('holds no template until the job fills it', async () => {
    const source = await acknowledged();
    const document = await adding(source);
    expect(await getBiometricItem(db, source.environmentId, document.data.id)).toMatchObject({
      status: 'pending',
      model: null,
    });
  });
});
