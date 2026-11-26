/**
 * C82.1: the `email-address` report job over risk-logic's `evaluateEmailAddressReport`: MX with the
 * exchanges' real names, the domain's TXT records (SPF) and the RFC 9989 DMARC walk through the
 * worker's resolver and the report DNS cache, RDAP's registered-domain mode for a custom domain
 * only, the bound `emailIntelligence` provider, and deliverability from the inquiry's confirmed
 * OTP for a completion report only (P05). The answer is `ready` with every field it could
 * compute; a field it could not is `null` with its reason, and a DNS failure that could reach a
 * worse band leaves the band `null`, never `high`. Every address and domain is synthetic.
 */
import {
  EMAIL_BAND_REASONS,
  EMAIL_DOMAIN_KINDS,
  RISK_UNAVAILABLE_REASONS,
  type DisposableDomainList,
} from '@openverify/checks';
import {
  EMAIL_REPUTATION_REASONS,
  REPORT_UNAVAILABLE_REASONS,
  emailAddressReportResourceSchema,
} from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contactJobDatabase,
  submittedOtpVerification,
  type ContactJobDatabase,
} from '../../contact/job-testing.js';
import { DnsResolverError } from '../../dns/index.js';
import { createSandboxDomainAgeProvider } from '../../providers/domain-age/sandbox.js';
import type { RegisteredDomainAgeProvider } from '../../providers/domain-age/registered-domain.js';
import { createEmailIntelligenceProvider } from '../../providers/email-intelligence/index.js';
import {
  createFakeDnsResolver,
  createInMemoryKeyValueCache,
  fixedClock,
  type FakeDnsZone,
} from '../../test-support/fakes.js';
import { createEmailAddressReportJob } from './email-address.js';
import type { ReportRunResult, RunOutcome } from './job.js';
import {
  REPORT_NOW,
  reportContext,
  servedReport,
  type ReportContextOptions,
} from './provider-testing.js';

const DAY_MS = 86_400_000;
const LIST: DisposableDomainList = {
  domains: new Set(['throwaway-mail.example']),
  source: { id: 'disposable-email-domains@test', sha256: 'a'.repeat(64) },
};
const OWNER = 'synthetic-owner.example';
const ZONES: Record<string, FakeDnsZone | DnsResolverError> = {
  [OWNER]: {
    mx: [
      { exchange: 'mx2.synthetic-owner.example', priority: 20 },
      { exchange: 'aspmx.l.google.com', priority: 10 },
    ],
    txt: [['v=spf1 include:_spf.example ', '-all'], ['synthetic-verification=1']],
  },
  [`_dmarc.${OWNER}`]: { txt: [['v=DMARC1; p=reject; rua=mailto:dmarc@synthetic-owner.example']] },
  'timeout-owner.example': new DnsResolverError('timeout'),
};

/** A registered-domain mode that ages every domain `days` days, recording what it was asked. */
function agedEvery(days: number): RegisteredDomainAgeProvider & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    id: 'rdap',
    sandbox: false,
    registeredDomainAge: ({ domain }) => {
      asked.push(domain);
      return Promise.resolve({
        outcome: 'registered',
        registeredAt: new Date(REPORT_NOW.getTime() - days * DAY_MS),
        domain,
        subdomain: false,
      });
    },
  };
}

function job(age: RegisteredDomainAgeProvider = agedEvery(3650)) {
  return createEmailAddressReportJob({
    loadList: () => Promise.resolve(LIST),
    domainAge: () => age,
  });
}

function completed(outcome: RunOutcome): ReportRunResult {
  expect(outcome.kind).toBe('completed');
  if (outcome.kind !== 'completed') {
    throw new Error('the run did not complete');
  }
  return outcome.result;
}

type Options = Omit<ReportContextOptions, 'type' | 'query'>;

function context(emailAddress: string, options: Options = {}) {
  return reportContext({
    type: 'email-address',
    query: { 'email-address': emailAddress },
    ...options,
  });
}

function production(emailAddress: string, options: Options = {}) {
  return context(emailAddress, {
    environmentKind: 'production',
    providers: {
      domainAge: { id: 'rdap', sandbox: false, age: () => Promise.reject(new Error('not used')) },
    },
    deps: { dnsResolver: createFakeDnsResolver(ZONES) },
    ...options,
  });
}

