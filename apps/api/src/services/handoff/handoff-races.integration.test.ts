/**
 * C96.3, C111.3 (Workflow 7A, `flow-handoff`): the handoff races against Postgres 17 row locks
 * (Testcontainers, started without bind-parameter logging).
 *
 * - Two redemptions of one token at once: one wins; the other answers the uniform 410, and one
 *   handoff session exists.
 * - A decline and a redemption of one token at once: one wins.
 * - An issue (or a continue-here) that read the step as waiting, then took the inquiry's lock after
 *   a redemption committed: it re-reads the step under the lock and refuses (409
 *   `handoff_not_available`), so the step stays `redeemed` and no token is left live beside it.
 *
 * Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import {
  defaultInquiryTemplateAttributes,
  newId,
  newSessionToken,
  parseHandoffFragment,
} from '@openverify/contracts';
import {
  createDatabase,
  createInquirySession,
  createKeyring,
  hashSessionToken,
  listInquiryHandoffSteps,
  runMigrations,
  setDefaultKeyring,
  updateEnvironmentSettings,
  type Database,
  type Db,
} from '@openverify/db';
import { createIntegrationPool, createTestInquiry, createTestTenant, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { Flow } from '@openverify/flow-spec';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlowSession } from '../../auth/flow-session.js';
import { SignalProblemError } from '../../errors.js';
import { ulidIdGenerator } from '../../ports.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
  phase5TestDependencies,
} from '../../test-support/fakes.js';
import type { ApiDependencies } from '../context.js';
import {
  continueHandoffHere,
  declineHandoff,
  issueHandoff,
  redeemHandoff,
} from './flow-handoffs.js';

const keyring = createKeyring(randomBytes(32));
const NOW = new Date('2026-10-29T12:00:00.000Z');
const CLIENT = { ip: '198.51.100.20', userAgent: 'Synthetic-Phone/1.0' };

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  await updateEnvironmentSettings(db, environmentId, {
    'organization-display-name': 'Example Verification Ltd',
  });
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

/** The default flow with a handoff step after the consent. */
const FLOW: Flow = (() => {
  const { flow } = defaultInquiryTemplateAttributes();
  const [consent, ...rest] = flow.steps;
  if (consent === undefined) {
    throw new Error('the default flow has no consent step');
  }
  return { ...flow, steps: [consent, { id: 'device_handoff', type: 'device_handoff' }, ...rest] };
})();

function dependencies(database: Db = db): ApiDependencies {
  const clock = fixedClock(NOW);
  return {
    ...phase5TestDependencies(clock),
    db: database,
    keyring,
    storage: createInMemoryFileStorage(),
    events: createRecordingEventPublisher(),
    clock,
    ids: ulidIdGenerator,
    flowPublicUrl: 'https://flow.example.test',
    rateLimiter: createAllowAllRateLimiter(clock),
    mailer: createCapturingMailer(),
    audit: createRecordingAuditLogger(),
  } as unknown as ApiDependencies;
}

/** `database`, its transactions held until `release` once one is asked for. */
function heldTransactions(database: Database) {
  let reach: () => void = () => undefined;
  let release: () => void = () => undefined;
  const reached = new Promise<void>((done) => {
    reach = done;
  });
  const released = new Promise<void>((done) => {
    release = done;
  });
  const held = new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return async (...args: Parameters<Database['transaction']>) => {
          reach();
          await released;
          return target.transaction(...args);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  });
  return { db: held, reached, release };
}

