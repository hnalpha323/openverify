/**
 * Workflow 9B Stage 1b, checkpoint (U): the access plumbing `foundation-9b` places for `api-access`
 * (C167.2, C168.1, C168.6, C174.3, C174.5):
 *
 * - the session's permissions computed by `permissionsForEnvironment` over the user's assignments
 *   and the session's environment (review F29), where the union of every role was taken before;
 * - a key minted or cloned with at most `mintablePermissions`;
 * - a workflow promote needing the rights in the target environment too
 *   (`userPermissionsInEnvironment`);
 * - an organisation setting changed only past `assertSettingsLevelAllowed` (V14);
 * - the Phase 8 role resolutions written in SQL reading each assignment's environments
 *   (`roleAssignmentReaches`);
 * - the C16 pass running the audit-log retention, and `blind-index:rebuild` the audit IP index;
 * - the stubs, which change nothing for an organisation-wide assignment and fail closed for a
 *   narrower one until `api-access` builds them.
 *
 * Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { AUDIT_IP_INDEX_LABEL } from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  createEnvironment,
  createRole,
  createUser,
  IDENTIFIER_KEY_LABELS,
  readCaseAssigneeFacts,
  setUserRoles,
} from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runBlindIndexRebuild } from '../scripts/blind-index-rebuild.js';
import { UNMASKED } from './auth/pii.js';
import { createMemoryStorage } from './jobs/testing.js';
import { findUserSessionContext } from './operator-auth/session-context.js';
import type { UserPrincipal } from './ports.js';
import {
  createDashboardHarness,
  type DashboardHarness,
} from './routes/dashboard/dashboard.test-support.js';
import * as accessIpIndex from './services/access/audit-ip-index.js';
import * as accessRetention from './services/access/audit-retention.js';
import * as accessPermissions from './services/access/permissions.js';
import * as accessSettings from './services/access/settings-level.js';
import { createApiKey, cloneApiKey } from './services/api-keys.js';
import { runRetention } from './services/retention.js';
import { updateDashboardSettings } from './services/settings.js';
import { createTestApi, type TestApi } from './test-support/harness.js';
import { createRecordingAuditLogger, fixedClock } from './test-support/fakes.js';
import type { WorkflowActing } from './workflows/acting.js';
import { promoteWorkflow } from './workflows/publish/promote.js';

vi.mock('./services/access/permissions.js', { spy: true });
vi.mock('./services/access/settings-level.js', { spy: true });
vi.mock('./services/access/audit-retention.js', { spy: true });
vi.mock('./services/access/audit-ip-index.js', { spy: true });

let api: TestApi;
let dashboard: DashboardHarness;

beforeAll(async () => {
  api = await createTestApi();
  dashboard = await createDashboardHarness(api.database);
}, 120_000);

afterAll(async () => {
  await dashboard.close();
  await api.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

const NO_ISSUE = () => {
  throw new Error('a refused key is never issued');
};

/** An operator of a new organisation, signed in to its sandbox with the admin role. */
async function signedIn() {
  const organization = await dashboard.organization();
  const admin = await dashboard.operator(organization, { roles: ['admin'] });
  const token = await dashboard.signIn(admin.email);
  return { organization, admin, token };
}

