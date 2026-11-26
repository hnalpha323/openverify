/**
 * C243 (Phase 11, Workflow 11A, `workflow-connect`): Connect's three steps on the real engine (PGlite),
 * over a fake of the share token services, so the inputs, the outputs, the refusals and the effect
 * key are held before the services land. Each step calls its service in the step's transaction with
 * the run as the actor (C243.1), outputs the token as the run scope reads it, surfaces a service's
 * problem as the step's error by its code (with `consent_required`'s `reason` in the sealed output),
 * fails closed while the install keeps Connect off (C231.10), and is exactly once: a lost claim rolls
 * the service's write back and a repeated job writes nothing. The redemption's job is enqueued after
 * the step's transaction, never inside it and never for a refused step; like every action's
 * after-commit work it is best effort and also follows an attempt that lost its claim, whose token
 * the job then finds not `pending` (C234.2: it re-reads the token under its lock). Every value is
 * synthetic.
 */
import type { CreateShareTokenBody, RedeemShareTokenBody } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotImplementedError } from '../../../errors.js';
import type { ConnectRedeemJob } from '../../../jobs/connect-queues.js';
import { processWorkflowStep } from '../../../jobs/workflows/step.js';
import { connectNotFound } from '../../../services/connect/not-found.js';
import { ConnectProblemError } from '../../../services/connect/problems.js';
import {
  createActionHandlerTable,
  type ActionHandler,
  type TransactionActionHandler,
} from '../../engine/action-port.js';
import { RUN_WORKFLOW_HANDLER } from '../../engine/run-workflow.js';
import { effectsOf, runOf, start, stepOf } from '../../engine/testing.js';
import { stepOutputOf, useHandlers } from '../cases/testing.js';
import { OBJECT_ACTION_HANDLERS } from '../index.js';
import { action, chain, createActionHarness, EVERY_GRANT, type ActionHarness } from '../testing.js';
import { createConnectActionHandlers } from './handlers.js';
import type { ConnectActionCaller, ConnectActionPort, ShareTokenFacts } from './port.js';
import { notBuilt } from '../../not-built.js';

/** A port whose every service is not built yet, as each was before its owner landed it. */
const NOT_BUILT: ConnectActionPort = {
  createShareToken: () => notBuilt('create_share_token'),
  redeemShareToken: () => notBuilt('redeem_share_token'),
  expireShareToken: () => notBuilt('expire_share_token'),
};

const CONNECTION = 'cxn_01M5CN0000000000000011W100';
const SOURCE = 'inq_01M5CN0000000000000011W300';
const CONSENT = 'cnsr_01M5CN0000000000000011W400';
const DESTINATION_CONSENT = 'cnsr_01M5CN0000000000000011W410';
const TOKEN = 'cnst_01M5CN0000000000000011W200';
const TEMPLATE = 'itmpl_01M5CN0000000000000011W600';
const EXPIRES_AT = '2026-11-26T00:00:00.000Z';

const CONNECT_GRANT = {
  scopes: [
    ...EVERY_GRANT.scopes,
    'connect-share-tokens:read',
    'connect-share-tokens:write',
    'connect-share-tokens:redeem',
  ],
  pii: false,
} as const;

type Call =
  | { name: 'create'; caller: ConnectActionCaller; body: CreateShareTokenBody }
  | { name: 'redeem'; caller: ConnectActionCaller; id: string; body: RedeemShareTokenBody }
  | { name: 'expire'; caller: ConnectActionCaller; id: string };

const token = (
  status: ShareTokenFacts['attributes']['status'],
  more: Partial<ShareTokenFacts['attributes']> = {},
): ShareTokenFacts => ({
  id: TOKEN,
  attributes: {
    status,
    'expires-at': EXPIRES_AT,
    'redeem-mode': null,
    'expiry-reason': null,
    ...more,
  },
});

/** A fake of the services: records each call, writes one row, and answers or refuses. */
function fakeServices() {
  const calls: Call[] = [];
  let refusal: Error | null = null;
  const write = async (tx: Db, name: string) => {
    await tx.execute(sql`insert into connect_action_fake_effects (name) values (${name})`);
  };
  const answer = async (tx: Db, call: Call, facts: ShareTokenFacts) => {
    calls.push(call);
    await write(tx, call.name);
    if (refusal !== null) {
      throw refusal;
    }
    return { token: facts };
  };
  const port: ConnectActionPort = {
    createShareToken: (tx, caller, body) =>
      answer(tx, { name: 'create', caller, body }, token('created')),
    redeemShareToken: (tx, caller, id, body) =>
      answer(
        tx,
        { name: 'redeem', caller, id, body },
        token('pending', {
          'redeem-mode':
            body.data?.attributes['destination-id'] === undefined ? 'clone' : 'hydrate',
        }),
      ),
    expireShareToken: (tx, caller, id) =>
      answer(
        tx,
        { name: 'expire', caller, id },
        token('expired', { 'expiry-reason': 'source_expired' }),
      ),
  };
  return {
    port,
    calls,
    refuse: (error: Error | null) => {
      refusal = error;
    },
  };
}

