/**
 * Workflow 7A Stage 3 (`api-signals`; C90.2-C90.5, C90.7, C90.9, owner decision 5 after 6C): the
 * `inquiry-signals` job and its sweep.
 *
 * - The job freezes every collected signal of a pending outbox row, in registry order, with its
 *   `signal-details` (valid by the contract's schema and refinements), and marks the row computed;
 *   a second run finds nothing pending. An inquiry with no session reads `signals_not_collected`.
 * - The sandbox outcome of a consented session's body sets the behaviour signals.
 * - `on-signal: needs_review` moves a `completed` inquiry to `needs_review` once, when a rule
 *   matches a value (`signal_rule`) or an unevaluated value whose `on-null` says so
 *   (`signal_unevaluated`); `on-null: ignore` leaves it; a decided inquiry stays as it is
 *   (`inquiry_already_decided`); with `on-signal: none` nothing is recorded about review.
 * - An inquiry redacted after its row was written is skipped: nothing computed, never moved.
 * - The sweep enqueues the pending rows not enqueued recently, once each, and skips the rows of
 *   redacted inquiries.
 *
 * Every body is synthetic; no address is read.
 */
import {
  defaultInquiryTemplateAttributes,
  signalAttributeIssues,
  signalDetailsSchema,
  type CreateInquiryTemplateAttributes,
  type SignalConfig,
  type SignalDetails,
  type SignalValue,
} from '@openverify/contracts';
import { SIGNAL_NAMES } from '@openverify/core';
import {
  createInquirySession,
  getInquiry,
  hashSessionToken,
  recordInquirySessionConsent,
  redactInquiryRecords,
} from '@openverify/db';
import { seedSessionSignalBody, testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { createRecordingInquirySignalsQueue } from '../../test-support/fakes.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  resumeInquiry,
} from '../../test-support/harness.js';
import { createCapturingLogger } from '../testing.js';
import { processInquirySignals, type InquirySignalsDeps } from './process.js';
import { runInquirySignalsSweep } from './sweep.js';

let api: InquiryTestApi;
let deps: InquirySignalsDeps;

beforeAll(async () => {
  api = await createInquiryTestApi();
  deps = {
    db: api.database.db,
    clock: api.clock,
    logger: createCapturingLogger(),
    events: api.events,
    keyring: api.database.keyring,
  };
});

afterAll(async () => {
  await api.close();
});

const NOTICE = 'notice.session-integrity';

function templateWithNotice(): CreateInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  attributes.flow.steps = attributes.flow.steps.map((step) =>
    step.type === 'consent' ? { ...step, textKeys: ['consent.processing', NOTICE] } : step,
  );
  return attributes;
}

