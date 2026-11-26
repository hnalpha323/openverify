/**
 * C231.4, C232.1, C232.5, C233.5, C237.2, C240.5, C287.2 (Workflow 11A, `api-connect` checkpoint 4):
 * the Connect locks and the cross-environment writes against real Postgres 17 row locks
 * (Testcontainers). Each race holds a row lock in a second connection, as a concurrent request or
 * job would, and runs the service against it, in both orders where the plan asks:
 *
 * - deactivation (the connection FOR UPDATE) against a token create (the connection FOR SHARE);
 * - a withdrawal (the consent record FOR UPDATE) against a token create citing it;
 * - two peeks of a token at its ninth (the count under the token row lock);
 * - the minute sweep (`FOR UPDATE SKIP LOCKED`) against a token another transaction holds;
 * - each cross-environment write of `cross-tenant.ts` (the counterparty's events and audit entries,
 *   the deactivation's and the withdrawal's expiry) and `listSharesTouching`'s read.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import { PERMISSIONS } from '@openverify/core';
import {
  connectShareTokens,
  consentRecords,
  createDatabase,
  createEnvironment,
  createInquiry,
  createInquiryTemplate,
  createKeyring,
  createOrganization,
  createVerification,
  events,
  listAuditLogs,
  runMigrations,
  setDefaultKeyring,
  setOrganizationConnectInbound,
  setVerificationStatus,
  updateConnection,
  type Database,
} from '@openverify/db';
import { createIntegrationPool, ifSet, startIntegrationPostgres } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runConnectTokenExpiry } from '../../jobs/connect-token-expiry.js';
import { ulidIdGenerator, type Principal } from '../../ports.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../../test-support/fakes.js';
import { AppError } from '../../errors.js';
import {
  AUTHORIZATION_MATRIX,
  actingFor,
  caseName,
  matrixScene,
  principalOf,
  targetOf,
  type MatrixCase,
} from './authorization-matrix.test-support.js';
import {
  changeSharePolicy,
  createConnectionFor,
  deactivateConnection,
  getConnectionDocument,
  listConnections,
  reactivateConnection,
  type ConnectActing,
} from './connections.js';
import { crossTenant } from './cross-tenant.js';
import {
  createShareTokenFor,
  expireShareToken,
  expireTokensOnDeactivation,
  getShareTokenDocument,
  listShareTokens,
  peekShareToken,
  type ShareTokenDeps,
} from './share-tokens.js';

const POLICY = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/api/connect/share-policy.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
const keyring = createKeyring(randomBytes(32));
const DAY = 86_400_000;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let deps: ShareTokenDeps;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 10 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  deps = {
    db,
    clock: fixedClock(new Date('2026-11-12T10:00:00.000Z')),
    ids: ulidIdGenerator,
    events: createRecordingEventPublisher(),
    audit: createRecordingAuditLogger(),
  };
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

interface Side {
  organizationId: string;
  sandbox: string;
  production: string;
}

async function organisation(name: string, inbound: boolean): Promise<Side> {
  const organization = await createOrganization(db, { id: newId('org'), name });
  const sandbox = await createEnvironment(db, {
    id: newId('env'),
    organizationId: organization.id,
    kind: 'sandbox',
  });
  const production = await createEnvironment(db, {
    id: newId('env'),
    organizationId: organization.id,
    kind: 'production',
  });
  if (inbound) {
    await setOrganizationConnectInbound(db, organization.id, true);
  }
  return { organizationId: organization.id, sandbox: sandbox.id, production: production.id };
}

/** An API key of the organisation acting in one of its environments, with every scope. */
function actingOf(side: Side, kind: 'sandbox' | 'production'): ConnectActing {
  const environmentId = kind === 'sandbox' ? side.sandbox : side.production;
  const principal: Principal = {
    kind: 'api-key',
    apiKeyId: newId('key'),
    organizationId: side.organizationId,
    environmentId,
    environmentKind: kind,
    permissions: new Set(PERMISSIONS),
  };
  return {
    principal,
    ctx: { organizationId: side.organizationId, environmentId },
    actor: { type: 'api-key', id: principal.apiKeyId },
    environmentKind: kind,
  };
}

