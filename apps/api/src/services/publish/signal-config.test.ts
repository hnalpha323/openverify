/**
 * Workflow 7A Stage 3 (`api-signals`; C90.6, C90.7, C94.6, F31): the `signal-config` publish rules.
 *
 * - `collect`: an unknown name is `unknown_signal` at `/data/attributes/signal-config/collect/<i>`.
 * - `review-rules`: a rule on a signal outside `collect`, or a comparison that does not fit the
 *   signal's value type (a never-false flag compared with `false` included), is
 *   `signal_rule_invalid`; a rule on a signal registered `review-rule: false` is
 *   `signal_not_reviewable`; a `proxy_detected` rule without an `ipReputation` adapter bound for
 *   the environment's kind is `provider_not_bound`.
 * - Device recognition: in `consent` mode the consent step must offer
 *   `consent.device-recognition` (`consent_text_missing`); in `exempt` mode it must show
 *   `notice.device-recognition` (`consent_text_missing`) and must not offer the optional tick
 *   (`consent_key_conflicts_with_exempt`).
 *
 * Through the API, the first problem's code answers 422 with every pointer.
 */
import {
  defaultInquiryTemplateAttributes,
  type SignalConfig,
  type SignalCollectionSetting,
} from '@openverify/contracts';
import { getSignalDefinition, type SignalDefinition } from '@openverify/core';
import { updateEnvironmentSettings } from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIpReputationProvider } from '../../providers/ip-reputation/index.js';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import {
  reviewRuleProblems,
  signalConfigPublishProblems,
  type SignalConfigProblem,
} from './signal-config.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/data/attributes/signal-config';

function flowWith(textKeys: string[], optionalTextKeys: string[] = []): Flow {
  const { flow } = defaultInquiryTemplateAttributes();
  return {
    ...flow,
    steps: flow.steps.map((step) =>
      step.type === 'consent'
        ? { ...step, textKeys, ...(optionalTextKeys.length === 0 ? {} : { optionalTextKeys }) }
        : step,
    ),
  };
}

const CONSENT_STEP = defaultInquiryTemplateAttributes().flow.steps.findIndex(
  (step) => step.type === 'consent',
);

async function problems(
  signalConfig: SignalConfig,
  options: {
    flow?: Flow;
    kind?: 'sandbox' | 'production';
    collection?: SignalCollectionSetting;
    providers?: TestApi['deps']['providers'];
  } = {},
): Promise<SignalConfigProblem[]> {
  const tenant = await api.newTenant({ kind: options.kind ?? 'sandbox' });
  if (options.collection !== undefined) {
    await updateEnvironmentSettings(api.database.db, tenant.environmentId, {
      'signal-collection': options.collection,
    });
  }
  return signalConfigPublishProblems({
    deps: { ...api.deps, providers: options.providers ?? api.deps.providers },
    db: api.database.db,
    environment: { id: tenant.environmentId, kind: tenant.environmentKind },
    flow: options.flow ?? flowWith(['consent.processing']),
    signalConfig,
  });
}

const codes = (found: SignalConfigProblem[]) =>
  found.map((problem) => [problem.code, problem.pointer]);

describe('the collected set (C90.6)', () => {
  it('passes an empty member, the defaults and catalogue names', async () => {
    expect(await problems({})).toEqual([]);
    expect(await problems({ collect: 'default', 'on-signal': 'needs_review' })).toEqual([]);
    expect(await problems({ collect: ['inquiry/bot_score', 'inquiry/tor_detected'] })).toEqual([]);
  });

  it('refuses an unknown name with unknown_signal at its index', async () => {
    expect(codes(await problems({ collect: ['inquiry/bot_score', 'inquiry/not_a_signal'] }))).toEqual(
      [['unknown_signal', `${BASE}/collect/1`]],
    );
  });
});