const attributesOf = (result: ReportRunResult) => result.result as Record<string, unknown>;
const reasonOf = (result: ReportRunResult, field: string) =>
  result.unavailableFields.find((entry) => entry.field === field)?.reason;

function served(ctx: ReturnType<typeof context>, result: ReportRunResult) {
  const resource = servedReport(ctx, result);
  expect(emailAddressReportResourceSchema.safeParse(resource).success).toBe(true);
  return resource;
}

describe('the email-address report in a sandbox environment (C82.1, C82.4)', () => {
  const sandbox = (emailAddress: string, options: Options = {}) =>
    context(emailAddress, {
      providers: { domainAge: createSandboxDomainAgeProvider(fixedClock(REPORT_NOW)) },
      ...options,
    });
  const sandboxJob = createEmailAddressReportJob({ loadList: () => Promise.resolve(LIST) });

  it('answers an old reserved domain high, asking no DNS, ready with its provenance', async () => {
    const ctx = sandbox('kim@old.example');
    const result = completed(await sandboxJob.run(ctx));

    expect(result.errors).toEqual([]);
    expect(attributesOf(result)).toMatchObject({
      'email-domain': 'old.example',
      'email-domain-kind': 'custom',
      'email-domain-exists': true,
      'email-is-valid-mx': true,
      'email-reputation': 'high',
      'email-is-suspicious': false,
      'email-reputation-reasons': ['accepts_mail'],
      'email-is-deliverable': null,
    });
    expect(reasonOf(result, 'email-is-deliverable')).toBe('not_linked');
    // The sandbox registered old.example 20 years ago.
    expect(attributesOf(result)['email-domain-age-days']).toBeGreaterThan(20 * 365);
    expect(result).toMatchObject({ coverage: null, matches: [], matcherVersion: null });
    expect(result.thresholds).toEqual({ 'min-domain-age-days': 30, 'young-domain-days': 365 });
    served(ctx, result);
  });

  it('answers the sandbox’s new, disposable and relay domains as C82.4 lists them', async () => {
    const fresh = completed(await sandboxJob.run(sandbox('kim@new.example')));
    expect(attributesOf(fresh)).toMatchObject({
      'email-reputation': 'low',
      'email-is-suspicious': true,
      'email-reputation-reasons': ['domain_recently_registered'],
    });

    const disposable = completed(await sandboxJob.run(sandbox('kim@disposable.example')));
    expect(attributesOf(disposable)).toMatchObject({
      'email-domain-kind': 'disposable',
      'email-reputation': 'low',
    });

    const relay = completed(await sandboxJob.run(sandbox('kim@relay.example')));
    expect(attributesOf(relay)).toMatchObject({
      'email-domain-kind': 'relay',
      'email-reputation': null,
      'email-is-suspicious': null,
      'email-reputation-reasons': ['privacy_relay'],
    });
  });

  it('reads a bound sandbox breach provider: sandbox-breached is a recent breach (medium)', async () => {
    const ctx = sandbox('kim.sandbox-breached@old.example', {
      providers: {
        domainAge: createSandboxDomainAgeProvider(fixedClock(REPORT_NOW)),
        emailIntelligence: createEmailIntelligenceProvider('sandbox', {
          clock: fixedClock(REPORT_NOW),
        }),
      },
    });
    const result = completed(await sandboxJob.run(ctx));

    expect(attributesOf(result)).toMatchObject({
      'email-reputation': 'medium',
      'email-credentials-leaked-recent': true,
      'email-breach-count': 1,
      'email-reputation-reasons': ['recent_breach'],
    });
    expect(result.provider).toEqual({ id: 'sandbox', sandbox: true });
    served(ctx, result);
  });

  it('lists the breach fields as not configured without a provider, and RDAP likewise', async () => {
    const ctx = context('kim@old.example');
    const result = completed(await sandboxJob.run(ctx));

    expect(reasonOf(result, 'email-credentials-leaked-recent')).toBe('provider_not_configured');
    expect(reasonOf(result, 'email-domain-age-days')).toBe('provider_not_configured');
    expect(result.provider).toBeNull();
  });
});