/** Two partners, an active connection, a source inquiry with a passed ID, a consent record. */
async function scene() {
  const source = await organisation('Example Source', false);
  const destination = await organisation('Example Partner', true);
  const { data } = await createConnectionFor(deps, actingOf(source, 'production'), {
    'destination-organization-id': destination.organizationId,
    'share-policy': POLICY as never,
  });
  const now = deps.clock.now();
  await updateConnection(db, data.id, {
    status: 'active',
    acceptedPolicyId: data.attributes['share-policy'].id,
    activatedAt: now,
    updatedAt: now,
  });
  const defaults = defaultInquiryTemplateAttributes();
  const template = await createInquiryTemplate(db, source.sandbox, {
    id: newId('itmpl'),
    name: 'Example share source',
    version: {
      id: newId('itmplv'),
      flow: defaults.flow,
      verificationConfig: defaults['verification-config'],
    },
  });
  const inquiry = await createInquiry(db, source.sandbox, {
    id: newId('inq'),
    inquiryTemplateId: template.id,
    inquiryTemplateVersionId: template.currentVersion.id,
  });
  const verification = await createVerification(db, source.sandbox, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await setVerificationStatus(db, source.sandbox, verification.id, { to: 'passed' });
  return { source, destination, connectionId: data.id, inquiryId: inquiry.id };
}

async function consent(
  s: Awaited<ReturnType<typeof scene>>,
  overrides: Partial<typeof consentRecords.$inferInsert> = {},
): Promise<string> {
  const id = newId('cnsr');
  const now = deps.clock.now();
  await db.insert(consentRecords).values({
    environmentId: s.source.sandbox,
    id,
    side: 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: 'inquiry',
    subjectId: s.inquiryId,
    connectionId: s.connectionId,
    recipientOrganizationId: s.destination.organizationId,
    recipientName: 'Example Partner',
    dataCategories: [
      'identity-fields',
      'contact-fields',
      'other-fields',
      'document-images',
      'biometric',
      'check-results',
    ],
    explicitBiometric: true,
    textSha256: 'c'.repeat(64),
    method: 'flow',
    acceptedAt: now,
    expiresAt: new Date(now.getTime() + 30 * DAY),
    ...overrides,
  });
  return id;
}

const createToken = (
  s: Awaited<ReturnType<typeof scene>>,
  consentRecordId: string,
  seconds?: number,
) =>
  createShareTokenFor(deps, actingOf(s.source, 'sandbox'), {
    'connection-id': s.connectionId,
    'source-id': s.inquiryId,
    'consent-record-id': consentRecordId,
    ...(seconds === undefined ? {} : { 'expires-in-seconds': seconds }),
  });

/** Runs `hold` in a second connection's open transaction until `release` is called. */
async function holding(
  sql: string,
  values: unknown[],
): Promise<{ client: PoolClient; release: (commit?: string) => Promise<void> }> {
  const client = await pool.connect();
  await client.query('begin');
  await client.query(sql, values);
  return {
    client,
    async release(commit) {
      if (commit !== undefined) {
        await client.query(commit);
      }
      await client.query('commit');
      client.release();
    },
  };
}

/** Waits until `promise` is blocked on a lock (it has not settled within `ms`). */
async function stillWaiting(promise: Promise<unknown>, ms = 300): Promise<boolean> {
  const marker = Symbol('waiting');
  const settled = await Promise.race([
    promise.then(
      () => 'settled',
      () => 'settled',
    ),
    new Promise((resolve) =>
      setTimeout(() => {
        resolve(marker);
      }, ms),
    ),
  ]);
  return settled === marker;
}

describe('deactivation against a token create (C231.4, C232.1; both orders)', () => {
  it('a create that waits for a deactivation sees the connection inactive (409 connection_not_active)', async () => {
    const s = await scene();
    const record = await consent(s);
    const deactivation = await holding(
      'select id from connect_connections where id = $1 for update',
      [s.connectionId],
    );
    const create = createToken(s, record);
    expect(await stillWaiting(create)).toBe(true);
    await deactivation.release(
      `update connect_connections set status = 'inactive', deactivated_at = now(), deactivated_by = 'source' where id = '${s.connectionId}'`,
    );
    await expect(create).rejects.toMatchObject({ code: 'connection_not_active' });
  });

  it('a deactivation that waits for a create expires the token the create committed', async () => {
    const s = await scene();
    const record = await consent(s);
    const create = await holding('select id from connect_connections where id = $1 for share', [
      s.connectionId,
    ]);
    const deactivation = deactivateConnection(
      deps,
      actingOf(s.destination, 'production'),
      s.connectionId,
      expireTokensOnDeactivation(deps),
    );
    expect(await stillWaiting(deactivation)).toBe(true);
    const tokenId = newId('cnst');
    const [policy] = (
      await pool.query<{ current_policy_id: string }>(
        'select current_policy_id from connect_connections where id = $1',
        [s.connectionId],
      )
    ).rows;
    await create.client.query(
      `insert into connect_share_tokens (environment_id, id, connection_id, policy_id, environment_kind,
         destination_environment_id, source_type, source_id, consent_record_id, data_categories,
         status, creator_type, creator_id, expires_at)
       values ($1, $2, $3, $4, 'sandbox', $5, 'inquiry', $6, $7, '{check-results}', 'created',
         'api-key', $8, now() + interval '1 day')`,
      [
        s.source.sandbox,
        tokenId,
        s.connectionId,
        policy?.current_policy_id,
        s.destination.sandbox,
        s.inquiryId,
        record,
        newId('key'),
      ],
    );
    await create.release();
    const document = await deactivation;
    expect(document.data.attributes.status).toBe('inactive');
    const [token] = await db
      .select()
      .from(connectShareTokens)
      .where(eq(connectShareTokens.id, tokenId));
    expect(token).toMatchObject({ status: 'expired', expiryReason: 'connection_deactivated' });
  });
});

describe('a withdrawal against a token create citing the record (C237.2, C232.1)', () => {
  it('a create that waits for the withdrawal is refused (consent_required, withdrawn)', async () => {
    const s = await scene();
    const record = await consent(s);
    const withdrawal = await holding('select id from consent_records where id = $1 for update', [
      record,
    ]);
    const create = createToken(s, record);
    expect(await stillWaiting(create)).toBe(true);
    await withdrawal.release(
      `update consent_records set withdrawn_at = now(), withdrawn_via = 'api' where id = '${record}'`,
    );
    await expect(create).rejects.toMatchObject({ code: 'consent_required', reason: 'withdrawn' });
  });

  it('a withdrawal after the create expires the created token (cross-tenant, consent_withdrawn)', async () => {
    const s = await scene();
    const record = await consent(s);
    const { data } = await createToken(s, record);
    const expired = await db.transaction((tx) =>
      crossTenant.expireTokenOnWithdrawal(
        tx,
        {
          organizationId: s.source.organizationId,
          environmentId: s.source.sandbox,
          environmentKind: 'sandbox',
        },
        record,
        deps.clock.now(),
      ),
    );
    expect(expired).toMatchObject({
      id: data.id,
      status: 'expired',
      expiryReason: 'consent_withdrawn',
    });
  });

  it('a destination record naming the token expires it from the destination’s side', async () => {
    const s = await scene();
    const { data } = await createToken(s, await consent(s));
    const destinationRecord = newId('cnsr');
    await db.insert(consentRecords).values({
      environmentId: s.destination.sandbox,
      id: destinationRecord,
      side: 'destination',
      outcome: 'accepted',
      purpose: 'share.reuse-kyc',
      subjectType: 'share-token',
      subjectId: data.id,
      shareTokenId: data.id,
      connectionId: s.connectionId,
      recipientOrganizationId: s.destination.organizationId,
      recipientName: 'Example Partner',
      dataCategories: ['check-results'],
      textSha256: 'd'.repeat(64),
      method: 'attested',
      attestedAt: deps.clock.now(),
      attestedByType: 'api-key',
      attestedById: newId('key'),
      expiresAt: new Date(deps.clock.now().getTime() + DAY),
    });
    const expired = await db.transaction((tx) =>
      crossTenant.expireTokenOnWithdrawal(
        tx,
        {
          organizationId: s.destination.organizationId,
          environmentId: s.destination.sandbox,
          environmentKind: 'sandbox',
        },
        destinationRecord,
        deps.clock.now(),
      ),
    );
    expect(expired?.id).toBe(data.id);
  });
});

describe('the peek count under the token lock (C233.5)', () => {
  it('lets exactly one of two concurrent peeks at the ninth through', async () => {
    const s = await scene();
    const { data } = await createToken(s, await consent(s));
    await db
      .update(connectShareTokens)
      .set({ peekCount: 9 })
      .where(eq(connectShareTokens.id, data.id));
    const peeks = await Promise.allSettled([
      peekShareToken(deps, actingOf(s.destination, 'sandbox'), data.id),
      peekShareToken(deps, actingOf(s.destination, 'sandbox'), data.id),
    ]);
    expect(peeks.filter((peek) => peek.status === 'fulfilled')).toHaveLength(1);
    const refused = peeks.find((peek) => peek.status === 'rejected');
    expect(refused?.status === 'rejected' ? refused.reason : null).toMatchObject({
      code: 'share_token_peek_limit',
    });
    const [token] = await db
      .select({ peekCount: connectShareTokens.peekCount })
      .from(connectShareTokens)
      .where(eq(connectShareTokens.id, data.id));
    expect(token?.peekCount).toBe(10);
  });
});

describe('the minute sweep (C232.5)', () => {
  it('skips a token another transaction holds, and expires it on the next pass', async () => {
    const s = await scene();
    const held = (await createToken(s, await consent(s), 60)).data.id;
    const free = (await createToken(s, await consent(s), 60)).data.id;
    const later = new Date(deps.clock.now().getTime() + 120_000);
    const lock = await holding('select id from connect_share_tokens where id = $1 for update', [
      held,
    ]);
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
    await runConnectTokenExpiry({ db, clock: { now: () => later }, logger });
    const statuses = async () =>
      Object.fromEntries(
        (
          await db
            .select({ id: connectShareTokens.id, status: connectShareTokens.status })
            .from(connectShareTokens)
            .where(eq(connectShareTokens.connectionId, s.connectionId))
        ).map((row) => [row.id, row.status]),
      );
    expect(await statuses()).toMatchObject({ [held]: 'created', [free]: 'expired' });
    await lock.release();
    await runConnectTokenExpiry({ db, clock: { now: () => later }, logger });
    expect(await statuses()).toMatchObject({ [held]: 'expired', [free]: 'expired' });
    // The destination's event and its audit entry, written by the system through cross-tenant.ts.
    const staged = await db
      .select({ environmentId: events.environmentId })
      .from(events)
      .where(eq(events.name, 'connect/share-token.expired'));
    expect(staged.map((event) => event.environmentId)).toContain(s.destination.sandbox);
    const audit = (await listAuditLogs(db, s.destination.sandbox)).filter(
      (entry) => entry.resourceId === held,
    );
    expect(audit[0]?.metadata).toMatchObject({
      counterparty: { 'organization-id': s.source.organizationId, kind: 'system' },
    });
  });
});

describe('each cross-environment write and the access export’s read (C240.5)', () => {
  it('stages the counterparty’s events with an empty cause and appends its audit entries', async () => {
    const s = await scene();
    const tokenId = (await createToken(s, await consent(s))).data.id;
    const [inbound] = await db
      .select({ name: events.name })
      .from(events)
      .where(eq(events.environmentId, s.destination.sandbox));
    expect(inbound).toBeUndefined();
    // The recording publisher stands for the event writer; the audit rows are real.
    const audit = (await listAuditLogs(db, s.destination.sandbox)).filter(
      (entry) => entry.resourceId === tokenId,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: 'system', actorId: null });
    await db.transaction((tx) =>
      crossTenant.stageCounterpartyEvents(tx, [
        {
          environmentId: s.destination.sandbox,
          name: 'connect/connection.activated',
          payload: (deps.events as ReturnType<typeof createRecordingEventPublisher>)
            .named('connect/connection.created')
            .at(-1)?.payload as Record<string, unknown>,
        },
      ]),
    );
    const [written] = await db
      .select({ principal: events.causedByPrincipal, run: events.causedByRunId })
      .from(events)
      .where(eq(events.environmentId, s.destination.sandbox));
    // The other organisation's principal is never recorded in the counterparty's environment.
    expect(written).toEqual({ principal: null, run: null });
  });

  it('finds the shares touching a person’s objects on either side, and nothing elsewhere', async () => {
    const s = await scene();
    const record = await consent(s);
    const tokenId = (await createToken(s, record)).data.id;
    const found = await crossTenant.listSharesTouching(db, s.source.sandbox, [s.inquiryId]);
    expect(found.tokens.map((token) => token.id)).toEqual([tokenId]);
    expect(found.consentRecords.map((consentRecord) => consentRecord.id)).toEqual([record]);
    expect(
      (await crossTenant.listSharesTouching(db, s.source.production, [s.inquiryId])).tokens,
    ).toEqual([]);
  });
});