describe('the review rules (C90.6, C90.7)', () => {
  it('passes rules that fit their signal’s type within the collected set', async () => {
    expect(
      await problems({
        'review-rules': [
          { signal: 'inquiry/bot_score', gte: 70 },
          { signal: 'inquiry/behavior_threat_level', in: ['medium', 'high'] },
          { signal: 'inquiry/tor_detected', eq: true, 'on-null': 'ignore' },
          { signal: 'inquiry/datacenter_detected', eq: true },
          { signal: 'inquiry/country_comparison', eq: 'different' },
          { signal: 'inquiry/country_from_session', in: ['ZZ', 'AA'] },
          { signal: 'inquiry/max_session_distance', lte: 500_000.5 },
        ],
      }),
    ).toEqual([]);
  });

  it('refuses a rule on a signal outside collect, or on an unknown one', async () => {
    expect(
      codes(
        await problems({
          collect: ['inquiry/bot_score'],
          'review-rules': [
            { signal: 'inquiry/bot_score', gte: 90 },
            { signal: 'inquiry/tor_detected', eq: true },
            { signal: 'inquiry/not_a_signal', eq: true },
          ],
        }),
      ),
    ).toEqual([
      ['signal_rule_invalid', `${BASE}/review-rules/1/signal`],
      ['unknown_signal', `${BASE}/review-rules/2/signal`],
    ]);
  });

  it('refuses a comparison that does not fit the value type', async () => {
    expect(
      codes(
        await problems({
          'review-rules': [
            { signal: 'inquiry/bot_score', eq: 'high' },
            { signal: 'inquiry/bot_score', eq: 70.5 },
            { signal: 'inquiry/behavior_threat_level', gte: 2 },
            { signal: 'inquiry/behavior_threat_level', in: ['low', 'extreme'] },
            { signal: 'inquiry/tor_detected', eq: 1 },
            { signal: 'inquiry/datacenter_detected', eq: false },
            { signal: 'inquiry/country_from_session', eq: 'fra' },
            { signal: 'inquiry/session_count', gte: -1 },
          ],
        }),
      ),
    ).toEqual([
      ['signal_rule_invalid', `${BASE}/review-rules/0/eq`],
      ['signal_rule_invalid', `${BASE}/review-rules/1/eq`],
      ['signal_rule_invalid', `${BASE}/review-rules/2/gte`],
      ['signal_rule_invalid', `${BASE}/review-rules/3/in/1`],
      ['signal_rule_invalid', `${BASE}/review-rules/4/eq`],
      ['signal_rule_invalid', `${BASE}/review-rules/5/eq`],
      ['signal_rule_invalid', `${BASE}/review-rules/6/eq`],
      ['signal_rule_invalid', `${BASE}/review-rules/7/gte`],
    ]);
  });

  it('refuses a rule on a signal registered review-rule: false (F31)', () => {
    const botScore = getSignalDefinition('inquiry/bot_score');
    expect(botScore).toBeDefined();
    const unreviewable = { ...botScore, reviewRule: false } as SignalDefinition;
    expect(
      reviewRuleProblems([{ signal: 'inquiry/bot_score', gte: 1 }], ['inquiry/bot_score'], () =>
        unreviewable,
      ).map((problem) => [problem.code, problem.pointer]),
    ).toEqual([['signal_not_reviewable', `${BASE}/review-rules/0/signal`]]);
  });

  it('refuses a rule on the real inquiry/list_match_count entry: on-list-match covers it (F31)', async () => {
    const config: SignalConfig = {
      'review-rules': [{ signal: 'inquiry/list_match_count', gte: 1 }],
    };
    expect(codes(await problems(config))).toEqual([
      ['signal_not_reviewable', `${BASE}/review-rules/0/signal`],
    ]);
  });

  it('refuses a proxy_detected rule without an ipReputation adapter bound for the kind', async () => {
    const config: SignalConfig = { 'review-rules': [{ signal: 'inquiry/proxy_detected', eq: true }] };
    expect(codes(await problems(config))).toEqual([
      ['provider_not_bound', `${BASE}/review-rules/0/signal`],
    ]);
    const bound = {
      ...api.deps.providers,
      sandbox: {
        ...api.deps.providers.sandbox,
        ipReputation: createIpReputationProvider('sandbox', { mmdbPath: null }),
      },
    };
    expect(await problems(config, { providers: bound })).toEqual([]);
    expect(codes(await problems(config, { providers: bound, kind: 'production' }))).toEqual([
      ['provider_not_bound', `${BASE}/review-rules/0/signal`],
    ]);
  });
});