describe("the session's permissions are its environment's (C167.2; review F29)", () => {
  it('passes the assignments and the session environment to permissionsForEnvironment, and uses its answer', async () => {
    const { organization, admin, token } = await signedIn();
    vi.mocked(accessPermissions.permissionsForEnvironment).mockReturnValueOnce(
      new Set<Permission>(['inquiries:read']),
    );

    const context = await findUserSessionContext(api.database.db, token, dashboard.clock.now());

    const [assignments, environmentId] =
      vi.mocked(accessPermissions.permissionsForEnvironment).mock.calls.at(-1) ?? [];
    expect(environmentId).toBe(organization.sandboxId);
    expect(
      [...(assignments ?? [])].map((assignment) => ({
        roleId: (assignment.role as { id?: string }).id,
        environmentIds: assignment.environmentIds,
      })),
    ).toEqual([{ roleId: organization.roleIds.admin, environmentIds: null }]);
    expect(context?.user.id).toBe(admin.user.id);
    expect([...(context?.permissions ?? [])]).toEqual(['inquiries:read']);
  });

  it('keeps an organisation-wide assignment as before, and grants a narrower one only where it reaches (built by api-access)', async () => {
    const { organization, admin, token } = await signedIn();
    const reader = await createRole(api.database.db, organization.id, {
      id: testId('role'),
      name: `Synthetic reader ${testId('role')}`,
      permissions: ['inquiries:read', 'users:read'],
    });
    const before = await findUserSessionContext(api.database.db, token, dashboard.clock.now());
    await api.database.db.execute(
      sql`insert into user_roles (organization_id, user_id, role_id, environment_ids)
          values (${organization.id}, ${admin.user.id}, ${reader.id}, array[${organization.sandboxId}])`,
    );
    await api.database.db.execute(
      sql`update user_roles set environment_ids = array[${testId('env')}]
          where user_id = ${admin.user.id} and role_id = ${organization.roleIds.admin}`,
    );

    const after = await findUserSessionContext(api.database.db, token, dashboard.clock.now());

    expect([...(before?.permissions ?? [])].sort()).toEqual([...PERMISSIONS].sort());
    // The reader reaches the sandbox, but users:read is organisation-level (P01).
    expect([...(after?.permissions ?? [])]).toEqual(['inquiries:read']);
  });
});

describe('a key holds at most what its minter may grant (C167.2)', () => {
  const principal = (): UserPrincipal => ({
    kind: 'user',
    userId: testId('usr'),
    userSessionId: testId('uss'),
    organizationId: api.organizationId,
    environmentId: api.environmentId,
    environmentKind: 'sandbox',
    permissions: new Set(PERMISSIONS),
    mfaSatisfied: true,
  });
  const ctx = () => ({ organizationId: api.organizationId, environmentId: api.environmentId });

  it('reads mintablePermissions when a key is created, refusing a scope it does not give', async () => {
    const minter = principal();
    vi.mocked(accessPermissions.mintablePermissions).mockReturnValueOnce(new Set());

    const refused = await createApiKey(
      api.deps,
      ctx(),
      minter,
      { name: 'Synthetic minted key', scopes: ['inquiries:read'] },
      NO_ISSUE,
    ).catch((error: unknown) => error);

    expect(accessPermissions.mintablePermissions).toHaveBeenCalledWith(minter);
    expect(refused).toMatchObject({ status: 403 });
  });

  it('reads mintablePermissions when a key is cloned', async () => {
    const minter = principal();
    const [source] = (
      await api.database.db.execute<{ id: string }>(
        sql`select id from api_keys where environment_id = ${api.environmentId} limit 1`,
      )
    ).rows;
    vi.mocked(accessPermissions.mintablePermissions).mockReturnValueOnce(new Set());

    const refused = await cloneApiKey(
      api.deps,
      ctx(),
      minter,
      source?.id ?? '',
      'Synthetic clone',
      NO_ISSUE,
    ).catch((error: unknown) => error);

    expect(accessPermissions.mintablePermissions).toHaveBeenCalledWith(minter);
    expect(refused).toMatchObject({ status: 403 });
  });
});

describe('a workflow promote needs the rights in the target environment too (C167.2)', () => {
  it('asks userPermissionsInEnvironment for the target, refusing what it does not hold there', async () => {
    const target = await createEnvironment(api.database.db, {
      id: testId('env'),
      organizationId: api.organizationId,
      kind: 'production',
    });
    // Built (api-access): the target's rights come from the user's stored assignments.
    const userId = testId('usr');
    await createUser(api.database.db, {
      id: userId,
      organizationId: api.organizationId,
      email: `${userId.toLowerCase()}@example.test`,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$synthetic$synthetic',
    });
    const promoter = await createRole(api.database.db, api.organizationId, {
      id: testId('role'),
      name: `Synthetic promoter ${testId('role')}`,
      permissions: [...PERMISSIONS],
    });
    await setUserRoles(api.database.db, api.organizationId, userId, [promoter.id]);
    const user: UserPrincipal = {
      kind: 'user',
      userId,
      userSessionId: testId('uss'),
      organizationId: api.organizationId,
      environmentId: api.environmentId,
      environmentKind: 'sandbox',
      permissions: new Set(PERMISSIONS),
      mfaSatisfied: true,
    };
    const acting: WorkflowActing = {
      ctx: { organizationId: api.organizationId, environmentId: api.environmentId },
      actor: { type: 'user', id: user.userId },
      mask: UNMASKED,
      environmentKind: 'sandbox',
      principal: user,
    };
    const promote = () =>
      promoteWorkflow(api.deps, acting, 'wfl_01M5CN00000000000000009B61', {
        meta: { 'environment-id': target.id },
      }).catch((error: unknown) => error);

    vi.mocked(accessPermissions.userPermissionsInEnvironment).mockResolvedValueOnce(new Set());
    const refused = await promote();
    const allowed = await promote();

    expect(accessPermissions.userPermissionsInEnvironment).toHaveBeenCalledWith(
      api.deps.db,
      user,
      target.id,
    );
    expect(refused).toMatchObject({ status: 403 });
    // Past the rights, the unknown workflow is the refusal.
    expect(allowed).toMatchObject({ status: 404 });
  });
});

