/**
 * C82.1: the `email-address` report from what the job looked up. Every lookup answer here is
 * synthetic; domains are RFC 2606 names or the authored free-mail and relay tables.
 */
import type { CheckProvider } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import type { DisposableDomainList, MxLookupResult } from '../../contact/inputs.js';
import type { DomainAgeLookup } from '../../business/inputs.js';
import type { ProviderOutcome } from '../../government-id/inputs.js';
import { emailTablesDigest } from './tables.js';
import {
  EMAIL_BAND_REASONS,
  emailReportDomainOf,
  evaluateEmailAddressReport,
  type EmailAddressReportInput,
  type EmailBreachLookup,
  type TxtAnswer,
} from './report.js';

const NOW = new Date('2026-10-27T12:00:00.000Z');
const DAY = 86_400_000;
const DNS: CheckProvider = { id: 'dns', sandbox: false };
const RDAP: CheckProvider = { id: 'rdap', sandbox: false };
const BREACHES: CheckProvider = { id: 'sandbox', sandbox: true };
const LIST: DisposableDomainList = {
  domains: new Set(['throwaway.example']),
  source: { id: 'synthetic-list@0000000', sha256: '0'.repeat(64) },
};

const result = <T>(provider: CheckProvider, value: T): ProviderOutcome<T> => ({
  kind: 'result',
  provider,
  result: value,
});
const mx = (...exchanges: string[]) => result<MxLookupResult>(DNS, { kind: 'mx', exchanges });
const txt = (...records: string[]) =>
  result<TxtAnswer>(DNS, { kind: 'records', records: records.map((text) => [text]) });
const registered = (days: number) =>
  result<DomainAgeLookup>(RDAP, {
    outcome: 'registered',
    registeredAt: new Date(NOW.getTime() - days * DAY),
    domain: 'acme-widgets.example',
  });
const breach = (count: number, daysAgo: number | null) =>
  result<EmailBreachLookup>(BREACHES, {
    breachCount: count,
    latestBreachAt: daysAgo === null ? null : new Date(NOW.getTime() - daysAgo * DAY),
  });

const BASE: EmailAddressReportInput = {
  emailAddress: 'avery.quill@acme-widgets.example',
  environment: 'production',
  now: NOW,
  disposableList: LIST,
  mx: mx('mx1.acme-widgets.example'),
  txt: txt('v=spf1 -all'),
  dmarc: {
    kind: 'reading',
    reading: { policy: 'reject', testing: false, foundAt: 'author_domain', queries: 1 },
  },
  domainAge: registered(4000),
  confirmation: 'not_linked',
};
const run = (overrides: Partial<EmailAddressReportInput> = {}) =>
  evaluateEmailAddressReport({ ...BASE, ...overrides });
const band = (overrides: Partial<EmailAddressReportInput> = {}) => {
  const { fields } = run(overrides);
  return {
    band: fields['email-reputation'],
    confidence: fields['email-reputation-confidence'],
    reasons: fields['email-reputation-reasons'],
    suspicious: fields['email-is-suspicious'],
  };
};
const unavailable = (overrides: Partial<EmailAddressReportInput> = {}) =>
  Object.fromEntries(run(overrides).unavailableFields.map(({ field, reason }) => [field, reason]));

