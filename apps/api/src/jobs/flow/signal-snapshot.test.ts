/**
 * C150.9 (Workflow 9A, `api-flow-actions`; V06, V09): the `flow-signal-snapshot` job for one branch
 * entry, under the inquiry's row lock:
 * - computes the named `flow-provisional` signals with Phase 7's own computation over the session
 *   facts stored so far, and writes each once with its value, tier and stage, or `null` with its
 *   reason; a signal that is not flow-provisional is never computed here;
 * - a client-collected signal whose session has sent no payload yet reads `not_yet_collected`
 *   (Phase 7's `collector_missing` would flag every early inquiry for review), so a branch right
 *   after consent follows the route's own `onNull`; a server signal never does;
 * - once every named signal is written it advances the branch (`signal-snapshot-written`);
 * - a snapshot arriving after the branch's wait ended, or for a redacted inquiry, writes nothing.
 * The engine's `advanceFlowInTx` (`api-flow-engine`) is replaced by a recorder.
 *
 * Every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  appendInquiryFlowStepInTx,
  createInquirySession,
  exitInquiryFlowStepInTx,
  listInquiryFlowSignalSnapshots,
  recordInquirySessionConsent,
  setInquiryFlowPositionInTx,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedSessionSignalBody,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceFlowInTx, type FlowExit } from '../../flow-engine/advance.js';
import { createRecordingEventPublisher, fixedClock } from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import { processFlowSignalSnapshot, type FlowSignalSnapshotDeps } from './signal-snapshot.js';

vi.mock('../../flow-engine/advance.js', () => ({
  advanceFlowInTx: vi.fn(() => Promise.resolve({ staged: [], after: [] })),
  runFlowAfterCommit: async (advance: { after?: readonly (() => Promise<void>)[] } | null) => {
    for (const run of advance?.after ?? []) {
      await run();
    }
  },
  NO_FLOW_ADVANCE: { staged: [], after: [] },
}));

const advance = vi.mocked(advanceFlowInTx);
const BOT = 'inquiry/bot_score';
const SESSIONS = 'inquiry/session_count';

let database: TestDatabase;
let environmentId: string;
let deps: FlowSignalSnapshotDeps;
const clock = fixedClock();

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
  deps = {
    db: database.db,
    clock,
    logger: createCapturingLogger(),
    events: createRecordingEventPublisher(),
    keyring: database.keyring,
  };
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  advance.mockClear();
});

/** consent -> signals_check (waits for `names`) -> review_path | done. */
const flowWaitingFor = (names: readonly string[]) =>
  flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'snapshot', version: 1, name: 'Snapshot' },
    entry: 'consent',
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
      {
        id: 'signals_check',
        type: 'branch',
        routes: [
          {
            key: 'bot',
            label: 'Likely a bot',
            condition: { '>': [{ var: `signals.${BOT}` }, 50] },
            onNull: 'else',
          },
        ],
        waitFor: { facts: names.map((name) => `signals.${name}`), maxSeconds: 10 },
      },
      { id: 'review_path', type: 'completion' },
      { id: 'done', type: 'completion' },
    ],
    edges: [
      { id: 'e1', from: 'consent', port: 'next', to: 'signals_check' },
      { id: 'e2', from: 'signals_check', port: 'route:bot', to: 'review_path' },
      { id: 'e3', from: 'signals_check', port: 'else', to: 'done' },
    ],
  });

/**
 * An inquiry right after consent: one session that consented and collects session integrity,
 * the consent step exited, and the position waiting at the branch's entry.
 */