describe('an organisation setting needs organisation-wide settings:write (C167.2; V14)', () => {
  it('asks assertSettingsLevelAllowed with the keys before anything is written', async () => {
    const tenant = await api.newTenant();
    const ctx = { environmentId: tenant.environmentId, organizationId: tenant.organizationId };
    const actor = { type: 'user' as const, id: 'usr_01M5CJXHG07XPHF3HRM6NREDH8' };
    vi.mocked(accessSettings.assertSettingsLevelAllowed).mockRejectedValueOnce(
      Object.assign(new Error('synthetic refusal'), { status: 403 }),
    );

    await expect(
      updateDashboardSettings(
        api.database.db,
        createRecordingAuditLogger(),
        ctx,
        actor,
        { 'require-mfa': true, 'audit-log-retention-days': 90 },
        100,
      ),
    ).rejects.toThrow('synthetic refusal');

    expect(accessSettings.assertSettingsLevelAllowed).toHaveBeenCalledWith(api.database.db, {
      organizationId: tenant.organizationId,
      environmentId: tenant.environmentId,
      actor,
      keys: ['require-mfa', 'audit-log-retention-days'],
    });
    const [organization] = (
      await api.database.db.execute<{ require_mfa: boolean }>(
        sql`select require_mfa from organizations where id = ${tenant.organizationId}`,
      )
    ).rows;
    expect(organization?.require_mfa).toBe(false);
  });
});

describe('the Phase 8 role resolutions read the assignment environments (C167.2)', () => {
  it('count a role through an organisation-wide assignment or one naming the environment, never another (built by api-access)', async () => {
    const userId = testId('usr');
    await createUser(api.database.db, {
      id: userId,
      organizationId: api.organizationId,
      email: `${userId.toLowerCase()}@example.test`,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$synthetic$synthetic',
    });
    const role = await createRole(api.database.db, api.organizationId, {
      id: testId('role'),
      name: `Synthetic writer ${testId('role')}`,
      permissions: ['cases:read', 'cases:write'],
    });
    await setUserRoles(api.database.db, api.organizationId, userId, [role.id]);
    const facts = () =>
      readCaseAssigneeFacts(api.database.db, {
        environmentId: api.environmentId,
        organizationId: api.organizationId,
        caseTemplateId: null,
        userIds: [userId],
      });

    const before = await facts();
    await api.database.db.execute(
      sql`update user_roles set environment_ids = array[${api.environmentId}] where user_id = ${userId}`,
    );
    const named = await facts();
    await api.database.db.execute(
      sql`update user_roles set environment_ids = array[${testId('env')}] where user_id = ${userId}`,
    );
    const elsewhere = await facts();

    expect(before[0]?.holdsCasesWrite).toBe(true);
    expect(named[0]?.holdsCasesWrite).toBe(true);
    expect(elsewhere[0]?.holdsCasesWrite).toBe(false);
  });

  it.each([
    ['../../packages/db/src/repositories/cases.ts', 1],
    ['../../packages/db/src/repositories/case-queues.ts', 2],
    ['src/services/cases/writes.ts', 1],
    ['src/services/cases/bulk/apply.ts', 1],
    ['src/services/cases/templates.ts', 1],
    ['src/jobs/cases/notification-emails.ts', 1],
  ])('%s reads every user_roles row through roleAssignmentReaches', (file, sites) => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const reads = source.match(/(?:user_roles|\$\{userRoles\}) ur\b/g) ?? [];

    expect(reads).toHaveLength(sites);
    expect(source.match(/roleAssignmentReaches\(/g) ?? []).toHaveLength(sites);
  });
});