describe('the email-address report in production (C82.1)', () => {
  it('reads MX with its real names, SPF and DMARC, and RDAP for a custom domain', async () => {
    const age = agedEvery(3650);
    const ctx = production(`kim@${OWNER}`);
    const result = completed(await job(age).run(ctx));

    expect(attributesOf(result)).toMatchObject({
      'email-domain-kind': 'custom',
      'email-domain-exists': true,
      'email-is-valid-mx': true,
      // The preferred exchange (priority 10) names its provider: the names were kept.
      'email-mx-provider': 'google',
      'email-spf-policy': 'fail',
      'email-dmarc-policy': 'reject',
      'email-domain-age-days': 3650,
      'email-reputation': 'high',
    });
    expect(age.asked).toEqual([OWNER]);
    served(ctx, result);
  });

  it('answers NXDOMAIN low (domain_not_found), and asks RDAP nothing for free mail', async () => {
    const age = agedEvery(3650);
    const missing = completed(await job(age).run(production('kim@absent-owner.example')));
    expect(attributesOf(missing)).toMatchObject({
      'email-domain-exists': false,
      'email-reputation': 'low',
      'email-reputation-reasons': ['domain_not_found'],
    });

    await job(age).run(
      production('kim@gmail.com', {
        deps: {
          dnsResolver: createFakeDnsResolver({
            'gmail.com': { mx: [{ exchange: 'gmail-smtp-in.l.google.com', priority: 5 }] },
          }),
        },
      }),
    );
    expect(age.asked).toEqual(['absent-owner.example']);
  });

  it('answers a null MX low (domain_rejects_mail) and reads NODATA by the implicit MX', async () => {
    const zones = {
      'null-mx-owner.example': { mx: [{ exchange: '', priority: 0 }] },
      'implicit-owner.example': { a: ['192.0.2.10'] },
    };
    const refusing = completed(
      await job().run(
        production('kim@null-mx-owner.example', {
          deps: { dnsResolver: createFakeDnsResolver(zones) },
        }),
      ),
    );
    expect(attributesOf(refusing)).toMatchObject({
      'email-domain-exists': true,
      'email-reputation': 'low',
    });
    expect(attributesOf(refusing)['email-reputation-reasons']).toContain('domain_rejects_mail');

    const implicit = completed(
      await job().run(
        production('kim@implicit-owner.example', {
          deps: { dnsResolver: createFakeDnsResolver(zones) },
        }),
      ),
    );
    // NODATA is not NXDOMAIN: the domain exists (its A record, RFC 5321 §5.1), without an MX.
    expect(attributesOf(implicit)).toMatchObject({
      'email-domain-exists': true,
      'email-is-valid-mx': false,
      'email-mx-provider': null,
    });
    expect(attributesOf(implicit)['email-reputation-reasons']).not.toContain('domain_not_found');
  });

  it('retries a DNS timeout while attempts remain, then leaves the band null, never high', async () => {
    await expect(job().run(production('kim@timeout-owner.example'))).rejects.toThrow(
      DnsResolverError,
    );

    const ctx = production('kim@timeout-owner.example', { attempt: 5 });
    const result = completed(await job().run(ctx));
    expect(result.errors).toEqual([]);
    expect(attributesOf(result)).toMatchObject({
      'email-reputation': null,
      'email-reputation-reasons': ['execution_error'],
    });
    expect(reasonOf(result, 'email-reputation')).toBe('execution_error');
    served(ctx, result);
  });

  it('answers without a resolver as not configured, never high', async () => {
    const result = completed(
      await job().run(production(`kim@${OWNER}`, { deps: { dnsResolver: undefined } })),
    );

    expect(attributesOf(result)['email-reputation']).toBeNull();
    expect(reasonOf(result, 'email-is-valid-mx')).toBe('provider_not_configured');
  });

  it('answers an address that is no address low (syntax_invalid), asking nothing', async () => {
    const dns = createFakeDnsResolver(ZONES);
    // The query's own shape passes; C55.8 refuses a domain without a dot.
    const result = completed(
      await job().run(production('kim@localhost', { deps: { dnsResolver: dns } })),
    );

    expect(attributesOf(result)).toMatchObject({
      'email-reputation': 'low',
      'email-reputation-reasons': ['syntax_invalid'],
    });
    expect(dns.queries).toEqual([]);
  });

  it('writes nothing to Valkey: the DNS and RDAP answers are kept in memory only (P15)', async () => {
    const cache = createInMemoryKeyValueCache(fixedClock(REPORT_NOW));

    await job().run(
      production(`kim@${OWNER}`, { deps: { dnsResolver: createFakeDnsResolver(ZONES), cache } }),
    );

    expect(cache.keys()).toEqual([]);
  });

  it('errors a query that is not the type’s with insufficient_input, asking nothing', async () => {
    const dns = createFakeDnsResolver(ZONES);
    const ctx = reportContext({ type: 'email-address', query: {}, deps: { dnsResolver: dns } });
    const result = completed(await job().run(ctx));

    expect(result.errors).toEqual([{ code: 'insufficient_input' }]);
    expect(dns.queries).toEqual([]);
    served(ctx, result);
  });

  it('serves the contracts’ vocabularies', () => {
    expect([...EMAIL_BAND_REASONS]).toEqual([...EMAIL_REPUTATION_REASONS]);
    expect([...EMAIL_DOMAIN_KINDS]).toEqual(['free_mail', 'relay', 'disposable', 'custom']);
    for (const reason of RISK_UNAVAILABLE_REASONS) {
      expect(REPORT_UNAVAILABLE_REASONS).toContain(reason);
    }
  });
});

