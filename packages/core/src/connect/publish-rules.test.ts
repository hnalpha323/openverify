/**
 * C238.2 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 4): the Connect publish rules
 * of a template version, pure: one table per code and per acknowledgement (verification V06), the
 * graph rules on dominance ("precede on every path"), and every code reachable.
 */
import { describe, expect, it } from 'vitest';
import {
  CONNECT_PUBLISH_ERROR_CODES,
  CONNECT_PUBLISH_WARNINGS,
  connectPublishRules,
  type ConnectPublishFlow,
  type ConnectPublishInput,
  type ConnectPublishStep,
} from './publish-rules.js';

const COUNSEL_UNREVIEWED = [
  'share.consent.title',
  'share.consent.source',
  'share.consent.destination',
  'share.consent.biometric-source',
  'share.consent.biometric-destination',
  'share.consent.accept',
  'share.consent.decline',
  'share.consent.withdraw',
];

/** Operator copy for every share-consent key, in `en`. */
const ALL_COPY = { en: Object.fromEntries(COUNSEL_UNREVIEWED.map((key) => [key, 'Synthetic.'])) };

const CONTACT = 'Write to privacy@example.com';

const step = (id: string, type: string, extra: Partial<ConnectPublishStep> = {}) => ({
  id,
  type,
  ...extra,
});
const sourceShare = (id = 'share', extra: Partial<ConnectPublishStep> = {}) =>
  step(id, 'share_consent', {
    side: 'source',
    connectionId: 'cxn_active',
    withdrawalContact: CONTACT,
    ...extra,
  });
const destinationShare = (id = 'reuse', extra: Partial<ConnectPublishStep> = {}) =>
  step(id, 'share_consent', { side: 'destination', withdrawalContact: CONTACT, ...extra });

/** Steps in a line, each to the next. */
const linear = (...steps: ConnectPublishStep[]): ConnectPublishFlow => ({
  entry: steps[0]?.id ?? '',
  steps,
  edges: steps.slice(1).map((next, index) => ({ from: steps[index]?.id ?? '', to: next.id })),
});

const input = (patch: Partial<ConnectPublishInput>): ConnectPublishInput => ({
  flow: null,
  acceptClonedResults: null,
  checks: { selfie: { selfie_id_comparison: { enabled: true, required: true } } },
  connectEnabled: true,
  outboundConnections: {
    cxn_active: 'active',
    cxn_pending: 'pending',
    cxn_inactive: 'inactive',
    cxn_archived: 'archived',
  },
  retentionDays: 365,
  destinationBiometricPossible: true,
  copy: ALL_COPY,
  enabledLocales: ['en'],
  counselUnreviewedKeys: COUNSEL_UNREVIEWED,
  ...patch,
});

const codes = (patch: Partial<ConnectPublishInput>) =>
  connectPublishRules(input(patch)).problems.map(({ pointer, code, severity }) => [
    pointer,
    code,
    severity,
  ]);

const keys = (patch: Partial<ConnectPublishInput>) =>
  connectPublishRules(input(patch)).acknowledgements.map(({ key, pointer }) => [key, pointer]);

const SOURCE_FLOW = linear(
  step('consent', 'consent'),
  sourceShare(),
  step('id', 'government_id'),
  step('done', 'completion'),
);

/** A destination flow: consent, the destination's share consent, an ID, a live selfie, done. */
const REUSE_FLOW = linear(
  step('consent', 'consent'),
  destinationShare(),
  step('id', 'government_id'),
  step('db', 'database'),
  step('face', 'selfie'),
  step('done', 'completion'),
);

describe('a clean version (C238.2)', () => {
  it('meets every rule and needs nothing, its texts all overridden', () => {
    expect(connectPublishRules(input({ flow: SOURCE_FLOW }))).toEqual({
      problems: [],
      acknowledgements: [],
    });
    expect(connectPublishRules(input({ flow: null }))).toEqual({
      problems: [],
      acknowledgements: [],
    });
  });
});