let harness: ActionHarness;
let fake: ReturnType<typeof fakeServices>;
const enqueued: ConnectRedeemJob[] = [];

const tableWith = (handlers: readonly ActionHandler[]) =>
  createActionHandlerTable([RUN_WORKFLOW_HANDLER, ...OBJECT_ACTION_HANDLERS, ...handlers]);

const servicesOf = () => harness.services as unknown as Record<string, unknown>;

beforeAll(async () => {
  harness = await createActionHarness();
  await harness.database.client.query(
    'create table connect_action_fake_effects (id serial primary key, name text not null)',
  );
}, 120_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  fake = fakeServices();
  enqueued.length = 0;
  useHandlers(harness, tableWith(createConnectActionHandlers(fake.port)));
  Object.assign(servicesOf(), {
    connect: { enabled: true },
    connectRedeems: {
      enqueueConnectRedeem: (job: ConnectRedeemJob) => {
        enqueued.push(job);
        return Promise.resolve();
      },
    },
  });
});

const effects = async (): Promise<number> =>
  (
    await harness.database.client.query<{ count: number }>(
      'select count(*)::int as count from connect_action_fake_effects',
    )
  ).rows[0]?.count ?? 0;

async function run(key: string, config: Record<string, unknown>, more = {}) {
  const ran = await harness.run(chain([action('step', key, config)]), {
    grant: CONNECT_GRANT,
    ...more,
  });
  const step = await stepOf(harness, ran.id, 'step');
  return { ...ran, step, output: await stepOutputOf(harness, ran.id) };
}

const CREATE = {
  'connection-id': CONNECTION,
  'source-id': SOURCE,
  'consent-record-id': CONSENT,
};
const REDEEM = {
  'share-token-id': TOKEN,
  meta: {
    'inquiry-template-id': TEMPLATE,
    'destination-consent-record-id': DESTINATION_CONSENT,
  },
};

describe('create_share_token (C243.1, C232.1)', () => {
  it('creates the token through the service, the run as its actor, and outputs it', async () => {
    const ran = await run('create_share_token', { ...CREATE, 'expires-in-seconds': 86_400 });

    expect(ran.status).toBe('completed');
    expect(ran.output).toEqual({
      'share-token-id': TOKEN,
      status: 'created',
      'expires-at': EXPIRES_AT,
    });
    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(call?.name).toBe('create');
    expect(call?.caller.acting.actor).toEqual({ type: 'workflow-run', id: ran.id });
    expect(call?.caller.acting.ctx.environmentId).toBe(harness.environmentId);
    expect(call?.name === 'create' ? call.body : null).toEqual({
      data: {
        type: 'connect/share-token',
        attributes: { ...CREATE, 'expires-in-seconds': 86_400 },
      },
    });
  });

  it('reads its ids and its lifetime from references', async () => {
    const ran = await run(
      'create_share_token',
      {
        'connection-id': '{{inputs.connection}}',
        'source-id': '{{trigger.id}}',
        'consent-record-id': '{{inputs.consent}}',
        'expires-in-seconds': '{{inputs.seconds}}',
      },
      {
        trigger: { id: SOURCE, status: 'approved' },
        inputs: { connection: CONNECTION, consent: CONSENT, seconds: '3600' },
      },
    );

    expect(ran.status).toBe('completed');
    expect(fake.calls[0]?.name === 'create' ? fake.calls[0].body.data.attributes : null).toEqual({
      ...CREATE,
      'expires-in-seconds': 3_600,
    });
  });

  it('leaves the lifetime to the service when the step names none', async () => {
    await run('create_share_token', CREATE);

    expect(fake.calls[0]?.name === 'create' ? fake.calls[0].body.data.attributes : null).toEqual(
      CREATE,
    );
  });

  it.each([
    ['a connection id of another kind', { ...CREATE, 'connection-id': SOURCE }],
    ['a consent record id of another kind', { ...CREATE, 'consent-record-id': SOURCE }],
    ['a lifetime under a minute', { ...CREATE, 'expires-in-seconds': '59' }],
    ['a lifetime that is no number', { ...CREATE, 'expires-in-seconds': 'soon' }],
  ])('refuses %s as action_input_invalid, calling nothing', async (_name, config) => {
    const ran = await run('create_share_token', config);

    expect(ran.step.errorCode).toBe('action_input_invalid');
    expect(fake.calls).toEqual([]);
  });

  it.each([
    ['consent_required', 'missing'],
    ['connection_not_active', undefined],
    ['source_is_copy', undefined],
    ['share_token_outlives_consent', undefined],
  ] as const)(
    'surfaces the service’s %s as the step error, and writes nothing',
    async (code, reason) => {
      fake.refuse(
        new ConnectProblemError(code, 'A synthetic refusal.', {
          ...(reason === undefined ? {} : { reason }),
        }),
      );
      const before = await effects();
      const ran = await run('create_share_token', CREATE);

      expect(ran.step.errorCode).toBe(code);
      expect(ran.output).toEqual({ code, ...(reason === undefined ? {} : { reason }) });
      expect(await effects()).toBe(before);
    },
  );

  it('answers the one 404 of an unseen object as object_not_found', async () => {
    fake.refuse(connectNotFound());
    const ran = await run('create_share_token', CREATE);

    expect(ran.step.errorCode).toBe('object_not_found');
  });
});