describe('device recognition’s keys (C94.6)', () => {
  const consentMode: SignalCollectionSetting = {
    'session-integrity': 'on',
    'device-recognition': 'consent',
    'device-recognition-basis': null,
  };
  const exemptMode: SignalCollectionSetting = {
    'session-integrity': 'on',
    'device-recognition': 'exempt',
    'device-recognition-basis': 'Synthetic recorded basis',
  };
  const step = `/data/attributes/flow/steps/${String(CONSENT_STEP)}`;

  it('needs the optional consent.device-recognition in consent mode', async () => {
    expect(codes(await problems({}, { collection: consentMode }))).toEqual([
      ['consent_text_missing', `${step}/optionalTextKeys`],
    ]);
    expect(
      await problems(
        {},
        {
          collection: consentMode,
          flow: flowWith(['consent.processing'], ['consent.device-recognition']),
        },
      ),
    ).toEqual([]);
  });

  it('needs the notice and refuses the optional tick in exempt mode', async () => {
    expect(codes(await problems({}, { collection: exemptMode }))).toEqual([
      ['consent_text_missing', `${step}/textKeys`],
    ]);
    expect(
      codes(
        await problems(
          {},
          {
            collection: exemptMode,
            flow: flowWith(
              ['consent.processing', 'notice.device-recognition'],
              ['consent.device-recognition'],
            ),
          },
        ),
      ),
    ).toEqual([['consent_key_conflicts_with_exempt', `${step}/optionalTextKeys`]]);
    expect(
      await problems(
        {},
        {
          collection: exemptMode,
          flow: flowWith(['consent.processing', 'notice.device-recognition']),
        },
      ),
    ).toEqual([]);
  });

  it('asks nothing of a flow without a consent step, which collects nothing', async () => {
    const { flow } = defaultInquiryTemplateAttributes();
    const withoutConsent: Flow = {
      ...flow,
      steps: flow.steps.filter((one) => one.type !== 'consent'),
    };
    expect(await problems({}, { collection: consentMode, flow: withoutConsent })).toEqual([]);
  });
});

describe('through the API (C90.6)', () => {
  it('answers a refused publish with the first problem’s code and every pointer', async () => {
    const call = (url: string, payload: Record<string, unknown>) =>
      api.app.inject({
        method: 'POST',
        url: `/api/v1${url}`,
        headers: bearer(api.token),
        payload,
      });
    const created = (
      await call('/inquiry-templates', {
        data: { type: 'inquiry-template', attributes: defaultInquiryTemplateAttributes() },
      })
    ).json<{ data: { id: string } }>();
    const { flow, 'verification-config': verificationConfig } = defaultInquiryTemplateAttributes();
    const draft = (
      await call('/inquiry-template-versions', {
        data: {
          type: 'inquiry-template-version',
          attributes: {
            flow,
            'verification-config': verificationConfig,
            'inquiry-template-id': created.data.id,
            'signal-config': {
              collect: ['inquiry/not_a_signal'],
              'review-rules': [{ signal: 'inquiry/bot_score', eq: 'high' }],
            },
          },
        },
      })
    ).json<{ data: { id: string } }>();
    const response = await call(`/inquiry-template-versions/${draft.data.id}/publish`, {
      meta: {},
    });
    expect(response.statusCode).toBe(422);
    const problem = response.json<{ code: string; errors: { pointer: string }[] }>();
    expect(problem.code).toBe('unknown_signal');
    expect(problem.errors.map((error) => error.pointer)).toEqual([
      `${BASE}/collect/0`,
      `${BASE}/review-rules/0/signal`,
    ]);
  });
});
