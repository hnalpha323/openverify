/**
 * C151.11 against Postgres 17 row locks (Testcontainers; Workflow 9A, api-flow-engine, checkpoint
 * "outcome"): every exit advances in the transaction that records it, under the inquiry's row lock,
 * so concurrent writers are serialised and the position moves once per exit:
 * - two tabs submitting one screen: one exit is recorded, the other is a resubmission that changes
 *   nothing;
 * - a verification decision racing a screen submission: the submission waits for the decision's
 *   commit and is then taken at the step the decision moved to;
 * - a resume during a branch wait: the session poll and the sweep both find the wait over, and the
 *   branch is left once;
 * - an action's run completing as its timeout sweep runs: the action's step is left once (the run's
 *   own cancellation is `api-flow-actions`', in `flow-actions.integration.test.ts`).
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  appendInquiryFlowStepInTx,
  createDatabase,
  createEnvironment,
  createOrganization,
  createKeyring,
  createVerification,
  getInquiry,
  listInquiryFlowSteps,
  lockInquiry,
  runMigrations,
  setDefaultKeyring,
  setInquiryFlowPositionInTx,
  transitionInquiryStatus,
  type Database,
  type Db,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  ifSet,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulidIdGenerator } from '../ports.js';
import { createAccountsService } from '../services/accounts.js';
import type { ApiDependencies } from '../services/context.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
} from '../test-support/fakes.js';
import { advanceFlowInTx, type FlowExit } from './advance.js';
import { positionFlowInTx } from './position.js';
import { submitFlowScreen } from './screen-submission.js';
import { prepareFlowSessionInTx } from './session.js';

const keyring = createKeyring(randomBytes(32));
/** Long enough for a writer that takes no lock to finish first. */
const WAIT_MS = 1_500;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let deps: ApiDependencies;
let environmentId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 10 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  const clock = fixedClock(new Date());
  const events = createRecordingEventPublisher();
  deps = {
    db,
    keyring,
    storage: createInMemoryFileStorage(),
    events,
    queue: createRecordingQueue(),
    clock,
    ids: ulidIdGenerator,
    flowPublicUrl: 'https://flow.example.test',
    flowCorsOrigins: ['https://flow.example.test'],
    accounts: createAccountsService({ events }),
    redaction: createRecordingRedactionService(clock),
    audit: createRecordingAuditLogger(),
    rateLimiter: createAllowAllRateLimiter(clock),
    mailer: createCapturingMailer(),
    ...phase5TestDependencies(clock),
  };
  const organization = await createOrganization(db, { id: newId('org'), name: 'Race Org' });
  environmentId = (
    await createEnvironment(db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'sandbox',
    })
  ).id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });
