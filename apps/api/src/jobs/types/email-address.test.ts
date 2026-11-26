/**
 * C54.1, C56: the `email_address` job: the OTP comparison as the phone job's; the disposable check
 * against the pinned list (with the template's allow and deny lists; no list gives
 * `list_unavailable`); the MX check through the MX resolver over the worker's DNS resolver and
 * cache, the reserved names deciding in a sandbox environment with no query, `provider_not_configured`
 * without a resolver, a failure retried and then `execution_error`, and no query when the check is
 * disabled. No address or domain in a result. Every address and zone is synthetic.
 */
import type { DisposableDomainList } from '@openverify/checks';
import { defaultTemplateConfig } from '@openverify/core';
import { getInquiry, getVerification } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  contactJobDatabase,
  contactJobDeps,
  decided,
  submittedOtpVerification,
  type ContactJobDatabase,
  type OtpRows,
} from '../../contact/job-testing.js';
import { DnsResolverError } from '../../dns/index.js';
import { otpTemplateAttributes } from '../../services/otp/testing.js';
import {
  createFakeDnsResolver,
  createInMemoryKeyValueCache,
  fixedClock,
} from '../../test-support/fakes.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import { failVerificationAfterError, processVerification } from '../process-verification.js';
import { createEmailAddressJob } from './email-address.js';
import { isRunnableVerificationType } from './index.js';

const LIST_SOURCE = { id: 'synthetic-list@0000000', sha256: 'f'.repeat(64) };
const held = vi.hoisted(() => ({
  list: null as DisposableDomainList | null,
}));
vi.mock('../../contact/disposable-list.js', async (original) => ({
  ...(await original<typeof import('../../contact/disposable-list.js')>()),
  disposableDomainList: () => Promise.resolve(held.list),
}));

const ZONES = {
  'mail.example.org': { mx: [{ exchange: 'mx1.mail.example.org', priority: 10 }] },
  'nullmx.example.org': { mx: [{ exchange: '', priority: 0 }] },
  'slow.example.org': new DnsResolverError('timeout'),
};

let fixture: ContactJobDatabase;

beforeAll(async () => {
  fixture = await contactJobDatabase();
  held.list = { domains: new Set(['trash.example']), source: LIST_SOURCE };
}, 60_000);

afterAll(async () => {
  await fixture.database.close();
});

/** The OTP template, its email checks configured by `email` when given. */
function attributes(email?: ReturnType<typeof defaultTemplateConfig>) {
  const template = otpTemplateAttributes();
  if (email !== undefined) {
    template['verification-config']['email-address'] = email;
  }
  return template;
}

async function judged(
  environment: 'sandbox' | 'production',
  rows: Partial<OtpRows> & { destination: string },
  options: {
    deps?: Partial<ProcessVerificationDeps>;
    email?: ReturnType<typeof defaultTemplateConfig>;
    lastAttempt?: boolean;
  } = {},
) {
  const environmentId = environment === 'sandbox' ? fixture.sandboxId : fixture.productionId;
  const { verificationId } = await submittedOtpVerification(
    fixture,
    environmentId,
    'email_address',
    rows,
    attributes(options.email),
  );
  const outcome = await processVerification(
    { environmentId, verificationId },
    contactJobDeps(fixture, options.deps),
    { lastAttempt: options.lastAttempt === true },
  );
  const verification = await decided(fixture, environmentId, verificationId);
  const check = (name: string) => verification.checks.find((result) => result.name === name);
  return { outcome, verification, check };
}

function dnsDeps() {
  const dns = createFakeDnsResolver(ZONES);
  return { dns, deps: { dnsResolver: dns, cache: createInMemoryKeyValueCache(fixedClock()) } };
}