describe('the step rules (C238.2, C231.10, C237.4, C238.9)', () => {
  it('refuses every step while the install does not serve Connect', () => {
    expect(
      codes({
        connectEnabled: false,
        flow: linear(sourceShare('a'), destinationShare('b'), step('done', 'completion')),
      }),
    ).toEqual([
      ['/flow/steps/0', 'share_consent_connect_disabled', 'error'],
      ['/flow/steps/1', 'share_consent_connect_disabled', 'error'],
    ]);
  });

  it.each([
    ['cxn_unknown', 'share_consent_connection_invalid', 'error'],
    ['cxn_archived', 'share_consent_connection_invalid', 'error'],
    ['cxn_pending', 'share_consent_connection_not_active', 'warning'],
    ['cxn_inactive', 'share_consent_connection_not_active', 'warning'],
  ])('a source step on %s: %s', (connectionId, code, severity) => {
    expect(
      codes({ flow: linear(sourceShare('share', { connectionId }), step('done', 'completion')) }),
    ).toEqual([['/flow/steps/0', code, severity]]);
  });

  it('refuses a source step that names no connection at all', () => {
    expect(
      codes({
        flow: linear(sourceShare('share', { connectionId: undefined }), step('done', 'completion')),
      }),
    ).toEqual([['/flow/steps/0', 'share_consent_connection_invalid', 'error']]);
  });

  it.each([[undefined], [''], ['   ']])('refuses a withdrawal contact of %j', (contact) => {
    expect(
      codes({
        flow: linear(
          sourceShare('share', { withdrawalContact: contact }),
          step('done', 'completion'),
        ),
      }),
    ).toEqual([
      ['/flow/steps/0/withdrawalContact', 'share_consent_withdrawal_contact_missing', 'error'],
    ]);
  });

  it('refuses a step reachable from a completion', () => {
    const flow: ConnectPublishFlow = {
      entry: 'consent',
      steps: [step('consent', 'consent'), step('done', 'completion'), sourceShare()],
      edges: [
        { from: 'consent', to: 'done' },
        { from: 'done', to: 'share' },
      ],
    };
    expect(codes({ flow })).toEqual([['/flow/steps/2', 'share_consent_after_completion', 'error']]);
  });

  it('asks a retention term of a destination step that can receive biometric data', () => {
    const flow = linear(destinationShare(), step('done', 'completion'));
    expect(codes({ flow, retentionDays: null })).toEqual([
      ['/flow/steps/0', 'share_consent_retention_missing', 'error'],
    ]);
    expect(codes({ flow, retentionDays: null, destinationBiometricPossible: false })).toEqual([]);
    expect(codes({ flow, retentionDays: 30 })).toEqual([]);
    expect(
      codes({ flow: linear(sourceShare(), step('done', 'completion')), retentionDays: null }),
    ).toEqual([]);
  });
});

describe('a destination step before the cloned steps (C238.2: share_consent_after_cloned_step)', () => {
  const accept = { 'verification-types': ['government-id' as const], 'max-age-days': 30 };

  it('passes a destination step that precedes every listed step', () => {
    expect(
      codes({ flow: REUSE_FLOW, acceptClonedResults: accept }).filter(
        ([, code]) => code === 'share_consent_after_cloned_step',
      ),
    ).toEqual([]);
  });

  it('refuses one that comes after a listed step', () => {
    const flow = linear(
      step('consent', 'consent'),
      step('id', 'government_id'),
      destinationShare(),
      step('done', 'completion'),
    );
    expect(codes({ flow, acceptClonedResults: accept })).toContainEqual([
      '/flow/steps/2',
      'share_consent_after_cloned_step',
      'error',
    ]);
  });

  it('refuses one that a listed step can be reached around (not on every path)', () => {
    const flow: ConnectPublishFlow = {
      entry: 'branch',
      steps: [
        step('branch', 'branch'),
        destinationShare(),
        step('id', 'government_id'),
        step('done', 'completion'),
      ],
      edges: [
        { from: 'branch', to: 'reuse' },
        { from: 'branch', to: 'id' },
        { from: 'reuse', to: 'id' },
        { from: 'id', to: 'done' },
      ],
    };
    expect(codes({ flow, acceptClonedResults: accept })).toContainEqual([
      '/flow/steps/1',
      'share_consent_after_cloned_step',
      'error',
    ]);
  });

  it('reads the email and phone steps as their share types, and ignores unlisted ones', () => {
    const flow = linear(
      step('email', 'email_otp'),
      destinationShare(),
      step('phone', 'phone_otp'),
      step('done', 'completion'),
    );
    const listed = (types: ('email-address' | 'phone-number')[]) =>
      codes({
        flow,
        acceptClonedResults: { 'verification-types': types, 'max-age-days': 30 },
        givenAcknowledgements: types.map((type) => `cloned-results-unbound:${type}`),
      }).filter(([, code]) => code === 'share_consent_after_cloned_step');
    expect(listed(['email-address'])).toEqual([
      ['/flow/steps/1', 'share_consent_after_cloned_step', 'error'],
    ]);
    expect(listed(['phone-number'])).toEqual([]);
  });
});