describe('the Connect authorization matrix through the services on Postgres (C240.2)', () => {
  const cases = AUTHORIZATION_MATRIX.filter((matrixCase) => matrixCase.routeOnly !== true);

  /** The service call of a case's route; its status, or the refusal's. */
  async function statusOf(matrixCase: MatrixCase): Promise<number> {
    const scene = await matrixScene(
      deps,
      (name, inbound) =>
        organisation(name, inbound).then((side) => ({
          id: side.organizationId,
          sandbox: side.sandbox,
          production: side.production,
        })),
      POLICY as never,
    );
    const acting = actingFor(
      principalOf(scene.orgs[matrixCase.organisation], matrixCase.kind, matrixCase.principal),
    );
    const { connectionId, tokenId } = targetOf(scene, matrixCase);
    const calls: Record<MatrixCase['route'], () => Promise<unknown>> = {
      'connection.list': () => listConnections(deps, acting, {}),
      'connection.get': () => getConnectionDocument(deps, acting, connectionId),
      'connection.deactivate': () =>
        deactivateConnection(deps, acting, connectionId, expireTokensOnDeactivation(deps)),
      'connection.reactivate': () => reactivateConnection(deps, acting, connectionId),
      'connection.policy': () => changeSharePolicy(deps, acting, connectionId, POLICY as never),
      'token.list': () => listShareTokens(deps, acting, {}),
      'token.create': () =>
        createShareTokenFor(deps, acting, {
          'connection-id': connectionId,
          'source-id': scene.fresh.inquiryId,
          'consent-record-id': scene.fresh.consentRecordId,
        }),
      'token.get': () => getShareTokenDocument(deps, acting, tokenId),
      'token.peek': () => peekShareToken(deps, acting, tokenId),
      'token.expire': () => expireShareToken(deps, acting, tokenId),
    };
    try {
      await calls[matrixCase.route]();
      return matrixCase.route === 'token.create' ? 201 : 200;
    } catch (error) {
      if (error instanceof AppError) {
        return error.status;
      }
      throw error;
    }
  }

  it.each(cases.map((matrixCase) => [caseName(matrixCase), matrixCase] as const))(
    '%s',
    async (_name, matrixCase) => {
      expect(await statusOf(matrixCase)).toBe(matrixCase.expected);
    },
  );
});
