/**
 * Phase 11, Workflow 11A Stage 1a (K) (C238.1, C238.3, C238.10; orchestrator decision 17): the
 * `share_consent` step of flow-spec 2 (snake_case type, camelCase members), its server-composed
 * client view, the `share.consent.*` copy keys with legal weight and the counsel review status of
 * their built-in texts. The step joins the union without a format change; a spec-1 client gets the
 * placeholder. Every value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import * as flowSpec from '../index.js';
import { flowOf } from './test-flows.js';

const pick = (name: string): unknown => (flowSpec as Readonly<Record<string, unknown>>)[name];
const CONNECTION = 'cxn_01M5CN0000000000000011A100';
const SOURCE_STEP = {
  id: 'share-consent-1',
  type: 'share_consent',
  side: 'source',
  connectionId: CONNECTION,
  consentValidSeconds: 1_209_600,
  withdrawalContact: 'privacy@example.com',
};
const DESTINATION_STEP = {
  id: 'share-consent-2',
  type: 'share_consent',
  side: 'destination',
  withdrawalContact: 'Write to the privacy team at privacy@example.com',
};

describe('the share_consent step (C238.1)', () => {
  it('joins the v2 step types as a v2-only, non-verification, client-seen step', () => {
    expect(flowSpec.FLOW_V2_STEP_TYPES).toContain('share_consent');
    expect(flowSpec.V2_ONLY_STEP_TYPES).toContain('share_consent');
    expect(flowSpec.VERIFICATION_STEP_TYPES).not.toContain('share_consent');
    expect(flowSpec.SERVER_STEP_TYPES).not.toContain('share_consent');
  });

  it.each([
    ['a source side naming its connection', SOURCE_STEP],
    ['a destination side, which takes the inquiry token', DESTINATION_STEP],
    [
      'a step without its withdrawal contact yet (publish refuses it)',
      { ...DESTINATION_STEP, withdrawalContact: undefined },
    ],
  ])('accepts %s', (_name, step) => {
    expect(flowSpec.stepV2Schema.safeParse(step).success).toBe(true);
  });

  it.each([
    ['a source side without a connection', { ...SOURCE_STEP, connectionId: undefined }],
    ['a destination side naming a connection', { ...DESTINATION_STEP, connectionId: CONNECTION }],
    ['another side', { ...SOURCE_STEP, side: 'both' }],
    [
      'a connection that is not a cxn_ id',
      { ...SOURCE_STEP, connectionId: 'cnst_01M5CN0000000000000011A200' },
    ],
    ['a validity under 60 seconds', { ...SOURCE_STEP, consentValidSeconds: 59 }],
    ['a validity over 21 days', { ...SOURCE_STEP, consentValidSeconds: 1_814_401 }],
    ['an empty withdrawal contact', { ...SOURCE_STEP, withdrawalContact: '' }],
    [
      'a withdrawal contact over 500 characters',
      { ...SOURCE_STEP, withdrawalContact: 'x'.repeat(501) },
    ],
    [
      'a withdrawal contact with a control character',
      { ...SOURCE_STEP, withdrawalContact: 'a\u0007b' },
    ],
    ['a kebab-case member', { ...SOURCE_STEP, 'connection-id': CONNECTION }],
    [
      'a share token in the step',
      { ...DESTINATION_STEP, shareTokenId: 'cnst_01M5CN0000000000000011A200' },
    ],
  ])('refuses %s', (_name, step) => {
    expect(flowSpec.stepV2Schema.safeParse(step).success).toBe(false);
  });

  it('defaults the validity to 14 days, within the token range (C232.1)', () => {
    expect(pick('SHARE_CONSENT_VALID_SECONDS')).toEqual({
      min: 60,
      max: 1_814_400,
      default: 1_209_600,
    });
  });

  it('continues on next whether the person accepts or declines (declining never ends the flow)', () => {
    const flow = flowOf(
      [SOURCE_STEP, { id: 'done', type: 'completion' }],
      [['share-consent-1', 'next', 'done']],
    );
    const problems = flowSpec
      .checkFlowGraph(flow)
      .filter((problem) => problem.severity !== 'warning');
    expect(problems).toEqual([]);
  });
});

const COMPOSED = {
  recipientName: 'Example Partner',
  sourceName: 'Example Source',
  categories: ['identity-fields', 'document-images', 'biometric'],
  text: {
    locale: 'en',
    body: 'Synthetic composed text for Example Partner.',
    sha256: 'a'.repeat(64),
    keys: ['share.consent.source'],
  },
  biometric: { body: 'Synthetic biometric text.', sha256: 'b'.repeat(64) },
};

describe('its client view (C238.3)', () => {
  it('is composed by the server: names, categories and texts with their digests, nothing else', () => {
    const compose = pick('shareConsentClientViewOf') as (
      step: unknown,
      composed: unknown,
    ) => unknown;
    const view = compose(flowSpec.stepV2Schema.parse(SOURCE_STEP), COMPOSED);
    expect(view).toEqual({
      id: 'share-consent-1',
      type: 'share_consent',
      side: 'source',
      ...COMPOSED,
    });
    expect(flowSpec.clientStepViewSchema.parse(view)).toEqual(view);
  });

  it('carries no connection, token or source id, and no withdrawal contact or validity of its own', () => {
    const view = { id: 'share-consent-1', type: 'share_consent', side: 'source', ...COMPOSED };
    for (const member of [
      'connectionId',
      'shareTokenId',
      'sourceId',
      'withdrawalContact',
      'consentValidSeconds',
    ]) {
      expect(
        flowSpec.clientStepViewSchema.safeParse({ ...view, [member]: 'x' }).success,
        member,
      ).toBe(false);
    }
  });

  it('needs a text, and a biometric text only when the share carries biometric data', () => {
    const view = { id: 'share-consent-1', type: 'share_consent', side: 'destination', ...COMPOSED };
    const withoutBiometric: Record<string, unknown> = { ...view };
    delete withoutBiometric.biometric;
    expect(flowSpec.clientStepViewSchema.safeParse(withoutBiometric).success).toBe(true);
    const withoutText: Record<string, unknown> = { ...view };
    delete withoutText.text;
    expect(flowSpec.clientStepViewSchema.safeParse(withoutText).success).toBe(false);
    expect(
      flowSpec.clientStepViewSchema.safeParse({
        ...view,
        text: { ...view.text, sha256: 'A'.repeat(64) },
      }).success,
    ).toBe(false);
  });

  it('is never built from the step alone: clientViewOf leaves it to the session builder', () => {
    expect(flowSpec.clientViewOf(flowSpec.stepV2Schema.parse(SOURCE_STEP))).toBeNull();
  });
});

describe('the share.consent.* copy keys (C238.3, C238.10)', () => {
  const KEYS = [
    'share.consent.title',
    'share.consent.source',
    'share.consent.destination',
    'share.consent.biometric-source',
    'share.consent.biometric-destination',
    'share.consent.accept',
    'share.consent.decline',
    'share.consent.withdraw',
  ];

  it('declares each with legal weight (consent), never a consent-step text', () => {
    for (const key of KEYS) {
      expect(flowSpec.COPY_KEYS[key], key).toMatchObject({ legal: 'consent', consent: false });
    }
  });

  it('allows only the closed placeholders the server fills, retention only for the destination', () => {
    const placeholders = (key: string) => [...(flowSpec.COPY_KEYS[key]?.placeholders ?? [])].sort();
    expect(placeholders('share.consent.source')).toEqual([
      'categories',
      'expires',
      'recipient',
      'source',
      'withdraw',
    ]);
    expect(placeholders('share.consent.destination')).toEqual([
      'categories',
      'expires',
      'recipient',
      'retention',
      'source',
      'withdraw',
    ]);
    expect(placeholders('share.consent.biometric-source')).toEqual(['recipient', 'source']);
    expect(placeholders('share.consent.biometric-destination')).toEqual([
      'recipient',
      'retention',
      'source',
    ]);
    for (const key of KEYS) {
      for (const name of flowSpec.COPY_KEYS[key]?.placeholders ?? []) {
        expect(pick('SHARE_CONSENT_PLACEHOLDERS'), key).toContain(name);
      }
    }
  });

  it('marks the built-in texts counsel-unreviewed until Q7 records counsel’s review', () => {
    const status = pick('COUNSEL_REVIEW_STATUS') as Readonly<Record<string, string>>;
    expect(Object.keys(status).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      expect(status[key], key).toBe('counsel-unreviewed');
    }
  });
});
