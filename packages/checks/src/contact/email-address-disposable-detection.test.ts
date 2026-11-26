/** C56: `email_address_disposable_detection` over the CC0 list and the operator lists. */
import { describe, expect, it } from 'vitest';
import { emailAddressContext } from './context.js';
import { emailAddressDisposableDetection } from './email-address-disposable-detection.js';
import {
  EMAIL_CHECKS,
  TEST_DISPOSABLE_LIST_SOURCE,
  disposableList,
  emailInput,
  templateOf,
} from './testing.js';

const CHECK = 'email_address_disposable_detection';

function detect(
  overrides: Parameters<typeof emailInput>[0] = {},
  config?: Record<string, unknown>,
) {
  const template = templateOf(EMAIL_CHECKS, config === undefined ? {} : { [CHECK]: config });
  return emailAddressDisposableDetection(emailAddressContext(emailInput(overrides), template));
}

const DEFAULT_THRESHOLDS = { 'allow-domains': [], 'deny-domains': [] };
const DEFAULT_BASIS = { 'allow-domains': 'provisional', 'deny-domains': 'provisional' };

describe('email_address_disposable_detection (C56)', () => {
  it('passes an address whose domain and parents are on no list, naming the list file', () => {
    expect(detect()).toEqual({
      name: CHECK,
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: { match: 'none' },
      stage: 'ga',
      confidence: null,
      provenance: {
        'implementation-version': 1,
        models: [TEST_DISPOSABLE_LIST_SOURCE],
        thresholds: DEFAULT_THRESHOLDS,
        'threshold-basis': DEFAULT_BASIS,
      },
    });
  });

  it('fails disposable_domain for a listed domain or a listed parent', () => {
    expect(detect({ emailAddress: 'someone@trash.example' })).toMatchObject({
      status: 'failed',
      reasons: ['disposable_domain'],
      metadata: { match: 'listed', 'match-depth': 0 },
    });
    expect(detect({ emailAddress: 'someone@x.y.trash.example' })).toMatchObject({
      status: 'failed',
      metadata: { match: 'listed', 'match-depth': 2 },
    });
  });

  it('matches the ASCII form of an internationalised domain', () => {
    const result = detect({
      emailAddress: 'someone@bücher.example',
      disposableList: disposableList(['xn--bcher-kva.example']),
    });
    expect(result.reasons).toEqual(['disposable_domain']);
  });

  it('fails a domain the operator denies and passes one the operator allows', () => {
    const denied = detect(
      { emailAddress: 'someone@disposable.test' },
      { 'deny-domains': ['disposable.test'] },
    );
    expect(denied).toMatchObject({
      status: 'failed',
      reasons: ['disposable_domain'],
      metadata: { match: 'denied', 'match-depth': 0 },
      provenance: {
        thresholds: { 'allow-domains': [], 'deny-domains': ['disposable.test'] },
        'threshold-basis': { 'allow-domains': 'provisional' },
      },
    });
    const allowed = detect(
      { emailAddress: 'someone@trash.example' },
      { 'allow-domains': ['trash.example'] },
    );
    expect(allowed).toMatchObject({
      status: 'passed',
      metadata: { match: 'allowed', 'match-depth': 0 },
    });
  });

  it('answers list_unavailable without the file and without an operator match, never a pass', () => {
    for (const disposable of [null, undefined]) {
      expect(detect({ disposableList: disposable })).toEqual({
        name: CHECK,
        status: 'not_applicable',
        type: 'fraud',
        reasons: ['list_unavailable'],
        metadata: {},
        stage: 'ga',
        confidence: null,
        provenance: {
          'implementation-version': 1,
          thresholds: DEFAULT_THRESHOLDS,
          'threshold-basis': DEFAULT_BASIS,
        },
      });
    }
  });

  it('still answers an operator match without the file', () => {
    expect(
      detect(
        { emailAddress: 'a@disposable.test', disposableList: null },
        { 'deny-domains': ['disposable.test'] },
      ),
    ).toMatchObject({ status: 'failed', metadata: { match: 'denied' } });
    expect(
      detect(
        { emailAddress: 'a@mail.partner.example', disposableList: null },
        { 'allow-domains': ['partner.example'] },
      ),
    ).toMatchObject({ status: 'passed', metadata: { match: 'allowed', 'match-depth': 1 } });
  });

  it.each([
    ['no address', null],
    ['an address the destination rule refuses', 'not an address'],
    ['an IP-literal domain', 'a@[192.0.2.1]'],
  ])('answers input_missing with %s', (_why, emailAddress) => {
    expect(detect({ emailAddress })).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('never copies the address or its domain into the result', () => {
    const serialized = JSON.stringify(detect({ emailAddress: 'someone@trash.example' }));
    expect(serialized).not.toContain('trash.example');
    expect(serialized).not.toContain('someone');
  });
});