const consent = { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true };
const done = { id: 'done', type: 'completion' };
const about = {
  id: 'about',
  type: 'screen',
  components: [
    { id: 'nick', kind: 'text_input', field: 'nickname', labelKey: 'about.nickname' },
    { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
  ],
};

const flowOf = (name: string, steps: unknown[], edges: unknown[]): FlowV2 =>
  flowV2Schema.parse({
    metadata: { specVersion: 2, id: name, version: 1, name },
    entry: 'consent',
    steps,
    edges,
  });

/** A pending inquiry of `flow`, positioned and past its consent. */
async function pastConsent(flow: FlowV2): Promise<string> {
  const { inquiry } = await createTestInquiry(db, environmentId, { flow });
  const ref = { environmentId, inquiryId: inquiry.id };
  await db.transaction(async (tx) => {
    await lockInquiry(tx, environmentId, inquiry.id);
    await positionFlowInTx(tx, deps, ref);
    await advanceFlowInTx(tx, deps, ref, { kind: 'consent-recorded', sessionId: 'iqse_none' });
  });
  return inquiry.id;
}

async function exitsOf(inquiryId: string): Promise<[string, string | null][]> {
  return (await listInquiryFlowSteps(db, environmentId, inquiryId)).map((entry) => [
    entry.stepId,
    entry.exitPort,
  ]);
}

const exitIn = (inquiryId: string, exit: FlowExit) => (tx: Db) =>
  lockInquiry(tx, environmentId, inquiryId).then(() =>
    advanceFlowInTx(tx, deps, { environmentId, inquiryId }, exit),
  );

/**
 * Runs `held` in a transaction of its own connection and keeps it open while `service` starts,
 * then commits. Resolves with whether `service` waited for the commit, and its outcome.
 */
async function whileHeld(
  held: (tx: Db) => Promise<unknown>,
  service: () => Promise<unknown>,
): Promise<{ waited: boolean; outcome: unknown }> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => undefined;
  const holding = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const holder = db.transaction(async (tx) => {
    await held(tx);
    ready();
    await gate;
  });
  await holding;
  let settled = false;
  const running = service().then(
    (value: unknown) => value,
    (error: unknown) => error,
  );
  void running.then(() => {
    settled = true;
  });
  await Promise.race([running, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  const waited = !settled;
  release();
  await holder;
  return { waited, outcome: await running };
}

describe('C151.11: concurrent exits move the position once each', () => {
  it('two tabs submitting one screen: one exit, the other a resubmission that changes nothing', async () => {
    const inquiryId = await pastConsent(
      flowOf(
        'tabs',
        [consent, about, done],
        [edge('e1', 'consent', 'next', 'about'), edge('e2', 'about', 'next', 'done')],
      ),
    );
    const session = { id: 'iqse_none', environmentId, inquiryId };
    const outcomes = await Promise.allSettled([
      submitFlowScreen(deps, session, 'about', { values: { nickname: 'Ada' } }),
      submitFlowScreen(deps, session, 'about', { values: { nickname: 'Bea' } }),
    ]);
    expect(
      outcomes.map((outcome) => (outcome.status === 'rejected' ? String(outcome.reason) : 'ok')),
    ).toEqual(['ok', 'ok']);
    expect(await exitsOf(inquiryId)).toEqual([
      ['consent', 'next'],
      ['about', 'next'],
      ['done', null],
    ]);
    const inquiry = await getInquiry(db, environmentId, inquiryId);
    expect(inquiry?.status).toBe('completed');
    expect(['Ada', 'Bea']).toContain(inquiry?.fields.nickname);
  });

  it('a verification decision racing a screen submission: the submission waits, then is taken', async () => {
    const inquiryId = await pastConsent(
      flowOf(
        'decision',
        [
          consent,
          {
            id: 'id_card',
            type: 'government_id',
            sides: 'front',
            maxAttempts: 2,
            captureMethods: ['camera'],
          },
          about,
          done,
        ],
        [
          edge('e1', 'consent', 'next', 'id_card'),
          edge('e2', 'id_card', 'next', 'about'),
          edge('e3', 'about', 'next', 'done'),
        ],
      ),
    );
    const verificationId = newId('ver');
    await createVerification(db, environmentId, {
      id: verificationId,
      inquiryId,
      type: 'government_id',
    });
    await db.execute(sql`update verifications set status = 'passed' where id = ${verificationId}`);
    const session = { id: 'iqse_none', environmentId, inquiryId };

    const { waited, outcome } = await whileHeld(
      exitIn(inquiryId, {
        kind: 'verification-decided',
        verificationId,
        verificationType: 'government_id',
        status: 'passed',
        origin: 'flow',
      }),
      () => submitFlowScreen(deps, session, 'about', { values: { nickname: 'Ada' } }),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeUndefined();
    expect(await exitsOf(inquiryId)).toEqual([
      ['consent', 'next'],
      ['id_card', 'next'],
      ['about', 'next'],
      ['done', null],
    ]);
  });

  it('a resume during a branch wait and the sweep: the branch is left once', async () => {
    const inquiryId = await pastConsent(
      flowOf(
        'wait',
        [
          consent,
          {
            id: 'route',
            type: 'branch',
            routes: [
              {
                key: 'bots',
                label: 'Bots',
                condition: { '>': [{ var: 'signals.inquiry/bot_score' }, 80] },
                onNull: 'else',
              },
            ],
            waitFor: { facts: ['signals.inquiry/bot_score'], maxSeconds: 5 },
          },
          done,
        ],
        [
          edge('e1', 'consent', 'next', 'route'),
          edge('e2', 'route', 'route:bots', 'done'),
          edge('e3', 'route', 'else', 'done'),
        ],
      ),
    );
    expect((await getInquiry(db, environmentId, inquiryId))?.flowState).toBe('waiting');
    await db.execute(
      sql`update inquiry_flow_steps set entered_at = entered_at - interval '1 minute'
           where inquiry_id = ${inquiryId} and step_id = 'route'`,
    );
    const ref = { environmentId, inquiryId };
    const poll = () =>
      db.transaction(async (tx) => {
        await lockInquiry(tx, environmentId, inquiryId);
        return prepareFlowSessionInTx(tx, deps, ref, 'iqse_none');
      });
    const [entry] = (await listInquiryFlowSteps(db, environmentId, inquiryId)).filter(
      (row) => row.stepId === 'route',
    );
    const sweep = () =>
      db.transaction((tx) =>
        exitIn(inquiryId, { kind: 'wait-elapsed', stepRecordSeq: entry?.seq ?? 0 })(tx),
      );
    await Promise.all([poll(), sweep()]);

    expect(await exitsOf(inquiryId)).toEqual([
      ['consent', 'next'],
      ['route', 'else'],
      ['done', null],
    ]);
  });

  it('an action’s run completing as its timeout sweep runs: the action is left once', async () => {
    const flow = flowOf(
      'action',
      [
        consent,
        {
          id: 'act',
          type: 'action',
          action: { kind: 'tag_inquiry', add: ['raced'], remove: [] },
        },
        done,
      ],
      [
        edge('e1', 'consent', 'next', 'act'),
        edge('e2', 'act', 'next', 'done'),
        edge('e3', 'act', 'error', 'done'),
      ],
    );
    const { inquiry } = await createTestInquiry(db, environmentId, { flow });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    // A run_workflow entry waits at its step; written here as the engine leaves it.
    await db.transaction(async (tx) => {
      await appendInquiryFlowStepInTx(tx, environmentId, {
        inquiryId: inquiry.id,
        stepId: 'act',
        stepType: 'action',
        enteredAt: new Date(),
      });
      await setInquiryFlowPositionInTx(tx, environmentId, inquiry.id, {
        stepId: 'act',
        state: 'waiting',
        previousStepId: null,
        specVersion: 2,
      });
    });
    const finished = (port: 'next' | 'error') =>
      db.transaction((tx) =>
        exitIn(inquiry.id, { kind: 'action-finished', stepId: 'act', entry: 1, port })(tx),
      );
    await Promise.all([finished('next'), finished('error')]);

    const exits = await exitsOf(inquiry.id);
    expect(exits).toHaveLength(2);
    expect(exits[0]?.[0]).toBe('act');
    expect(['next', 'error']).toContain(exits[0]?.[1]);
    expect(exits[1]).toEqual(['done', null]);
  });
});