describe('evaluateEmailAddressReport: a healthy custom domain', () => {
  it('answers high at 0.5, with every R field it could compute', () => {
    expect(run()).toEqual({
      fields: {
        'email-domain': 'acme-widgets.example',
        'email-domain-kind': 'custom',
        'email-domain-exists': true,
        'email-is-valid-mx': true,
        'email-is-disposable': false,
        'email-domain-age-days': 4000,
        'email-is-free-provider': false,
        'email-is-relay': false,
        'email-is-role-account': false,
        'email-mx-provider': null,
        'email-spf-policy': 'fail',
        'email-dmarc-policy': 'reject',
        'email-is-deliverable': null,
        'email-domain-typo-suggestion': null,
        'email-reputation': 'high',
        'email-is-suspicious': false,
        'email-reputation-confidence': 0.5,
        'email-reputation-reasons': ['accepts_mail'],
        'email-credentials-leaked-recent': null,
        'email-breach-count': null,
        'email-is-spam': null,
        'email-malicious-activity-detected-recent': null,
        'email-estimated-age-days': null,
        'age-estimated-13-plus': null,
        'age-estimated-16-plus': null,
        'age-estimated-18-plus': null,
      },
      unavailableFields: [
        { field: 'email-mx-provider', reason: 'undetermined' },
        { field: 'email-is-deliverable', reason: 'not_linked' },
        { field: 'email-credentials-leaked-recent', reason: 'provider_not_configured' },
        { field: 'email-breach-count', reason: 'provider_not_configured' },
        { field: 'email-is-spam', reason: 'no_adapter' },
        { field: 'email-malicious-activity-detected-recent', reason: 'no_adapter' },
        { field: 'email-estimated-age-days', reason: 'no_adapter' },
        { field: 'age-estimated-13-plus', reason: 'no_documented_method' },
        { field: 'age-estimated-16-plus', reason: 'no_documented_method' },
        { field: 'age-estimated-18-plus', reason: 'no_documented_method' },
      ],
      thresholds: { 'min-domain-age-days': 30, 'young-domain-days': 365 },
      details: {
        'disposable-list': LIST.source,
        'email-tables-sha256': emailTablesDigest(),
        'internationalised-local-part': false,
        'spf-redirect': false,
        'dmarc-found-at': 'author_domain',
        'dmarc-testing': false,
        'dmarc-queries': 1,
        'domain-age-requested': true,
        'breach-provider': null,
        'reason-confidences': { accepts_mail: 0.5 },
      },
    });
  });

  it('never lets SPF or DMARC change the band', () => {
    expect(
      band({
        txt: txt('v=spf1 +all'),
        dmarc: {
          kind: 'reading',
          reading: { policy: 'none', testing: false, foundAt: null, queries: 2 },
        },
      }),
    ).toEqual(band());
  });
});

describe('evaluateEmailAddressReport: the low band (C82.1)', () => {
  it('reads NXDOMAIN as domain_not_found, at 0.95', () => {
    const report = run({ mx: result<MxLookupResult>(DNS, { kind: 'not_found' }) });
    expect(report.fields['email-domain-exists']).toBe(false);
    expect(report.fields['email-is-valid-mx']).toBe(false);
    expect(band({ mx: result<MxLookupResult>(DNS, { kind: 'not_found' }) })).toEqual({
      band: 'low',
      confidence: 0.95,
      reasons: ['domain_not_found'],
      suspicious: true,
    });
  });

  it('reads a null MX (RFC 7505) as domain_rejects_mail', () => {
    const report = run({ mx: mx('') });
    expect(report.fields['email-domain-exists']).toBe(true);
    expect(report.fields['email-is-valid-mx']).toBe(false);
    expect(band({ mx: mx('.') }).reasons).toEqual(['domain_rejects_mail']);
  });

  it('reads no MX and no address as no_mail_server, and the implicit MX as accepting mail', () => {
    const none = result<MxLookupResult>(DNS, { kind: 'no_mx', addressRecords: 0 });
    const implicit = result<MxLookupResult>(DNS, { kind: 'no_mx', addressRecords: 2 });
    expect(band({ mx: none }).reasons).toEqual(['no_mail_server']);
    expect(band({ mx: implicit }).band).toBe('high');
    expect(run({ mx: implicit }).fields['email-is-valid-mx']).toBe(false);
  });

  it('reads a listed domain as disposable_domain, asking RDAP nothing', () => {
    const report = run({ emailAddress: 'avery@throwaway.example', domainAge: undefined });
    expect(report.fields['email-domain-kind']).toBe('disposable');
    expect(report.fields['email-is-disposable']).toBe(true);
    expect(report.fields['email-domain-age-days']).toBeNull();
    expect(report.details['domain-age-requested']).toBe(false);
    expect(unavailable({ emailAddress: 'avery@throwaway.example', domainAge: undefined })).toEqual(
      expect.objectContaining({ 'email-domain-age-days': 'undetermined' }),
    );
    expect(band({ emailAddress: 'avery@throwaway.example', domainAge: undefined })).toEqual({
      band: 'low',
      confidence: 0.95,
      reasons: ['disposable_domain'],
      suspicious: true,
    });
  });

  it('reads a custom domain younger than min-domain-age-days as domain_recently_registered, at 0.7', () => {
    expect(band({ domainAge: registered(10) })).toEqual({
      band: 'low',
      confidence: 0.7,
      reasons: ['domain_recently_registered'],
      suspicious: true,
    });
  });

  it('reads a custom domain served by a disposable service’s MX as mx_of_disposable_service, at 0.5', () => {
    expect(band({ mx: mx('mx.throwaway.example') })).toEqual({
      band: 'low',
      confidence: 0.5,
      reasons: ['mx_of_disposable_service'],
      suspicious: true,
    });
  });

  it('reads an address that is no address as syntax_invalid, computing nothing else', () => {
    const report = run({ emailAddress: 'not-an-address' });
    expect(band({ emailAddress: 'not-an-address' })).toEqual({
      band: 'low',
      confidence: 0.95,
      reasons: ['syntax_invalid'],
      suspicious: true,
    });
    expect(report.fields['email-domain']).toBeNull();
    expect(report.fields['email-domain-exists']).toBeNull();
    expect(unavailable({ emailAddress: 'a@@b.example' })).toEqual(
      expect.objectContaining({
        'email-domain': 'undetermined',
        'email-domain-exists': 'undetermined',
        'email-is-disposable': 'undetermined',
        'email-spf-policy': 'undetermined',
      }),
    );
  });

  it('lists every reason that applied, in the contracts’ order, the band taking the worst', () => {
    expect(band({ emailAddress: 'info@throwaway.example', domainAge: undefined })).toEqual({
      band: 'low',
      confidence: 0.95,
      reasons: ['disposable_domain', 'role_account'],
      suspicious: true,
    });
  });
});

