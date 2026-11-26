/**
 * C121.5 (P09, V05, V08; decision 45): the `publisher-rights` sweep over real workflows, users and
 * roles: a test per case of what a publisher's standing does to a running workflow, and how a holder
 * of the rights ends it. Every value is synthetic.
 */
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  auditLogs,
  createRole,
  createUser,
  getWorkflow,
  getWorkflowVersion,
  recordWorkflowWaitIndex,
  setUserRoles,
  updateUser,
  workflowWaitIndex,
} from '@openverify/db';
import { createdAtClock, testId } from '@openverify/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import { action, chain, decline, INQUIRY } from '../../workflows/publish/testing.js';
import type { WorkflowServices } from '../../workflows/services.js';
import type { WorkflowWorkerDeps } from '../../workflows/worker.js';
import { runPublisherRightsSweep } from './publisher-rights.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const sweep = () =>
  runPublisherRightsSweep({
    db: api.database.db,
    clock: api.clock,
    services: api.deps as unknown as WorkflowServices,
  } as unknown as WorkflowWorkerDeps);

const call = (method: 'POST' | 'PUT', url: string, token: string, payload?: unknown) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

interface Publisher {
  id: string;
  token: string;
  roleWith: (permissions: readonly Permission[]) => Promise<void>;
}

async function publisher(permissions: readonly Permission[] = PERMISSIONS): Promise<Publisher> {
  const id = testId('usr');
  const { db } = api.database;
  await createUser(db, {
    id,
    organizationId: api.organizationId,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$change-me-not-a-hash',
  });
  const roleWith = async (held: readonly Permission[]) => {
    const role = await createRole(db, api.organizationId, {
      id: testId('role'),
      name: `Role ${testId('role')}`,
      permissions: held,
    });
    await setUserRoles(db, api.organizationId, id, [role.id]);
  };
  await roleWith(permissions);
  return { id, token: api.newUserToken(api.environmentId, { userId: id }), roleWith };
}

const tag = action('mark', 'tag_object', {
  'object-type': 'account',
  'object-id': INQUIRY,
  tag: 'seen',
});

async function save(id: string, token: string, definition: unknown, lock: number) {
  const response = await call('PUT', `/workflows/${id}/draft`, token, {
    data: { type: 'workflow-version', attributes: { definition, 'lock-version': lock } },
  });
  expect(response.statusCode, response.body).toBe(200);
}

/** A workflow published by `user` and running. */
async function running(user: Publisher, definition: unknown = chain([tag, decline('no')])) {
  const created = await call('POST', '/workflows', user.token, {
    data: { type: 'workflow', attributes: { name: 'Synthetic' } },
  });
  const { id } = created.json<{ data: { id: string } }>().data;
  await save(id, user.token, definition, 1);
  const published = await call('POST', `/workflows/${id}/publish`, user.token);
  expect(published.statusCode, published.body).toBe(200);
  const activated = await call('POST', `/workflows/${id}/activate`, user.token);
  expect(activated.statusCode, activated.body).toBe(200);
  return { id, versionId: published.json<{ data: { id: string } }>().data.id };
}

const statusOf = async (id: string) => {
  const row = await getWorkflow(api.database.db, api.environmentId, id);
  return { status: row?.status, reason: row?.pausedReason };
};

const pausedEvents = (id: string) =>
  api.events
    .named('workflow.paused')
    .filter((event) => (event.payload as { data: { id: string } }).data.id === id);

const auditOf = (resourceId: string) =>
  api.database.db
    .select()
    .from(auditLogs)
    .where(
      and(eq(auditLogs.environmentId, api.environmentId), eq(auditLogs.resourceId, resourceId)),
    );

const REVOKED = { status: 'paused', reason: 'publisher_revoked' };