async function waitingAfterConsent(names: readonly string[]) {
  const { inquiry } = await createTestInquiry(database.db, environmentId, {
    flow: flowWaitingFor(names) as unknown as Record<string, unknown>,
  });
  const session = await createInquirySession(database.db, environmentId, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await database.client.query(
    `update inquiry_sessions set signals_collected = '{session-integrity}' where id = $1`,
    [session.id],
  );
  await recordInquirySessionConsent(database.db, environmentId, session.id, {
    acceptedAt: clock.now(),
    textKeys: ['consent.processing'],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  const seq = await database.db.transaction(async (tx) => {
    const consent = await appendInquiryFlowStepInTx(tx, environmentId, {
      inquiryId: inquiry.id,
      stepId: 'consent',
      stepType: 'consent',
      enteredAt: clock.now(),
    });
    await exitInquiryFlowStepInTx(tx, environmentId, inquiry.id, consent.seq, {
      exitedAt: clock.now(),
      exitPort: 'next',
      outcome: 'recorded',
      sensitive: false,
    });
    const branch = await appendInquiryFlowStepInTx(tx, environmentId, {
      inquiryId: inquiry.id,
      stepId: 'signals_check',
      stepType: 'branch',
      enteredAt: clock.now(),
    });
    await setInquiryFlowPositionInTx(tx, environmentId, inquiry.id, {
      stepId: 'signals_check',
      state: 'waiting',
      previousStepId: 'consent',
      specVersion: 2,
    });
    return branch.seq;
  });
  return { inquiryId: inquiry.id, sessionId: session.id, seq };
}

const snapshotsOf = async (inquiryId: string, seq: number) =>
  (
    await listInquiryFlowSignalSnapshots(database.db, environmentId, {
      inquiryId,
      stepRecordSeq: seq,
    })
  )
    .map(({ name, value, tier, stage, nullReason }) => ({ name, value, tier, stage, nullReason }))
    .sort((a, b) => a.name.localeCompare(b.name));

const exitsOf = (inquiryId: string): FlowExit[] =>
  advance.mock.calls
    .filter(([, , inquiry]) => inquiry.inquiryId === inquiryId)
    .map(([, , , exit]) => exit);

const snapshot = (inquiryId: string, seq: number, names: readonly string[]) =>
  processFlowSignalSnapshot({ environmentId, inquiryId, stepRecordSeq: seq, names }, deps);

describe('the provisional snapshot of a branch entry (C150.9)', () => {
  it('reads not_yet_collected before the first payload, so the route’s onNull decides (V06)', async () => {
    const { inquiryId, seq } = await waitingAfterConsent([BOT, SESSIONS]);
    expect(await snapshot(inquiryId, seq, [BOT, SESSIONS])).toEqual({
      outcome: 'written',
      written: 2,
    });
    expect(await snapshotsOf(inquiryId, seq)).toEqual([
      { name: BOT, value: null, tier: 'H', stage: 'beta', nullReason: 'not_yet_collected' },
      { name: SESSIONS, value: 1, tier: 'R', stage: 'ga', nullReason: null },
    ]);
    expect(exitsOf(inquiryId)).toEqual([{ kind: 'signal-snapshot-written', stepRecordSeq: seq }]);
  });

  it('computes a client-collected signal from the payloads stored so far', async () => {
    const { inquiryId, sessionId, seq } = await waitingAfterConsent([BOT]);
    await seedSessionSignalBody(database.db, environmentId, {
      inquirySessionId: sessionId,
      screen: 'consent',
      components: { 'sandbox-outcome': 'human' },
      behaviour: null,
    });
    await snapshot(inquiryId, seq, [BOT]);
    const [bot] = await snapshotsOf(inquiryId, seq);
    expect(bot?.name).toBe(BOT);
    // A sandbox body's outcome scores the session (C90.9): a value, from the payload stored.
    expect(bot).toMatchObject({ tier: 'H', stage: 'beta', nullReason: null });
    expect(typeof bot?.value).toBe('number');
  });

  it('writes each name once, keeping the first value', async () => {
    const { inquiryId, sessionId, seq } = await waitingAfterConsent([BOT]);
    await snapshot(inquiryId, seq, [BOT]);
    await seedSessionSignalBody(database.db, environmentId, {
      inquirySessionId: sessionId,
      components: { 'sandbox-outcome': 'bot' },
      behaviour: null,
    });
    expect(await snapshot(inquiryId, seq, [BOT])).toEqual({ outcome: 'written', written: 0 });
    expect(await snapshotsOf(inquiryId, seq)).toMatchObject([
      { name: BOT, nullReason: 'not_yet_collected' },
    ]);
  });

  it('never computes a signal that is not flow-provisional, and waits for the rest', async () => {
    const { inquiryId, seq } = await waitingAfterConsent([SESSIONS, 'inquiry/country_comparison']);
    expect(
      await snapshot(inquiryId, seq, [SESSIONS, 'inquiry/country_comparison', 'not/a-signal']),
    ).toEqual({ outcome: 'written', written: 1 });
    expect((await snapshotsOf(inquiryId, seq)).map(({ name }) => name)).toEqual([SESSIONS]);
    expect(exitsOf(inquiryId)).toEqual([]);
  });

  it('writes nothing once the branch’s wait has ended, or for a redacted inquiry', async () => {
    const ended = await waitingAfterConsent([SESSIONS]);
    await database.db.transaction((tx) =>
      setInquiryFlowPositionInTx(tx as Db, environmentId, ended.inquiryId, {
        stepId: 'done',
        state: 'ended',
        previousStepId: 'signals_check',
        specVersion: 2,
      }),
    );
    expect(await snapshot(ended.inquiryId, ended.seq, [SESSIONS])).toEqual({
      outcome: 'skipped',
      written: 0,
    });
    const redacted = await waitingAfterConsent([SESSIONS]);
    await database.client.query(`update inquiries set redacted_at = now() where id = $1`, [
      redacted.inquiryId,
    ]);
    expect(await snapshot(redacted.inquiryId, redacted.seq, [SESSIONS])).toEqual({
      outcome: 'skipped',
      written: 0,
    });
    expect(await snapshotsOf(ended.inquiryId, ended.seq)).toEqual([]);
    expect(await snapshotsOf(redacted.inquiryId, redacted.seq)).toEqual([]);
    expect([...exitsOf(ended.inquiryId), ...exitsOf(redacted.inquiryId)]).toEqual([]);
  });
});