describe('evaluateEmailAddressReport: the medium band', () => {
  it('reads a role mailbox as role_account, at 0.6', () => {
    expect(band({ emailAddress: 'info@acme-widgets.example' })).toEqual({
      band: 'medium',
      confidence: 0.6,
      reasons: ['role_account'],
      suspicious: false,
    });
  });

  it('reads a custom domain younger than young-domain-days as young_domain, at 0.5', () => {
    expect(band({ domainAge: registered(100) })).toEqual({
      band: 'medium',
      confidence: 0.5,
      reasons: ['young_domain'],
      suspicious: false,
    });
  });

  it('serves the template’s thresholds and judges by them', () => {
    const report = run({
      domainAge: registered(10),
      config: { 'min-domain-age-days': 5, 'young-domain-days': 20 },
    });
    expect(report.thresholds).toEqual({ 'min-domain-age-days': 5, 'young-domain-days': 20 });
    expect(report.fields['email-reputation-reasons']).toEqual(['young_domain']);
  });

  it('reads a near miss of a major domain as domain_typo_of_major_provider, at 0.4', () => {
    const typo = { emailAddress: 'avery@gmial.com', mx: mx('mx.gmial.com') };
    expect(run(typo).fields['email-domain-typo-suggestion']).toBe('gmail.com');
    expect(band(typo)).toEqual({
      band: 'medium',
      confidence: 0.4,
      reasons: ['domain_typo_of_major_provider'],
      suspicious: false,
    });
  });

  it('reads a breach in the last 12 months from a bound provider as recent_breach', () => {
    const report = run({ breach: breach(2, 30) });
    expect(report.fields['email-credentials-leaked-recent']).toBe(true);
    expect(report.fields['email-breach-count']).toBe(2);
    expect(report.details['breach-provider']).toEqual(BREACHES);
    expect(band({ breach: breach(2, 30) })).toEqual({
      band: 'medium',
      confidence: 0.5,
      reasons: ['recent_breach'],
      suspicious: false,
    });
  });

  it('reads a provider that gives no breach date as unknown recency, unless it found none', () => {
    expect(run({ breach: breach(0, null) }).fields['email-credentials-leaked-recent']).toBe(false);
    expect(run({ breach: breach(0, null) }).fields['email-reputation']).toBe('high');
    const undated = run({ breach: breach(4, null) });
    expect(undated.fields['email-credentials-leaked-recent']).toBeNull();
    expect(undated.fields['email-breach-count']).toBe(4);
    expect(undated.fields['email-reputation']).toBeNull();
    expect(unavailable({ breach: breach(4, null) })['email-reputation']).toBe('undetermined');
  });

  it('reads an older breach as no recent leak, and leaves the band', () => {
    const report = run({ breach: breach(3, 730) });
    expect(report.fields['email-credentials-leaked-recent']).toBe(false);
    expect(report.fields['email-breach-count']).toBe(3);
    expect(report.fields['email-reputation']).toBe('high');
  });
});