describe('the email_address job (C56)', () => {
  it('is runnable', () => {
    expect(isRunnableVerificationType('email_address')).toBe(true);
  });

  it('passes a confirmed code at a reserved sandbox name without a DNS query', async () => {
    const { dns, deps } = dnsDeps();

    const { outcome, check, verification } = await judged(
      'sandbox',
      { destination: 'avery@mail.example.test' },
      { deps },
    );

    expect(outcome).toMatchObject({ verificationStatus: 'passed' });
    expect(check('email_address_otp_comparison')).toMatchObject({
      status: 'passed',
      metadata: { channel: 'email', sends: 1, 'failed-attempts': 0 },
      provenance: { provider: { id: 'smtp', sandbox: false } },
    });
    expect(check('email_address_disposable_detection')).toMatchObject({
      status: 'passed',
      metadata: { match: 'none' },
      provenance: { models: [LIST_SOURCE] },
    });
    expect(check('email_address_mx_detection')).toMatchObject({
      status: 'passed',
      metadata: { route: 'reserved' },
    });
    expect(dns.queries).toEqual([]);
    expect(JSON.stringify(verification.checks)).not.toMatch(/avery|example\.test/u);
  });

  it('asks DNS in production: a mail server passes, NXDOMAIN and a null MX fail the advisory check', async () => {
    const { deps } = dnsDeps();

    const found = await judged('production', { destination: 'avery@mail.example.org' }, { deps });
    const missing = await judged(
      'production',
      { destination: 'avery@missing.example.org' },
      { deps },
    );
    const refusing = await judged(
      'production',
      { destination: 'avery@nullmx.example.org' },
      { deps },
    );

    expect(found.check('email_address_mx_detection')).toMatchObject({
      status: 'passed',
      metadata: { route: 'mx', 'record-count': 1 },
      provenance: { provider: { id: 'dns', sandbox: false } },
    });
    expect(missing.check('email_address_mx_detection')).toMatchObject({
      status: 'failed',
      reasons: ['domain_not_found'],
    });
    expect(refusing.check('email_address_mx_detection')).toMatchObject({
      status: 'failed',
      reasons: ['domain_rejects_mail'],
    });
    expect(missing.outcome).toMatchObject({ verificationStatus: 'passed' });
    expect(JSON.stringify(found.verification.checks)).not.toContain('mail.example.org');
  });

  it('answers provider_not_configured without a resolver, never a pass', async () => {
    const { check } = await judged('production', { destination: 'avery@mail.example.org' });

    expect(check('email_address_mx_detection')).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
    });
  });

  it('retries a DNS failure, then records execution_error on the last attempt', async () => {
    const { deps } = dnsDeps();
    const rows = { destination: 'avery@slow.example.org' };

    await expect(judged('production', rows, { deps })).rejects.toMatchObject({
      name: 'DnsResolverError',
      code: 'timeout',
    });
    const last = await judged('production', rows, { deps, lastAttempt: true });

    expect(last.check('email_address_mx_detection')).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });

  it('makes no DNS query when the MX check is disabled', async () => {
    const { dns, deps } = dnsDeps();
    const config = defaultTemplateConfig('email_address');
    const email = {
      ...config,
      checks: Object.fromEntries(
        Object.entries(config.checks).filter(([name]) => name !== 'email_address_mx_detection'),
      ),
    };

    const { check } = await judged(
      'production',
      { destination: 'avery@mail.example.org' },
      { deps, email },
    );

    expect(check('email_address_mx_detection')).toBeUndefined();
    expect(dns.queries).toEqual([]);
  });

  it('fails a listed or denied domain as disposable (advisory), and the verification still passes', async () => {
    const config = defaultTemplateConfig('email_address');
    const email = {
      ...config,
      checks: {
        ...config.checks,
        email_address_disposable_detection: {
          enabled: true,
          required: false,
          config: { 'deny-domains': ['disposable.test'] },
        },
      },
    };

    const listed = await judged('sandbox', { destination: 'avery@trash.example' });
    const denied = await judged('sandbox', { destination: 'avery@disposable.test' }, { email });

    expect(listed.check('email_address_disposable_detection')).toMatchObject({
      status: 'failed',
      reasons: ['disposable_domain'],
      metadata: { match: 'listed' },
    });
    expect(denied.check('email_address_disposable_detection')).toMatchObject({
      status: 'failed',
      reasons: ['disposable_domain'],
      metadata: { match: 'denied' },
    });
    expect(denied.outcome).toMatchObject({ verificationStatus: 'passed' });
  });

  it('answers list_unavailable without the list file', async () => {
    held.list = null;
    try {
      const { check } = await judged('sandbox', { destination: 'avery@mail.example.test' });

      expect(check('email_address_disposable_detection')).toMatchObject({
        status: 'not_applicable',
        reasons: ['list_unavailable'],
      });
    } finally {
      held.list = { domains: new Set(['trash.example']), source: LIST_SOURCE };
    }
  });

  it('takes its list and MX resolver from its options', async () => {
    const lookups: string[] = [];
    const job = createEmailAddressJob({
      loadList: () =>
        Promise.resolve({ domains: new Set(['injected.example']), source: LIST_SOURCE }),
      mxResolver: () => ({
        lookup: (domain) => {
          lookups.push(domain);
          return Promise.resolve({ kind: 'mx', exchanges: ['exchange'] });
        },
      }),
    });
    const { inquiryId, verificationId } = await submittedOtpVerification(
      fixture,
      fixture.productionId,
      'email_address',
      { destination: 'Avery@Injected.Example' },
    );
    const inquiry = await getInquiry(fixture.db, fixture.productionId, inquiryId);
    const verification = await getVerification(fixture.db, fixture.productionId, verificationId);
    const template = otpTemplateAttributes();
    const config = template['verification-config']['email-address'];
    if (inquiry === null || verification === null || config === undefined) {
      throw new Error('missing fixture rows');
    }

    const { results } = await job.evaluate(contactJobDeps(fixture), {
      environmentId: fixture.productionId,
      environmentKind: 'production',
      inquiry,
      verificationId,
      verification,
      files: [],
      config,
      flow: template.flow,
      lastAttempt: false,
      now: new Date(),
    });

    expect(
      results.find((result) => result.name === 'email_address_disposable_detection'),
    ).toMatchObject({ status: 'failed', reasons: ['disposable_domain'] });
    expect(results.find((result) => result.name === 'email_address_mx_detection')).toMatchObject({
      status: 'passed',
    });
    expect(lookups).toEqual(['injected.example']);
  });

  it('fails a verification whose processing cannot finish, staging nothing of its own', async () => {
    const { verificationId } = await submittedOtpVerification(
      fixture,
      fixture.sandboxId,
      'email_address',
      { destination: 'avery@mail.example.test' },
    );

    const failed = await failVerificationAfterError(
      { environmentId: fixture.sandboxId, verificationId },
      contactJobDeps(fixture),
      'synthetic_failure',
    );

    expect(failed).toMatchObject({ outcome: 'failed' });
    expect((await decided(fixture, fixture.sandboxId, verificationId)).status).toBe('failed');
  });
});