const simulate = (id: string, types: readonly string[]) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${id}/perform-simulate-actions`,
    headers: bearer(api.token),
    payload: { meta: { actions: types.map((type) => ({ type })) } },
  });

async function setSignalConfig(inquiryId: string, config: SignalConfig) {
  await api.database.client.query(
    `update inquiry_template_versions set signal_config = $1
      where id = (select inquiry_template_version_id from inquiries where id = $2)`,
    [JSON.stringify(config), inquiryId],
  );
}

/**
 * A completed inquiry whose one session consented and sent a sandbox `outcome` body. The session
 * starts from a documentation address, which no loaded network data covers here (a data gap).
 */
async function completedWithBody(outcome: 'bot' | 'human', config: SignalConfig = {}) {
  const templateId = await createTemplate(api, api.token, templateWithNotice());
  const inquiryId = await createInquiry(api, { templateId });
  await setSignalConfig(inquiryId, config);
  const sessionToken = await resumeInquiry(api, inquiryId);
  const headers = bearer(sessionToken);
  expectStatus(
    await api.app.inject({
      method: 'GET',
      url: '/api/v1/flow/session',
      headers,
      remoteAddress: '203.0.113.70',
    }),
    200,
  );
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers,
      payload: { accepted: true, 'text-keys': ['consent.processing', NOTICE], locale: 'en' },
    }),
    201,
  );
  expectStatus(await api.app.inject({ method: 'GET', url: '/api/v1/flow/session', headers }), 200);
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/signals',
      headers,
      payload: {
        platform: 'web',
        'collector-version': 1,
        screen: 'consent',
        sequence: 0,
        'sandbox-outcome': outcome,
      },
    }),
    202,
  );
  expectStatus(await simulate(inquiryId, ['complete_inquiry']), 200);
  return inquiryId;
}

const run = (inquiryId: string, environmentId = api.environmentId) =>
  processInquirySignals({ environmentId, inquiryId }, deps);

async function stateOf(inquiryId: string) {
  const { rows } = await api.database.client.query<{ state: string }>(
    'select state from inquiry_signal_computations where inquiry_id = $1',
    [inquiryId],
  );
  return rows[0]?.state;
}

async function frozen(inquiryId: string) {
  const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
  return {
    status: inquiry?.status,
    signals: inquiry?.signals as SignalValue[] | null,
    details: inquiry?.signalDetails as SignalDetails | null,
  };
}

const valueOf = (signals: SignalValue[] | null, name: string) =>
  signals?.find((signal) => signal.name === name)?.value;

describe('processInquirySignals (C90.2-C90.5)', () => {
  it('freezes every default signal of an inquiry without a session as not collected, once', async () => {
    const inquiryId = await createInquiry(api);
    expectStatus(await simulate(inquiryId, ['expire_inquiry']), 200);

    const result = await run(inquiryId);

    // Workflow 10B: the five device-integrity signals join the defaults (C210.4, C211.5).
    expect(result).toEqual({ outcome: 'computed', signals: 18, markedForReview: false });
    const { signals, details } = await frozen(inquiryId);
    expect(signals?.map((signal) => signal.name)).toEqual(
      SIGNAL_NAMES.filter((name) => name !== 'inquiry/list_match_count'),
    );
    expect(valueOf(signals, 'inquiry/session_count')).toBe(0);
    expect(valueOf(signals, 'inquiry/tor_detected')).toBeNull();
    expect(details?.['inquiry/tor_detected']).toMatchObject({
      'null-reason': 'signals_not_collected',
    });
    expect(details?.['computed-at']).toBe(api.clock.now().toISOString());
    expect(details).not.toHaveProperty('review');
    const checked = signalDetailsSchema.parse(details) as SignalDetails;
    expect(signalAttributeIssues(signals ?? [], checked)).toEqual([]);
    expect(await stateOf(inquiryId)).toBe('computed');
    expect(await run(inquiryId)).toEqual({
      outcome: 'not_pending',
      signals: 0,
      markedForReview: false,
    });
  });

  it('serves the frozen values on the inquiry', async () => {
    const inquiryId = await createInquiry(api);
    expectStatus(await simulate(inquiryId, ['expire_inquiry']), 200);
    await run(inquiryId);
    const document = expectStatus(
      await api.app.inject({
        method: 'GET',
        url: `/api/v1/inquiries/${inquiryId}`,
        headers: bearer(api.token),
      }),
      200,
    );
    const { signals } = await frozen(inquiryId);
    // C99.4: the count is merged when served, and read `null` with no list selected.
    expect(document.data.attributes.signals).toEqual([
      ...(signals ?? []),
      { name: 'inquiry/list_match_count', value: null },
    ]);
  });

  it('reads a consented session’s sandbox outcome into the behaviour signals', async () => {
    const inquiryId = await completedWithBody('bot');
    await run(inquiryId);
    const { signals, details, status } = await frozen(inquiryId);
    expect(valueOf(signals, 'inquiry/bot_score')).toBe(95);
    expect(valueOf(signals, 'inquiry/behavior_threat_level')).toBe('high');
    expect(valueOf(signals, 'inquiry/session_count')).toBe(1);
    expect(details?.['inquiry/bot_score']).toMatchObject({
      confidence: 1,
      reasons: expect.arrayContaining(['sandbox_outcome']) as unknown,
    });
    expect(status).toBe('completed');
    signalDetailsSchema.parse(details);
  });
});

describe('whose behaviour counts (C90.4, V03, V07)', () => {
  it('reads no body of a handoff session without its own consent, nor of a rejected one', async () => {
    for (const rejected of [false, true]) {
      const inquiryId = await completedWithBody('human');
      const { rows: desktop } = await api.database.client.query<{ id: string }>(
        'select id from inquiry_sessions where inquiry_id = $1',
        [inquiryId],
      );
      // A completed inquiry opens no session, so the phone's row is written as a redemption would.
      const phoneId = testId('iqse');
      await createInquirySession(api.database.db, api.environmentId, {
        id: phoneId,
        inquiryId,
        tokenHash: hashSessionToken(`ovs_${phoneId}`),
        expiresAt: new Date(api.clock.now().getTime() + 3_600_000),
      });
      await api.database.client.query(
        `update inquiry_sessions set handoff_from_session_id = $1, device_handoff_method = 'qr',
           handoff_redeemed_at = now(), signals_collected = '{session-integrity}' where id = $2`,
        [desktop[0]?.id ?? '', phoneId],
      );
      if (rejected) {
        // Its own consent, then the desktop's "this was not me": it authorises nothing.
        await recordInquirySessionConsent(api.database.db, api.environmentId, phoneId, {
          acceptedAt: api.clock.now(),
          textKeys: ['consent.processing', NOTICE],
          locale: 'en',
          ip: null,
          userAgent: null,
        });
        await api.database.client.query(
          'update inquiry_sessions set handoff_rejected_at = now() where id = $1',
          [phoneId],
        );
      }
      await seedSessionSignalBody(api.database.db, api.environmentId, {
        inquirySessionId: phoneId,
        components: { 'sandbox-outcome': 'bot' },
        behaviour: null,
      });
      await run(inquiryId);
      const { signals, details } = await frozen(inquiryId);
      expect(valueOf(signals, 'inquiry/bot_score')).toBe(5);
      expect(valueOf(signals, 'inquiry/session_count')).toBe(2);
      signalDetailsSchema.parse(details);
    }
  });
});

describe('the on-signal rule (C90.7)', () => {
  it('moves a completed inquiry to needs_review once when a rule matches a value', async () => {
    const inquiryId = await completedWithBody('bot', {
      'on-signal': 'needs_review',
      'review-rules': [
        { signal: 'inquiry/bot_score', lte: 10 },
        { signal: 'inquiry/bot_score', gte: 90 },
      ],
    });
    const before = api.events.named('inquiry.marked-for-review').length;
    expect(await run(inquiryId)).toMatchObject({ outcome: 'computed', markedForReview: true });
    const { status, details } = await frozen(inquiryId);
    expect(status).toBe('needs_review');
    expect(details?.review).toEqual({ cause: 'signal_rule', rules: [1] });
    expect(api.events.named('inquiry.marked-for-review')).toHaveLength(before + 1);
  });

  it('leaves it completed when no rule matches', async () => {
    const inquiryId = await completedWithBody('human', {
      'on-signal': 'needs_review',
      'review-rules': [{ signal: 'inquiry/bot_score', gte: 90 }],
    });
    expect(await run(inquiryId)).toMatchObject({ markedForReview: false });
    const { status, details } = await frozen(inquiryId);
    expect(status).toBe('completed');
    expect(details).not.toHaveProperty('review');
  });

  it('sends an unevaluated value to review by its reason’s default, and not with on-null: ignore', async () => {
    // The harness loads no network data: tor_detected is null with a data gap
    // (`list_unavailable`), whose on-null default is needs_review.
    const gap = await completedWithBody('human', {
      'on-signal': 'needs_review',
      'review-rules': [{ signal: 'inquiry/tor_detected', eq: true }],
    });
    await run(gap);
    expect((await frozen(gap)).details?.['inquiry/tor_detected']).toMatchObject({
      'null-reason': 'list_unavailable',
    });
    expect((await frozen(gap)).status).toBe('needs_review');
    expect((await frozen(gap)).details?.review).toEqual({
      cause: 'signal_unevaluated',
      rules: [0],
    });

    const ignored = await completedWithBody('human', {
      'on-signal': 'needs_review',
      'review-rules': [{ signal: 'inquiry/tor_detected', eq: true, 'on-null': 'ignore' }],
    });
    await run(ignored);
    expect((await frozen(ignored)).status).toBe('completed');
  });

  it('leaves a decided inquiry as it is and records inquiry_already_decided', async () => {
    const inquiryId = await completedWithBody('bot', {
      'on-signal': 'needs_review',
      'review-rules': [{ signal: 'inquiry/bot_score', gte: 90 }],
    });
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${inquiryId}/approve`,
        headers: bearer(api.token),
      }),
      200,
    );
    expect(await run(inquiryId)).toMatchObject({ markedForReview: false });
    const { status, details } = await frozen(inquiryId);
    expect(status).toBe('approved');
    expect(details?.review).toEqual({ cause: 'inquiry_already_decided', rules: [0] });
  });

  it('records nothing about review with on-signal: none', async () => {
    const inquiryId = await completedWithBody('bot', {
      'review-rules': [{ signal: 'inquiry/bot_score', gte: 90 }],
    });
    await run(inquiryId);
    const { status, details } = await frozen(inquiryId);
    expect(status).toBe('completed');
    expect(details).not.toHaveProperty('review');
  });
});