describe('the email-address report’s deliverability (C82.1, P05)', () => {
  let fixture: ContactJobDatabase;

  beforeAll(async () => {
    fixture = await contactJobDatabase();
  });

  afterAll(async () => {
    await fixture.database.close();
  });

  const address = 'pat.synthetic@old.example';
  const completion = (inquiryId: string, emailAddress: string) =>
    context(emailAddress, {
      db: fixture.db,
      environmentId: fixture.sandboxId,
      origin: 'inquiry_completion',
      inquiryId,
      providers: { domainAge: createSandboxDomainAgeProvider(fixedClock(REPORT_NOW)) },
    });

  it('is true only for a completion report whose inquiry confirmed exactly this address', async () => {
    const { inquiryId } = await submittedOtpVerification(
      fixture,
      fixture.sandboxId,
      'email_address',
      {
        destination: address,
      },
    );
    const sandboxJob = createEmailAddressReportJob({ loadList: () => Promise.resolve(LIST) });

    const confirmed = completed(
      await sandboxJob.run(completion(inquiryId, 'PAT.synthetic@OLD.example')),
    );
    expect(attributesOf(confirmed)['email-is-deliverable']).toBe(true);
    expect(reasonOf(confirmed, 'email-is-deliverable')).toBeUndefined();

    const other = completed(
      await sandboxJob.run(completion(inquiryId, 'someone.else@old.example')),
    );
    expect(attributesOf(other)['email-is-deliverable']).toBeNull();
    expect(reasonOf(other, 'email-is-deliverable')).toBe('not_confirmed');
  });

  it('is never true for a code that was sent but not confirmed', async () => {
    const { inquiryId } = await submittedOtpVerification(
      fixture,
      fixture.sandboxId,
      'email_address',
      {
        destination: address,
        status: 'sent',
      },
    );
    const sandboxJob = createEmailAddressReportJob({ loadList: () => Promise.resolve(LIST) });

    const result = completed(await sandboxJob.run(completion(inquiryId, address)));
    expect(reasonOf(result, 'email-is-deliverable')).toBe('not_confirmed');
  });

  it('is not linked for any other origin, even with the inquiry named', async () => {
    const { inquiryId } = await submittedOtpVerification(
      fixture,
      fixture.sandboxId,
      'email_address',
      {
        destination: address,
      },
    );
    const sandboxJob = createEmailAddressReportJob({ loadList: () => Promise.resolve(LIST) });

    const ctx = completion(inquiryId, address);
    const result = completed(
      await sandboxJob.run({ ...ctx, report: { ...ctx.report, origin: 'api' } }),
    );
    expect(reasonOf(result, 'email-is-deliverable')).toBe('not_linked');
  });
});
