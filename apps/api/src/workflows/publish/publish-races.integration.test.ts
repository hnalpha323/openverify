/**
 * Workflow 8A Stage 3 (`api-workflows`; C116.1, C116.3) against Postgres 17 row locks (Testcontainers):
 * two writers of one workflow at once.
 * - Two publishes of one draft: the workflow's row lock serializes them, so one version freezes, the
 *   other answers 409 `draft_missing`, and one trigger row stands.
 * - Two saves at one lock version: one wins, and the other answers 409 `version_locked`.
 * - Two restores: the workflow holds one draft, and the other answers 409 `draft_exists`.
 * Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import { PERMISSIONS } from '@openverify/core';
import {
  createDatabase,
  createKeyring,
  getWorkflow,
  listEventWorkflowTriggers,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
  testId,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { WorkflowProblemError } from '../../errors.js';
import { ulidIdGenerator, type UserPrincipal } from '../../ports.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
} from '../../test-support/fakes.js';
import type { WorkflowActing } from '../acting.js';
import {
  createWorkflow,
  publishWorkflow,
  putWorkflowDraft,
  restoreWorkflow,
} from '../definitions/service.js';
import { action, chain, INQUIRY } from './testing.js';

const keyring = createKeyring(randomBytes(32));
const NOW = new Date('2026-11-01T12:00:00.000Z');

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
let organizationId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  organizationId = tenant.organization.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const deps = () =>
  ({
    db,
    keyring,
    events: createRecordingEventPublisher(),
    audit: createRecordingAuditLogger(),
    clock: { now: () => NOW },
    ids: ulidIdGenerator,
    flowPublicUrl: 'https://flow.example.com',
    mailer: { configured: false },
    providers: { sandbox: {}, production: {} },
  }) as unknown as ApiDependencies;

const acting = (): WorkflowActing => {
  const userId = testId('usr');
  const principal: UserPrincipal = {
    kind: 'user',
    userId,
    userSessionId: testId('uss'),
    organizationId,
    environmentId,
    environmentKind: 'sandbox',
    permissions: new Set(PERMISSIONS),
    mfaSatisfied: true,
  };
  return {
    ctx: { organizationId, environmentId },
    actor: { type: 'user', id: userId },
    mask: UNMASKED,
    environmentKind: 'sandbox',
    principal,
  };
};

const tag = (value = 'checked') =>
  action('mark', 'tag_object', { 'object-type': 'inquiry', 'object-id': INQUIRY, tag: value });

async function drafted(context: ApiDependencies, who: WorkflowActing): Promise<string> {
  const { data } = await createWorkflow(context, who, {
    data: { type: 'workflow', attributes: { name: 'Raced' } },
  });
  await putWorkflowDraft(context, who, data.id, {
    data: {
      type: 'workflow-version',
      attributes: { definition: chain([tag()]), 'lock-version': 1 },
    },
  });
  return data.id;
}

const codeOf = (outcome: PromiseSettledResult<unknown>) =>
  outcome.status === 'rejected' && outcome.reason instanceof WorkflowProblemError
    ? outcome.reason.code
    : outcome.status;

describe('one workflow, two writers (C116.1)', () => {
  it('freezes one draft once, under two publishes', async () => {
    const context = deps();
    const who = acting();
    const id = await drafted(context, who);
    const outcomes = await Promise.allSettled([
      publishWorkflow(context, who, id, null),
      publishWorkflow(context, who, id, null),
    ]);
    expect(outcomes.map(codeOf).sort()).toEqual(['draft_missing', 'fulfilled']);
    const rows = await listEventWorkflowTriggers(db, environmentId, 'inquiry.completed');
    expect(rows.filter((row) => row.workflowId === id)).toHaveLength(1);
    expect((await getWorkflow(db, environmentId, id))?.draftVersionId).toBeNull();
  });

  it('takes one of two saves at one lock version', async () => {
    const context = deps();
    const who = acting();
    const id = await drafted(context, who);
    const save = (value: string) =>
      putWorkflowDraft(context, who, id, {
        data: {
          type: 'workflow-version',
          attributes: { definition: chain([tag(value)]), 'lock-version': 2 },
        },
      });
    const outcomes = await Promise.allSettled([save('one'), save('two')]);
    expect(outcomes.map(codeOf).sort()).toEqual(['fulfilled', 'version_locked']);
  });

  it('opens one draft under two restores', async () => {
    const context = deps();
    const who = acting();
    const id = await drafted(context, who);
    const { data } = await publishWorkflow(context, who, id, null);
    const restore = () => restoreWorkflow(context, who, id, { meta: { 'version-id': data.id } });
    const outcomes = await Promise.allSettled([restore(), restore()]);
    expect(outcomes.map(codeOf).sort()).toEqual(['draft_exists', 'fulfilled']);
  });
});