describe('the C16 pass runs the audit-log retention (C168.6)', () => {
  it('calls the hook once with the run’s now and batch, and reports its count', async () => {
    vi.mocked(accessRetention.runAuditLogRetention).mockResolvedValueOnce({ deletedAuditLogs: 4 });
    const clock = fixedClock();

    const report = await runRetention({
      db: api.database.db,
      redaction: api.redaction,
      storage: createMemoryStorage(),
      clock,
      batchSize: 50,
    });

    expect(accessRetention.runAuditLogRetention).toHaveBeenCalledTimes(1);
    expect(accessRetention.runAuditLogRetention).toHaveBeenCalledWith(
      { db: api.database.db },
      { now: clock.now(), limit: 50 },
    );
    expect(report).toMatchObject({ deletedAuditLogs: 4 });
  });
});

describe('blind-index:rebuild rewrites the audit IP index (C168.6, C174.5)', () => {
  it('calls rebuildAuditLogIpIndex with the key and batch, and prints its counts only', async () => {
    const key = new Uint8Array(32).fill(3);
    vi.mocked(accessIpIndex.rebuildAuditLogIpIndex).mockResolvedValueOnce({
      scanned: 6,
      updated: 2,
    });
    const lines: string[] = [];

    const result = await runBlindIndexRebuild({
      db: api.database.db,
      key,
      args: { batchSize: 10 },
      out: (line) => lines.push(line),
    });

    expect(accessIpIndex.rebuildAuditLogIpIndex).toHaveBeenCalledWith(api.database.db, key, {
      batchSize: 10,
    });
    expect(result).toMatchObject({ auditLogAddresses: { scanned: 6, updated: 2 } });
    expect(lines).toContain(
      'blind-index:rebuild: done: scanned 6 audit log addresses, re-indexed 2.',
    );
  });

  it('labels the index with the contract’s label', () => {
    expect(IDENTIFIER_KEY_LABELS['audit-ip']).toBe(AUDIT_IP_INDEX_LABEL);
  });
});

describe('the stubs change nothing until api-access builds them', () => {
  it('pass the session permissions through, accept the settings, and delete and index nothing', async () => {
    const permissions = await vi.importActual<typeof accessPermissions>(
      './services/access/permissions.js',
    );
    const settings = await vi.importActual<typeof accessSettings>(
      './services/access/settings-level.js',
    );
    const retention = await vi.importActual<typeof accessRetention>(
      './services/access/audit-retention.js',
    );
    const ipIndex = await vi.importActual<typeof accessIpIndex>(
      './services/access/audit-ip-index.js',
    );
    const role = { permissions: ['inquiries:read', 'not-a-permission'] };
    const user: UserPrincipal = {
      kind: 'user',
      userId: testId('usr'),
      userSessionId: testId('uss'),
      organizationId: api.organizationId,
      environmentId: api.environmentId,
      environmentKind: 'sandbox',
      permissions: new Set<Permission>(['inquiries:read']),
      mfaSatisfied: true,
    };

    // C167.2: the permission hooks are built (services/access/permissions.test.ts).
    expect([
      ...permissions.permissionsForEnvironment(
        [
          { role, environmentIds: null },
          { role: { permissions: ['cases:read'] }, environmentIds: [testId('env')] },
        ],
        api.environmentId,
      ),
    ]).toEqual(['inquiries:read']);
    expect(permissions.mintablePermissions(user)).toBe(user.permissions);
    // C167.2 (V14): built (services/access/settings-level.test.ts); environment keys pass.
    await expect(
      settings.assertSettingsLevelAllowed(api.database.db, {
        organizationId: api.organizationId,
        environmentId: api.environmentId,
        actor: { type: 'user', id: user.userId },
        keys: ['inquiry-retention-days'],
      }),
    ).resolves.toBeUndefined();
    await expect(
      retention.runAuditLogRetention({ db: api.database.db }, { now: new Date(0), limit: 500 }),
    ).resolves.toEqual({ deletedAuditLogs: 0 });
    // C168.6: the rebuild is built (services/access/audit-maintenance.test.ts).
    expect(typeof ipIndex.rebuildAuditLogIpIndex).toBe('function');
  });
});