describe('redeem_share_token (C243.1, C243.4, C234.1)', () => {
  it('redeems through the service with the redeem body and enqueues the job after the commit', async () => {
    const ran = await run('redeem_share_token', REDEEM);

    expect(ran.status).toBe('completed');
    expect(ran.output).toEqual({
      'share-token-id': TOKEN,
      status: 'pending',
      'redeem-mode': 'clone',
    });
    const [call] = fake.calls;
    expect(call?.name === 'redeem' ? [call.id, call.body] : null).toEqual([
      TOKEN,
      { meta: REDEEM.meta },
    ]);
    expect(call?.caller.acting.actor).toEqual({ type: 'workflow-run', id: ran.id });
    expect(enqueued).toEqual([{ environmentId: harness.environmentId, shareTokenId: TOKEN }]);
  });

  it('hydrates with a destination and its field mappings', async () => {
    const account = 'acc_01M5CN0000000000000011W700';
    const mappings = [
      { 'source-field-name': 'name-first', 'destination-field-name': 'name.given' },
    ];
    const ran = await run(
      'redeem_share_token',
      {
        'share-token-id': '{{trigger.id}}',
        'destination-id': account,
        meta: {
          'field-mappings': mappings,
          'destination-consent-record-id': DESTINATION_CONSENT,
        },
      },
      { trigger: { id: TOKEN, status: 'created' } },
    );

    expect(ran.output).toEqual({
      'share-token-id': TOKEN,
      status: 'pending',
      'redeem-mode': 'hydrate',
    });
    expect(fake.calls[0]?.name === 'redeem' ? fake.calls[0].body : null).toEqual({
      data: { attributes: { 'destination-id': account } },
      meta: { 'field-mappings': mappings, 'destination-consent-record-id': DESTINATION_CONSENT },
    });
  });

  it('refuses a destination consent the service does not accept, enqueuing nothing (C243.4)', async () => {
    fake.refuse(
      new ConnectProblemError('consent_required', 'A synthetic refusal.', { reason: 'subject' }),
    );
    const before = await effects();
    const ran = await run('redeem_share_token', REDEEM);

    expect(ran.step.errorCode).toBe('consent_required');
    expect(ran.output).toEqual({ code: 'consent_required', reason: 'subject' });
    expect(enqueued).toEqual([]);
    expect(await effects()).toBe(before);
  });

  it('refuses a step with no destination consent record before any service (C243.4)', async () => {
    const ran = await run('redeem_share_token', { 'share-token-id': TOKEN, meta: {} });

    expect(ran.step.errorCode).toBe('action_input_invalid');
    expect(fake.calls).toEqual([]);
  });

  it('answers share_redeem_meta_conflict with its pointers, calling nothing', async () => {
    const ran = await run('redeem_share_token', {
      ...REDEEM,
      'destination-id': 'inq_01M5CN0000000000000011W800',
      meta: { ...REDEEM.meta, 'account-id': 'acc_01M5CN0000000000000011W700' },
    });

    expect(ran.step.errorCode).toBe('share_redeem_meta_conflict');
    expect(ran.output).toEqual({
      code: 'share_redeem_meta_conflict',
      pointers: ['/meta/account-id'],
    });
    expect(fake.calls).toEqual([]);
  });

  it('refuses an id that is no share token as action_input_invalid', async () => {
    const ran = await run('redeem_share_token', { ...REDEEM, 'share-token-id': SOURCE });

    expect(ran.step.errorCode).toBe('action_input_invalid');
    expect(fake.calls).toEqual([]);
  });

  it('fails closed, writing nothing, when the worker has no redemption producer', async () => {
    delete servicesOf().connectRedeems;
    const ran = await run('redeem_share_token', REDEEM);

    expect(ran.step.errorCode).toBe('provider_not_configured');
    expect(fake.calls).toEqual([]);
  });
});