describe('accept-cloned-results and its binding (C235.3, C235.8)', () => {
  const accept = {
    'verification-types': ['government-id' as const, 'database' as const],
    'max-age-days': 30,
  };

  it('asks cloned-results per listed type, and nothing more with a live selfie bound to the cloned portrait', () => {
    expect(connectPublishRules(input({ flow: REUSE_FLOW, acceptClonedResults: accept }))).toEqual({
      problems: [],
      acknowledgements: [
        {
          key: 'cloned-results:government-id',
          pointer: '/settings/accept-cloned-results/verification-types/0',
          reason: expect.any(String) as string,
        },
        {
          key: 'cloned-results:database',
          pointer: '/settings/accept-cloned-results/verification-types/1',
          reason: expect.any(String) as string,
        },
      ],
    });
  });

  const unbound = (patch: Partial<ConnectPublishInput>) => ({
    problems: codes({ acceptClonedResults: accept, ...patch }),
    acknowledgements: keys({ acceptClonedResults: accept, ...patch }).map(([key]) => key),
  });

  it.each([
    [
      'no selfie step',
      linear(
        destinationShare(),
        step('id', 'government_id'),
        step('db', 'database'),
        step('done', 'completion'),
      ),
      {},
    ],
    [
      'a selfie before the destination step',
      linear(
        step('face', 'selfie'),
        destinationShare(),
        step('id', 'government_id'),
        step('db', 'database'),
        step('done', 'completion'),
      ),
      {},
    ],
    [
      'a selfie whose comparison is off',
      REUSE_FLOW,
      { checks: { selfie: { selfie_id_comparison: { enabled: false, required: false } } } },
    ],
    [
      'a selfie whose comparison is advisory',
      REUSE_FLOW,
      { checks: { selfie: { selfie_id_comparison: { enabled: true, required: false } } } },
    ],
  ] as [string, ConnectPublishFlow, Partial<ConnectPublishInput>][])(
    'refuses %s without cloned-results-unbound, per listed type',
    (_name, flow, patch) => {
      expect(unbound({ flow, ...patch })).toEqual({
        problems: [
          [
            '/settings/accept-cloned-results/verification-types/0',
            'cloned_results_without_binding',
            'error',
          ],
          [
            '/settings/accept-cloned-results/verification-types/1',
            'cloned_results_without_binding',
            'error',
          ],
        ],
        acknowledgements: [
          'cloned-results:government-id',
          'cloned-results-unbound:government-id',
          'cloned-results:database',
          'cloned-results-unbound:database',
        ],
      });
    },
  );

  it('binds nothing without a cloned identity document to compare with', () => {
    expect(
      unbound({
        flow: REUSE_FLOW,
        acceptClonedResults: { 'verification-types': ['database'], 'max-age-days': 30 },
      }).problems,
    ).toEqual([
      [
        '/settings/accept-cloned-results/verification-types/0',
        'cloned_results_without_binding',
        'error',
      ],
    ]);
  });

  it('publishes an unbound version once the publisher gives cloned-results-unbound, which it records', () => {
    const flow = linear(
      destinationShare(),
      step('id', 'government_id'),
      step('done', 'completion'),
    );
    const report = connectPublishRules(
      input({
        flow,
        acceptClonedResults: { 'verification-types': ['government-id'], 'max-age-days': 30 },
        givenAcknowledgements: ['cloned-results-unbound:government-id'],
      }),
    );
    expect(report.problems).toEqual([]);
    expect(report.acknowledgements.map(({ key }) => key)).toEqual([
      'cloned-results:government-id',
      'cloned-results-unbound:government-id',
    ]);
  });

  it('lists selfie only with cloned-results-unbound, and a listed selfie binds nothing', () => {
    const selfie = {
      'verification-types': ['government-id' as const, 'selfie' as const],
      'max-age-days': 30,
    };
    expect(unbound({ flow: REUSE_FLOW, acceptClonedResults: selfie })).toEqual({
      problems: [
        [
          '/settings/accept-cloned-results/verification-types/0',
          'cloned_results_without_binding',
          'error',
        ],
        [
          '/settings/accept-cloned-results/verification-types/1',
          'cloned_results_without_binding',
          'error',
        ],
      ],
      acknowledgements: [
        'cloned-results:government-id',
        'cloned-results-unbound:government-id',
        'cloned-results:selfie',
        'cloned-results-unbound:selfie',
      ],
    });
  });

  it('asks no binding of a version no person reaches through a share consent (API clones)', () => {
    const plain = linear(
      step('consent', 'consent'),
      step('id', 'government_id'),
      step('done', 'completion'),
    );
    expect(unbound({ flow: plain })).toEqual({
      problems: [],
      acknowledgements: ['cloned-results:government-id', 'cloned-results:database'],
    });
    expect(unbound({ flow: null })).toEqual({
      problems: [],
      acknowledgements: ['cloned-results:government-id', 'cloned-results:database'],
    });
    expect(
      unbound({
        flow: null,
        acceptClonedResults: { 'verification-types': ['selfie'], 'max-age-days': 1 },
      }).problems,
    ).toEqual([
      [
        '/settings/accept-cloned-results/verification-types/0',
        'cloned_results_without_binding',
        'error',
      ],
    ]);
  });
});