/** A desktop session of a new inquiry on the handoff flow, with an issued QR token. */
async function issued(): Promise<{ desktop: FlowSession; handoffToken: string }> {
  const { inquiry } = await createTestInquiry(db, environmentId, { flow: FLOW });
  const id = newId('iqse');
  await createInquirySession(db, environmentId, {
    id,
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(newSessionToken()),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  const desktop = { id, environmentId, inquiryId: inquiry.id };
  const answer = await issueHandoff(dependencies(), desktop, { method: 'qr' }, CLIENT);
  const parsed = parseHandoffFragment(answer['url-fragment'] ?? '');
  if (parsed === null) {
    throw new Error('the issue answered no fragment');
  }
  return { desktop, handoffToken: parsed.handoffToken };
}

const body = (desktop: FlowSession, handoffToken: string) => ({
  'inquiry-id': desktop.inquiryId,
  'handoff-token': handoffToken,
});

const codeOf = (outcome: PromiseSettledResult<unknown>) =>
  outcome.status === 'rejected' && outcome.reason instanceof SignalProblemError
    ? outcome.reason.code
    : outcome.status;

async function handoffSessions(inquiryId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'select count(*) from inquiry_sessions where inquiry_id = $1 and handoff_from_session_id is not null',
    [inquiryId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function stepState(inquiryId: string): Promise<string | undefined> {
  return (await listInquiryHandoffSteps(db, environmentId, inquiryId))[0]?.state;
}

describe('handoff races on Postgres (C96.3, C111.3)', () => {
  it('lets one of two simultaneous redemptions of a token win', async () => {
    const { desktop, handoffToken } = await issued();

    const outcomes = await Promise.allSettled([
      redeemHandoff(dependencies(), body(desktop, handoffToken), CLIENT),
      redeemHandoff(dependencies(), body(desktop, handoffToken), CLIENT),
    ]);

    expect(outcomes.map(codeOf).sort()).toEqual(['fulfilled', 'handoff_token_invalid']);
    expect(await handoffSessions(desktop.inquiryId)).toBe(1);
    expect(await stepState(desktop.inquiryId)).toBe('redeemed');
  });

  it('lets one of a decline and a redemption of a token win', async () => {
    const { desktop, handoffToken } = await issued();

    const outcomes = await Promise.allSettled([
      declineHandoff(dependencies(), body(desktop, handoffToken)),
      redeemHandoff(dependencies(), body(desktop, handoffToken), CLIENT),
    ]);

    const codes = outcomes.map(codeOf);
    expect(codes.filter((code) => code === 'fulfilled')).toHaveLength(1);
    expect(codes.filter((code) => code === 'handoff_token_invalid')).toHaveLength(1);
    const redeemedWon = outcomes[1].status === 'fulfilled';
    expect(await handoffSessions(desktop.inquiryId)).toBe(redeemedWon ? 1 : 0);
    expect(await stepState(desktop.inquiryId)).toBe(redeemedWon ? 'redeemed' : 'declined');
  });

  it('refuses an issue that took the lock after a redemption committed, keeping the step redeemed', async () => {
    const { desktop, handoffToken } = await issued();
    const held = heldTransactions(db);
    const issue = issueHandoff(dependencies(held.db), desktop, { method: 'qr' }, CLIENT).then(
      () => 'fulfilled' as const,
      (error: unknown) => (error instanceof SignalProblemError ? error.code : 'rejected'),
    );
    await held.reached;

    await redeemHandoff(dependencies(), body(desktop, handoffToken), CLIENT);
    held.release();

    expect(await issue).toBe('handoff_not_available');
    expect(await stepState(desktop.inquiryId)).toBe('redeemed');
    const { rows } = await pool.query<{ live: string }>(
      `select count(*) as live from handoff_tokens
        where inquiry_id = $1 and redeemed_at is null and revoked_at is null`,
      [desktop.inquiryId],
    );
    expect(Number(rows[0]?.live)).toBe(0);
  });

  it('refuses a continue-here that took the lock after a redemption committed', async () => {
    const { desktop, handoffToken } = await issued();
    const held = heldTransactions(db);
    const continued = continueHandoffHere(dependencies(held.db), desktop).then(
      () => 'fulfilled' as const,
      (error: unknown) => (error instanceof SignalProblemError ? error.code : 'rejected'),
    );
    await held.reached;

    await redeemHandoff(dependencies(), body(desktop, handoffToken), CLIENT);
    held.release();

    expect(await continued).toBe('handoff_not_available');
    expect(await stepState(desktop.inquiryId)).toBe('redeemed');
  });
});