describe('a redacted inquiry (owner decision 5 after Workflow 6C)', () => {
  it('is skipped when redacted after its row was written: nothing computed, never moved', async () => {
    const inquiryId = await completedWithBody('bot', {
      'on-signal': 'needs_review',
      'review-rules': [{ signal: 'inquiry/bot_score', gte: 90 }],
    });
    await redactInquiryRecords(api.database.db, api.environmentId, inquiryId);
    expect(await run(inquiryId)).toEqual({
      outcome: 'skipped',
      signals: 0,
      markedForReview: false,
    });
    const { status, signals } = await frozen(inquiryId);
    expect(status).toBe('completed');
    expect(signals).toBeNull();
    expect(await stateOf(inquiryId)).toBe('skipped');
  });
});

describe('runInquirySignalsSweep (C90.5)', () => {
  it('enqueues each pending row once within the window, and skips a redacted inquiry’s row', async () => {
    const tenant = await api.newTenant();
    const pending = await createInquiry(api, { token: tenant.token });
    const redacted = await createInquiry(api, { token: tenant.token });
    for (const id of [pending, redacted]) {
      expectStatus(
        await api.app.inject({
          method: 'POST',
          url: `/api/v1/inquiries/${id}/perform-simulate-actions`,
          headers: bearer(tenant.token),
          payload: { meta: { actions: [{ type: 'expire_inquiry' }] } },
        }),
        200,
      );
    }
    await redactInquiryRecords(api.database.db, tenant.environmentId, redacted);
    const signals = createRecordingInquirySignalsQueue();
    const sweep = () =>
      runInquirySignalsSweep({
        db: api.database.db,
        clock: api.clock,
        logger: createCapturingLogger(),
        signals,
      });

    const first = await sweep();
    const ours = () => signals.jobs.filter((job) => job.environmentId === tenant.environmentId);
    expect(ours()).toEqual([{ environmentId: tenant.environmentId, inquiryId: pending }]);
    expect(first.enqueued).toBeGreaterThanOrEqual(1);
    const { rows } = await api.database.client.query<{ state: string }>(
      'select state from inquiry_signal_computations where inquiry_id = $1',
      [redacted],
    );
    expect(rows[0]?.state).toBe('skipped');

    await sweep();
    expect(ours()).toHaveLength(1);
    api.clock.advance(5 * 60_000);
    await sweep();
    expect(ours()).toHaveLength(2);
  });
});