describe('the built-in texts counsel has not reviewed (C238.10: share-consent-default-text)', () => {
  it('asks the acknowledgement of a step that shows a built-in text in an enabled locale', () => {
    expect(keys({ flow: SOURCE_FLOW, copy: {} })).toEqual([
      ['share-consent-default-text:share', '/flow/steps/1'],
    ]);
    expect(keys({ flow: SOURCE_FLOW, enabledLocales: ['en', 'es'] })).toEqual([
      ['share-consent-default-text:share', '/flow/steps/1'],
    ]);
    const oneKeyMissing = {
      en: Object.fromEntries(
        COUNSEL_UNREVIEWED.filter((key) => key !== 'share.consent.decline').map((key) => [
          key,
          'Synthetic.',
        ]),
      ),
    };
    expect(keys({ flow: SOURCE_FLOW, copy: oneKeyMissing })).toEqual([
      ['share-consent-default-text:share', '/flow/steps/1'],
    ]);
  });

  it('asks nothing once counsel has reviewed the texts, or of a key the step does not show', () => {
    expect(keys({ flow: SOURCE_FLOW, copy: {}, counselUnreviewedKeys: [] })).toEqual([]);
    const noDestinationTexts = {
      en: Object.fromEntries(
        COUNSEL_UNREVIEWED.filter((key) => !key.includes('destination')).map((key) => [
          key,
          'Synthetic.',
        ]),
      ),
    };
    expect(keys({ flow: SOURCE_FLOW, copy: noDestinationTexts })).toEqual([]);
  });

  it('reads no enabled locale as the source locale alone', () => {
    expect(keys({ flow: SOURCE_FLOW, enabledLocales: [] })).toEqual([]);
    expect(keys({ flow: SOURCE_FLOW, enabledLocales: [], copy: {} })).toEqual([
      ['share-consent-default-text:share', '/flow/steps/1'],
    ]);
  });
});

describe('every code is reachable (C238.2: one test per code)', () => {
  it('answers each of the seven codes and the warning somewhere above', () => {
    const seen = new Set<string>();
    const add = (patch: Partial<ConnectPublishInput>) => {
      for (const problem of connectPublishRules(input(patch)).problems) seen.add(problem.code);
    };
    add({ connectEnabled: false, flow: SOURCE_FLOW });
    add({ flow: linear(sourceShare('s', { connectionId: 'cxn_x' })) });
    add({ flow: linear(sourceShare('s', { connectionId: 'cxn_pending' })) });
    add({ flow: linear(sourceShare('s', { withdrawalContact: undefined })) });
    add({
      flow: {
        entry: 'done',
        steps: [step('done', 'completion'), sourceShare()],
        edges: [{ from: 'done', to: 'share' }],
      },
    });
    add({ flow: linear(destinationShare()), retentionDays: null });
    add({
      flow: linear(step('id', 'government_id'), destinationShare()),
      acceptClonedResults: { 'verification-types': ['government-id'], 'max-age-days': 1 },
    });
    expect([...seen].sort()).toEqual(
      [...CONNECT_PUBLISH_ERROR_CODES, ...CONNECT_PUBLISH_WARNINGS].sort(),
    );
  });
});
