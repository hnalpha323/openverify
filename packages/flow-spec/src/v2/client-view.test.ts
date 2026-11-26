import { describe, expect, it } from 'vitest';
import { clientViewOf } from './client-view.js';
import { clientStepViewSchema } from './schemas/client-view.js';
import { stepV2Schema, type FlowV2Step } from './schemas/steps.js';
import {
  aamva,
  action,
  branch,
  consent,
  database,
  document,
  failure,
  governmentId,
  phone,
  route,
  screen,
  submit,
  textInput,
  v,
} from './test-flows.js';

const step = (raw: Record<string, unknown>): FlowV2Step => stepV2Schema.parse(raw);

describe('clientViewOf (C151.5, review P14)', () => {
  it('sends no branch and no action to any client', () => {
    expect(
      clientViewOf(step(branch('age', [route('minor', { '<': [v('x.y'), 18] }, 'else')]))),
    ).toBeNull();
    expect(
      clientViewOf(step(action('flag', { kind: 'flag_for_review', reasonCode: 'r' }))),
    ).toBeNull();
  });

  it('sends a screen without its name, with its components, rules and validation', () => {
    const raw = screen(
      'extra',
      [
        textInput('nickname', 'nickname', {
          pattern: '^[a-z]+$',
          maxLength: 20,
          visibleWhen: { '===': [v('screen.nickname'), 'x'] },
        }),
        submit(),
      ],
      { name: 'Internal: PEP follow-up' },
    );
    const view = clientViewOf(step(raw));
    expect(view).toEqual({ id: 'extra', type: 'screen', components: raw.components });
    expect(JSON.stringify(view)).not.toContain('PEP');
    expect(clientStepViewSchema.parse(view)).toEqual(view);
  });

  it('keeps captureMethodsByDevice on the capture steps and drops onFallback', () => {
    const id = step(
      governmentId('id_card', {
        onFallback: 'continue',
        captureMethodsByDevice: { 'desktop-web': ['upload'] },
      }),
    );
    const view = clientViewOf(id);
    expect(view).toEqual({
      id: 'id_card',
      type: 'government_id',
      sides: 'front',
      maxAttempts: 2,
      captureMethods: ['camera'],
      captureMethodsByDevice: { 'desktop-web': ['upload'] },
    });
    expect(clientStepViewSchema.parse(view)).toEqual(view);
    const proof = clientViewOf(step(document('proof', { onFallback: 'review' })));
    expect(proof).not.toHaveProperty('onFallback');
  });

  it('drops prefillFrom (the session values carry the value) and the failure step’s bases', () => {
    const views = [
      clientViewOf(step(phone('phone', { prefillFrom: 'phone_number', onFallback: 'review' }))),
      clientViewOf(step(database('db', { prefillFrom: { name_first: 'first_name' } }))),
      clientViewOf(step({ ...aamva('dl', 'form'), prefillFrom: { birthdate: 'birthdate' } })),
      clientViewOf(
        step(
          failure('rejected', {
            decisionBasis: 'contract',
            contestRoute: { url: 'https://example.com/contest' },
            biometricBasis: 'explicit-consent',
          }),
        ),
      ),
    ];
    for (const view of views) {
      expect(view).not.toBeNull();
      expect(clientStepViewSchema.safeParse(view).success).toBe(true);
      expect(view).not.toHaveProperty('prefillFrom');
      expect(view).not.toHaveProperty('decisionBasis');
      expect(view).not.toHaveProperty('contestRoute');
      expect(view).not.toHaveProperty('biometricBasis');
    }
  });

  it('passes the v1 steps that have no v2 member through unchanged', () => {
    const raw = consent('consent', { optionalTextKeys: ['consent.biometric-matching'] });
    expect(clientViewOf(step(raw))).toEqual(raw);
  });
});