describe('evaluateEmailAddressReport: free mail and relays', () => {
  it('reads a free mailbox, never aging or typo-checking it', () => {
    const report = run({
      emailAddress: 'avery.quill@gmail.com',
      mx: mx('gmail-smtp-in.l.google.com'),
      domainAge: undefined,
    });
    expect(report.fields).toEqual(
      expect.objectContaining({
        'email-domain-kind': 'free_mail',
        'email-is-free-provider': true,
        'email-mx-provider': 'google',
        'email-domain-age-days': null,
        'email-domain-typo-suggestion': null,
        'email-reputation': 'high',
      }),
    );
    expect(report.details['domain-age-requested']).toBe(false);
  });

  it('answers null for a privacy relay, with privacy_relay (decision 19)', () => {
    const relay = { emailAddress: 'x1y2z3@privaterelay.appleid.com', domainAge: undefined };
    expect(run(relay).fields['email-is-relay']).toBe(true);
    expect(band(relay)).toEqual({
      band: null,
      confidence: null,
      reasons: ['privacy_relay'],
      suspicious: null,
    });
    expect(unavailable(relay)).toEqual(
      expect.objectContaining({
        'email-reputation': 'undetermined',
        'email-is-suspicious': 'undetermined',
        'email-reputation-confidence': 'undetermined',
      }),
    );
  });
});

describe('evaluateEmailAddressReport: never high on a gap (ADR 0002 §3a)', () => {
  it('answers null with execution_error when DNS failed and nothing else is low', () => {
    const failed = { mx: { kind: 'error' } as const };
    expect(band(failed)).toEqual({
      band: null,
      confidence: null,
      reasons: ['execution_error'],
      suspicious: null,
    });
    expect(unavailable(failed)).toEqual(
      expect.objectContaining({
        'email-domain-exists': 'execution_error',
        'email-is-valid-mx': 'execution_error',
        'email-reputation': 'execution_error',
      }),
    );
  });

  it('still answers low when a definite low reason stands beside the failure', () => {
    expect(
      band({ emailAddress: 'avery@throwaway.example', mx: { kind: 'error' }, domainAge: undefined })
        .band,
    ).toBe('low');
  });

  it('answers null when the medium a failed breach lookup could reach is worse than high', () => {
    expect(band({ breach: { kind: 'error' } })).toEqual({
      band: null,
      confidence: null,
      reasons: ['execution_error'],
      suspicious: null,
    });
    expect(unavailable({ breach: { kind: 'error' } })['email-credentials-leaked-recent']).toBe(
      'execution_error',
    );
    // A medium already reached stands: the failed lookup could not make it worse than medium.
    expect(
      band({ emailAddress: 'info@acme-widgets.example', breach: { kind: 'error' } }).band,
    ).toBe('medium');
  });

  it('answers null when RDAP failed for a custom domain, and high when RDAP has no answer', () => {
    expect(band({ domainAge: { kind: 'error' } }).band).toBeNull();
    const noService = result<DomainAgeLookup>(RDAP, {
      outcome: 'unavailable',
      reason: 'no_rdap_service',
    });
    expect(band({ domainAge: noService }).band).toBe('high');
    expect(unavailable({ domainAge: noService })['email-domain-age-days']).toBe('undetermined');
    expect(unavailable({ domainAge: { kind: 'not_configured' } })['email-domain-age-days']).toBe(
      'provider_not_configured',
    );
  });

  it('answers null without a resolver, never high', () => {
    expect(band({ mx: undefined }).band).toBeNull();
    expect(unavailable({ mx: undefined })['email-domain-exists']).toBe('provider_not_configured');
    expect(unavailable({ mx: { kind: 'not_configured' } })['email-reputation']).toBe(
      'provider_not_configured',
    );
  });

  it('answers null without the disposable list, unless a low reason stands', () => {
    expect(run({ disposableList: null }).fields['email-is-disposable']).toBeNull();
    expect(run({ disposableList: null }).fields['email-domain-kind']).toBeNull();
    expect(band({ disposableList: null })).toEqual({
      band: null,
      confidence: null,
      reasons: [],
      suspicious: null,
    });
    expect(unavailable({ disposableList: null })['email-reputation']).toBe('undetermined');
    expect(
      band({ disposableList: null, mx: result<MxLookupResult>(DNS, { kind: 'not_found' }) }).band,
    ).toBe('low');
  });

  it('cannot run the MX heuristic on exchanges without host names (C56’s masked cache form)', () => {
    const masked = { mx: mx('exchange', 'exchange') };
    expect(run(masked).fields['email-domain-exists']).toBe(true);
    expect(run(masked).fields['email-mx-provider']).toBeNull();
    expect(band(masked)).toEqual({ band: null, confidence: null, reasons: [], suspicious: null });
    expect(unavailable(masked)).toEqual(
      expect.objectContaining({
        'email-mx-provider': 'undetermined',
        'email-reputation': 'undetermined',
      }),
    );
    expect(
      band({ ...masked, emailAddress: 'avery@throwaway.example', domainAge: undefined }).band,
    ).toBe('low');
  });

  it('reads an MX answer without any exchange as a failed lookup', () => {
    expect(band({ mx: mx() }).reasons).toEqual(['execution_error']);
  });
});

