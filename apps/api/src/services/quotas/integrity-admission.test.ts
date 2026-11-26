/**
 * KP10-27, C251.1 (Workflow 11B, `quotas`; a named borrowed edit of
 * `services/device-integrity/challenges.ts`): the token route admits its challenge before it
 * enqueues the decode. Within the environment's `integrity-decode` cap the challenge is stamped
 * `admitted_at` and its decode enqueued; at the cap the token is still taken (202) but no decode is
 * enqueued and the challenge stays held, for the fair sweep, which then enqueues it. An admitted
 * challenge whose decode was lost is enqueued again by the recovery pass (`lostRowsOf`). Synthetic.
 */
import {
  defaultInquiryTemplateAttributes,
  flowIntegrityChallengeSchema,
  type DefaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import { updateEnvironmentSettings } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeviceIntegrityProvider, IntegrityDecodeJob, ProviderBindings } from '../../ports.js';
import { fixedClock } from '../../test-support/fakes.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  resumeInquiry,
} from '../../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import { recoverLostWork, sweepQueue } from './admission.js';
import { createQuotaAdmissionDeps, lostRowsOf, queueRowsOf } from './queue-rows.js';

/** The consent of a session that is asked for a token: both integrity notices shown. */
const ASKED = ['consent.processing', 'notice.session-integrity', 'notice.play-integrity'];
const SYNTHETIC_TOKEN = 'synthetic-integrity-token-quotas-0001';

const sandboxProvider: DeviceIntegrityProvider = {
  id: 'sandbox',
  name: 'sandbox',
  sandbox: true,
  decode: () => Promise.reject(new Error('the route never decodes')),
};

const jobs: IntegrityDecodeJob[] = [];
let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi({
    providers: {
      sandbox: { deviceIntegrity: sandboxProvider },
      production: {},
    } satisfies ProviderBindings,
    integrityDecodes: {
      enqueueIntegrityDecode: (job) => {
        jobs.push(job);
        return Promise.resolve();
      },
    },
  });
  await updateEnvironmentSettings(api.database.db, api.environmentId, {
    'queue-in-flight-caps': { 'integrity-decode': 1 },
  });
});

afterAll(async () => {
  await api.close();
});

function asking(): DefaultInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  attributes.flow.steps = attributes.flow.steps.map((step) =>
    step.type === 'consent' ? { ...step, textKeys: ASKED } : step,
  );
  return attributes;
}

/** A consented session's challenge id, after its token was posted (202). */
async function postedChallenge(): Promise<string> {
  const templateId = await createTemplate(api, api.token, asking());
  const inquiryId = await createInquiry(api, { token: api.token, templateId });
  const sessionToken = await resumeInquiry(api, inquiryId, api.token);
  const post = (url: string, payload: Record<string, unknown>) =>
    api.app.inject({ method: 'POST', url, headers: bearer(sessionToken), payload });
  expectStatus(
    await post('/api/v1/flow/consent', { accepted: true, 'text-keys': ASKED, locale: 'en' }),
    201,
  );
  expectStatus(
    await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(sessionToken) }),
    200,
  );
  const challenge = flowIntegrityChallengeSchema.parse(
    expectStatus(await post('/api/v1/flow/integrity-challenges', {}), 201),
  );
  expect(
    (
      await post('/api/v1/flow/integrity-tokens', {
        'challenge-id': challenge.id,
        token: SYNTHETIC_TOKEN,
      })
    ).statusCode,
  ).toBe(202);
  return challenge.id;
}

async function admitted(challengeId: string): Promise<boolean> {
  const result = await api.database.client.query<{ admitted: boolean }>(
    'select admitted_at is not null as admitted from inquiry_integrity_challenges where id = $1',
    [challengeId],
  );
  return result.rows[0]?.admitted === true;
}

describe('the integrity decode under its cap (KP10-27, C251.1)', () => {
  it('admits within the cap, holds at it, and the sweep and the recovery enqueue what is left', async () => {
    const first = await postedChallenge();
    expect(await admitted(first)).toBe(true);
    expect(jobs).toEqual([{ environmentId: api.environmentId, challengeId: first }]);

    const second = await postedChallenge();
    expect(await admitted(second)).toBe(false);
    expect(jobs.map((job) => job.challengeId)).toEqual([first]);

    // The first decode ends (its token taken); the sweep admits the held one and enqueues it.
    await api.database.client.query(
      'update inquiry_integrity_challenges set token = null where id = $1',
      [first],
    );
    const clock = fixedClock(new Date('2026-11-13T12:00:00.000Z'));
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const deps = createQuotaAdmissionDeps({
      db: api.database.db,
      clock,
      logger,
      limits: { ceiling: 50 },
    });
    const enqueue = (job: IntegrityDecodeJob) => {
      jobs.push(job);
      return Promise.resolve();
    };
    await sweepQueue(deps, queueRowsOf('integrity-decode'), enqueue);
    expect(await admitted(second)).toBe(true);
    expect(jobs.map((job) => job.challengeId)).toEqual([first, second]);

    // Its decode lost, the recovery enqueues it again once the grace has passed.
    clock.advance(3 * 60_000);
    await recoverLostWork(deps, lostRowsOf('integrity-decode'), enqueue, { graceMs: 2 * 60_000 });
    expect(jobs.map((job) => job.challengeId)).toEqual([first, second, second]);
  });
});