describe('expire_share_token (C243.1, C232.4)', () => {
  it('expires the token through the service and outputs its reason', async () => {
    const ran = await run('expire_share_token', { 'share-token-id': TOKEN });

    expect(ran.status).toBe('completed');
    expect(ran.output).toEqual({
      'share-token-id': TOKEN,
      status: 'expired',
      'expiry-reason': 'source_expired',
    });
    expect(fake.calls[0]?.name === 'expire' ? fake.calls[0].id : null).toBe(TOKEN);
  });

  it('surfaces share_token_not_expirable', async () => {
    fake.refuse(new ConnectProblemError('share_token_not_expirable', 'A synthetic refusal.'));
    const ran = await run('expire_share_token', { 'share-token-id': TOKEN });

    expect(ran.step.errorCode).toBe('share_token_not_expirable');
  });
});

describe('every Connect step', () => {
  const steps: readonly [string, Record<string, unknown>][] = [
    ['create_share_token', CREATE],
    ['redeem_share_token', REDEEM],
    ['expire_share_token', { 'share-token-id': TOKEN }],
  ];

  it.each(steps)(
    '%s answers the one 404 while the install keeps Connect off (C231.10)',
    async (key, config) => {
      Object.assign(servicesOf(), { connect: { enabled: false } });
      const ran = await run(key, config);

      expect(ran.step.errorCode).toBe('object_not_found');
      expect(fake.calls).toEqual([]);
      expect(enqueued).toEqual([]);
    },
  );

  it.each(steps)('%s needs its scope in the run grant', async (key, config) => {
    const ran = await run(key, config, { grant: EVERY_GRANT });

    expect(ran.step.errorCode).toBe('run_grant_insufficient');
    expect(fake.calls).toEqual([]);
  });

  it.each(steps)('%s ends not_implemented while its service is not built', async (key, config) => {
    useHandlers(harness, tableWith(createConnectActionHandlers(NOT_BUILT)));
    const ran = await run(key, config);

    expect(ran.step.errorCode).toBe('not_implemented');
  });

  it('ends a service that is not built as not_implemented, not as a refusal', async () => {
    fake.refuse(new NotImplementedError('A synthetic stub.'));
    const ran = await run('expire_share_token', { 'share-token-id': TOKEN });

    expect(ran.step.errorCode).toBe('not_implemented');
  });

  it.each(steps)(
    '%s is exactly once: a lost claim rolls the write back, and a repeated job writes nothing',
    async (key, config) => {
      const real = createConnectActionHandlers(fake.port).find(
        (handler): handler is TransactionActionHandler =>
          handler.key === key && handler.shape === 'transaction',
      );
      if (real === undefined) {
        throw new Error(`${key} has no transaction handler`);
      }
      const losing: TransactionActionHandler = {
        ...real,
        execute: async (tx, context) => {
          const result = await real.execute(tx, context);
          await tx.execute(
            sql`update workflow_run_steps set status = 'ready', claimed_by = null,
              claimed_until = null where id = ${context.stepId}`,
          );
          return result;
        },
      };
      const before = await effects();
      useHandlers(harness, tableWith([losing]));
      const runId = await start(harness, chain([action('step', key, config)]), {
        grant: CONNECT_GRANT,
      });
      const job = harness.steps.jobs.shift()?.job;
      if (job === undefined) {
        throw new Error('no step job');
      }
      await processWorkflowStep(job, harness.deps);
      useHandlers(harness, tableWith(createConnectActionHandlers(fake.port)));

      expect(await effects(), `${key}: the lost attempt left nothing`).toBe(before);
      expect(await effectsOf(harness, runId), key).toEqual([]);
      const lost = enqueued.length;
      expect(lost, key).toBe(key === 'redeem_share_token' ? 1 : 0);

      const step = await stepOf(harness, runId, 'step');
      await harness.database.client.query(
        `update workflow_run_steps set status = 'ready', claimed_by = null, claimed_until = null,
           due_at = now() where id = $1`,
        [step.id],
      );
      await processWorkflowStep({ ...job, stepId: step.id }, harness.deps);
      expect((await runOf(harness, runId)).status, key).toBe('completed');
      expect(await effects(), `${key}: the next attempt wrote it`).toBe(before + 1);
      await processWorkflowStep({ ...job, stepId: step.id }, harness.deps);
      expect(await effects(), `${key}: a repeated job wrote nothing`).toBe(before + 1);
      expect(
        (await effectsOf(harness, runId)).map(({ status }) => status),
        key,
      ).toEqual(['done']);
      expect(enqueued.length - lost, `${key}: the committed attempt enqueued its job once`).toBe(
        key === 'redeem_share_token' ? 1 : 0,
      );
    },
  );
});