describe('evaluateEmailAddressReport: the informational and confirmed fields', () => {
  it('reads SPF and DMARC failures as null fields, never as a band', () => {
    const report = run({
      txt: { kind: 'error' },
      dmarc: { kind: 'undetermined', queries: 3 },
    });
    expect(report.fields['email-spf-policy']).toBeNull();
    expect(report.fields['email-dmarc-policy']).toBeNull();
    expect(report.fields['email-reputation']).toBe('high');
    expect(unavailable({ txt: { kind: 'error' }, dmarc: { kind: 'error', queries: 2 } })).toEqual(
      expect.objectContaining({
        'email-spf-policy': 'execution_error',
        'email-dmarc-policy': 'execution_error',
      }),
    );
    expect(unavailable({ dmarc: { kind: 'undetermined', queries: 3 } })['email-dmarc-policy']).toBe(
      'undetermined',
    );
    expect(unavailable({ txt: undefined, dmarc: undefined })).toEqual(
      expect.objectContaining({
        'email-spf-policy': 'provider_not_configured',
        'email-dmarc-policy': 'provider_not_configured',
      }),
    );
  });

  it('reads no TXT record as no SPF record, and keeps whether a redirect decides', () => {
    expect(run({ txt: result<TxtAnswer>(DNS, { kind: 'none' }) }).fields['email-spf-policy']).toBe(
      'no_record',
    );
    expect(run({ txt: txt('v=spf1 redirect=_spf.example.net') }).details['spf-redirect']).toBe(
      true,
    );
  });

  it('says deliverable only for an address the inquiry confirmed by OTP, never false', () => {
    expect(run({ confirmation: 'confirmed' }).fields['email-is-deliverable']).toBe(true);
    expect(run({ confirmation: 'not_confirmed' }).fields['email-is-deliverable']).toBeNull();
    expect(unavailable({ confirmation: 'not_confirmed' })['email-is-deliverable']).toBe(
      'not_confirmed',
    );
  });

  it('reads an internationalised local part as valid syntax, but no role', () => {
    const report = run({ emailAddress: 'ünïcode@acme-widgets.example' });
    expect(report.fields['email-reputation']).toBe('high');
    expect(report.fields['email-is-role-account']).toBe(false);
    expect(report.details['internationalised-local-part']).toBe(true);
  });

  it('counts a registration date after now as zero days', () => {
    expect(run({ domainAge: registered(-2) }).fields['email-domain-age-days']).toBe(0);
  });
});

describe('evaluateEmailAddressReport: the sandbox names (C82.4)', () => {
  const sandbox = {
    environment: 'sandbox',
    mx: undefined,
    txt: undefined,
    dmarc: undefined,
  } as const;

  it('accepts mail at a reserved name without DNS, and ages new.example by its provider', () => {
    const report = run({ ...sandbox, emailAddress: 'avery@new.example', domainAge: registered(3) });
    expect(report.fields['email-domain-exists']).toBe(true);
    expect(report.fields['email-is-valid-mx']).toBe(true);
    expect(report.fields['email-reputation-reasons']).toEqual(['domain_recently_registered']);
    expect(unavailable({ ...sandbox, emailAddress: 'avery@new.example' })).toEqual(
      expect.objectContaining({
        'email-spf-policy': 'undetermined',
        'email-dmarc-policy': 'undetermined',
      }),
    );
  });

  it('reads disposable.example, relay.example and *.invalid as C82.4 says', () => {
    expect(band({ ...sandbox, emailAddress: 'a@disposable.example' }).reasons).toEqual([
      'disposable_domain',
    ]);
    expect(band({ ...sandbox, emailAddress: 'a@relay.example' }).reasons).toEqual([
      'privacy_relay',
    ]);
    expect(band({ ...sandbox, emailAddress: 'a@nowhere.invalid' }).reasons).toEqual([
      'domain_not_found',
    ]);
  });
});

describe('emailReportDomainOf', () => {
  it('gives the lower-case ASCII domain, or null for an address that is none', () => {
    expect(emailReportDomainOf('Avery@Example.ORG')).toBe('example.org');
    expect(emailReportDomainOf('avery@bücher.example')).toBe('xn--bcher-kva.example');
    expect(emailReportDomainOf('ünïcode@acme-widgets.example')).toBe('acme-widgets.example');
    expect(emailReportDomainOf('not-an-address')).toBeNull();
  });
});

describe('EMAIL_BAND_REASONS', () => {
  it('names every reason the band table uses', () => {
    expect(EMAIL_BAND_REASONS).toHaveLength(14);
  });
});
