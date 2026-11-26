/** C56: `email_address_mx_detection` by DNS only, and the sandbox reserved-domain rule. */
import { describe, expect, it } from 'vitest';
import type { ProviderOutcome } from '../government-id/inputs.js';
import { emailAddressContext } from './context.js';
import { emailAddressMxDetection } from './email-address-mx-detection.js';
import type { MxLookupResult } from './inputs.js';
import { EMAIL_CHECKS, emailInput, templateOf } from './testing.js';

const CHECK = 'email_address_mx_detection';
const DNS = { id: 'dns', sandbox: false };

const lookup = (result: MxLookupResult): ProviderOutcome<MxLookupResult> => ({
  kind: 'result',
  provider: DNS,
  result,
});

const detect = (overrides: Parameters<typeof emailInput>[0] = {}) =>
  emailAddressMxDetection(emailAddressContext(emailInput(overrides), templateOf(EMAIL_CHECKS)));

describe('email_address_mx_detection (C56)', () => {
  it('passes a domain with a usable MX exchange, naming the resolver', () => {
    expect(detect()).toEqual({
      name: CHECK,
      status: 'passed',
      type: 'user_behavior',
      reasons: [],
      metadata: { route: 'mx', 'record-count': 1 },
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, provider: DNS, thresholds: {} },
    });
  });

  it('passes a usable exchange beside a stray null MX', () => {
    expect(
      detect({ mx: lookup({ kind: 'mx', exchanges: ['', 'mx.mail.example.org', '.'] }) }),
    ).toMatchObject({ status: 'passed', metadata: { route: 'mx', 'record-count': 3 } });
  });

  it.each([[['']], [['.']], [['', '.']]])(
    'fails domain_rejects_mail for null MX records only (RFC 7505): %j',
    (exchanges) => {
      expect(detect({ mx: lookup({ kind: 'mx', exchanges }) })).toMatchObject({
        status: 'failed',
        reasons: ['domain_rejects_mail'],
        metadata: { route: 'null_mx', 'record-count': exchanges.length },
        provenance: { provider: DNS },
      });
    },
  );

  it('passes on the implicit MX of RFC 5321 §5.1: no MX but an address record', () => {
    expect(detect({ mx: lookup({ kind: 'no_mx', addressRecords: 2 }) })).toMatchObject({
      status: 'passed',
      metadata: { route: 'implicit', 'record-count': 2 },
    });
  });

  it('fails no_mail_server with neither an MX nor an address record', () => {
    expect(detect({ mx: lookup({ kind: 'no_mx', addressRecords: 0 }) })).toMatchObject({
      status: 'failed',
      reasons: ['no_mail_server'],
      metadata: { route: 'implicit', 'record-count': 0 },
    });
  });

  it('fails domain_not_found for NXDOMAIN', () => {
    expect(detect({ mx: lookup({ kind: 'not_found' }) })).toMatchObject({
      status: 'failed',
      reasons: ['domain_not_found'],
      metadata: { route: 'nxdomain' },
    });
  });

  it('answers execution_error for a failed lookup or an empty MX answer, never a pass', () => {
    expect(detect({ mx: { kind: 'error' } })).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
      metadata: {},
    });
    expect(detect({ mx: lookup({ kind: 'mx', exchanges: [] }) })).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });

  it('answers provider_not_configured without a resolver or a lookup', () => {
    for (const mx of [{ kind: 'not_configured' } as const, undefined]) {
      expect(detect({ mx })).toEqual({
        name: CHECK,
        status: 'not_applicable',
        type: 'user_behavior',
        reasons: ['provider_not_configured'],
        metadata: {},
        stage: 'ga',
        confidence: null,
        provenance: { 'implementation-version': 1, thresholds: {} },
      });
    }
  });

  describe('the sandbox reserved-domain rule', () => {
    it('accepts mail at *.test and *.example with no lookup', () => {
      for (const emailAddress of ['user@inbox.test', 'user@company.example']) {
        expect(detect({ emailAddress, environment: 'sandbox', mx: undefined })).toMatchObject({
          status: 'passed',
          metadata: { route: 'reserved' },
          provenance: { 'implementation-version': 1, thresholds: {} },
        });
      }
    });

    it('fails *.invalid as domain_not_found with no lookup', () => {
      expect(
        detect({ emailAddress: 'user@nowhere.invalid', environment: 'sandbox', mx: undefined }),
      ).toMatchObject({
        status: 'failed',
        reasons: ['domain_not_found'],
        metadata: { route: 'reserved' },
      });
    });

    it('lets the lookup decide every other sandbox domain', () => {
      expect(detect({ environment: 'sandbox', mx: lookup({ kind: 'not_found' }) }).reasons).toEqual(
        ['domain_not_found'],
      );
    });

    it('never applies in production', () => {
      expect(
        detect({ emailAddress: 'user@inbox.test', mx: lookup({ kind: 'not_found' }) }).reasons,
      ).toEqual(['domain_not_found']);
    });
  });

  it.each([
    ['no address', null],
    ['an address the destination rule refuses', 'user@localhost'],
  ])('answers input_missing with %s, before any rule', (_why, emailAddress) => {
    expect(detect({ emailAddress, environment: 'sandbox' })).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('never copies a host name into the result', () => {
    const serialized = JSON.stringify(detect());
    expect(serialized).not.toContain('mx1');
    expect(serialized).not.toContain('example.org');
  });
});