describe('runPublisherRightsSweep (C121.5)', () => {
  it('leaves a workflow whose publisher holds everything', async () => {
    const { id } = await running(await publisher());
    await sweep();
    expect(await statusOf(id)).toEqual({ status: 'running', reason: null });
    expect(pausedEvents(id)).toEqual([]);
  });

  it('pauses when the publisher is deactivated, with an event and a system audit entry', async () => {
    const user = await publisher();
    const { id } = await running(user);
    await updateUser(api.database.db, api.organizationId, user.id, { status: 'deactivated' });
    await sweep();
    expect(await statusOf(id)).toEqual(REVOKED);
    expect(pausedEvents(id)).toHaveLength(1);
    const entries = await auditOf(id);
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'workflow.paused',
        actorType: 'system',
        metadata: { reason: 'publisher_revoked' },
      }),
    ]);
    await sweep();
    expect(pausedEvents(id)).toHaveLength(1);
  });

  it('pauses when the publisher is gone', async () => {
    const { db } = api.database;
    const user = await publisher();
    const { id } = await running(user);
    await db.execute(
      sql`update workflow_versions set published_by_id = ${testId('usr')} where workflow_id = ${id}`,
    );
    await sweep();
    expect(await statusOf(id)).toEqual(REVOKED);
  });

  it('pauses when a scope of an adverse step goes', async () => {
    const user = await publisher();
    const { id } = await running(user);
    await user.roleWith(['accounts:write']);
    await sweep();
    expect(await statusOf(id)).toEqual(REVOKED);
  });

  it('keeps running, flagged once and audited once, when an internal scope goes', async () => {
    const user = await publisher();
    const { id, versionId } = await running(user);
    await user.roleWith(['inquiries:write']);
    await sweep();
    await sweep();
    expect(await statusOf(id)).toEqual({ status: 'running', reason: null });
    const version = await getWorkflowVersion(api.database.db, api.environmentId, versionId);
    const flags = (version?.warnings as { code: string }[]).filter(
      ({ code }) => code === 'publisher_scope_lost',
    );
    expect(flags).toHaveLength(1);
    const entries = await auditOf(versionId);
    expect(entries.map(({ metadata }) => metadata)).toEqual(
      expect.arrayContaining([{ 'workflow-id': id, 'missing-scopes': ['accounts:write'] }]),
    );
    expect(
      entries.filter(({ action: name }) => name === 'workflow-version.publisher-rights-reduced'),
    ).toHaveLength(1);

    await user.roleWith(PERMISSIONS);
    await sweep();
    const cleared = await getWorkflowVersion(api.database.db, api.environmentId, versionId);
    expect((cleared?.warnings as { code: string }[]).map(({ code }) => code)).not.toContain(
      'publisher_scope_lost',
    );
  });

  it('reads both sides of a rollout', async () => {
    const owner = await publisher();
    const { id } = await running(owner);
    const second = await publisher();
    await save(id, second.token, chain([tag, decline('other')]), 0);
    const staged = await call('POST', `/workflows/${id}/publish`, second.token, {
      meta: { 'rollout-percentage': 10 },
    });
    expect(staged.statusCode, staged.body).toBe(200);
    await updateUser(api.database.db, api.organizationId, second.id, { status: 'deactivated' });
    await sweep();
    expect(await statusOf(id)).toEqual(REVOKED);
  });

  it('retires the wait index of a version archived a day ago (C119.3)', async () => {
    const { db } = api.database;
    const user = await publisher();
    const { id, versionId } = await running(user);
    await recordWorkflowWaitIndex(db, api.environmentId, versionId, ['inquiry.approved']);
    await save(id, user.token, chain([tag, decline('other')]), 0);
    const republished = await call('POST', `/workflows/${id}/publish`, user.token);
    expect(republished.statusCode, republished.body).toBe(200);
    const held = () =>
      db.select().from(workflowWaitIndex).where(eq(workflowWaitIndex.workflowVersionId, versionId));
    const day = 86_400_000;
    await createdAtClock(db, new Date(api.clock.now().getTime() - day / 2)).at(
      'workflow_versions',
      versionId,
    );
    await sweep();
    expect(await held()).toHaveLength(1);
    await createdAtClock(db, new Date(api.clock.now().getTime() - 2 * day)).at(
      'workflow_versions',
      versionId,
    );
    await sweep();
    expect(await held()).toEqual([]);
  });

  it('leaves a paused workflow alone', async () => {
    const user = await publisher();
    const { id } = await running(user);
    await call('POST', `/workflows/${id}/pause`, user.token);
    await updateUser(api.database.db, api.organizationId, user.id, { status: 'deactivated' });
    await sweep();
    expect(await statusOf(id)).toEqual({ status: 'paused', reason: 'operator' });
  });

  it('stays paused until a holder republishes, which starts it again', async () => {
    const user = await publisher();
    const { id } = await running(user);
    await updateUser(api.database.db, api.organizationId, user.id, { status: 'deactivated' });
    await sweep();
    const holder = await publisher();
    const refused = await call('POST', `/workflows/${id}/activate`, holder.token);
    expect(refused.statusCode).toBe(409);
    await save(id, holder.token, chain([tag, decline('no')]), 0);
    const republished = await call('POST', `/workflows/${id}/publish`, holder.token);
    expect(republished.statusCode, republished.body).toBe(200);
    expect(await statusOf(id)).toEqual({ status: 'running', reason: null });
    await sweep();
    expect(await statusOf(id)).toEqual({ status: 'running', reason: null });
  });
});
