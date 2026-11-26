/**
 * The `business_website` job (C61.3-C61.5) through `processVerification`: the entered URL's host
 * is resolved through the worker's DNS resolver (no HTTP fetch; in a sandbox environment the
 * reserved names decide with no query), and aged, looked up in the feeds and counted for
 * backlinks through the bound providers, each asked only when its check is enabled and given the
 * host alone. An unbound provider or resolver is `provider_not_configured`; a failing one is
 * retried, then `execution_error`. The decision writes no row of its own. Every name is reserved.
 */
import { newId } from '@openverify/contracts';
import { defaultTemplateConfig, type VerificationTemplateConfig } from '@openverify/core';
import {
  createVerification,
  getVerification,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedVerificationInputs,
  type TestDatabase,
} from '@openverify/db/testing';
import { flowSchema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DnsResolverError } from '../../dns/index.js';
import { createEventPublisher } from '../../events/index.js';
import type { BoundProviders, DomainAgeProvider, MaliciousWebsiteProvider } from '../../ports.js';
import { createBacklinkProvider } from '../../providers/backlink/index.js';
import { createDomainAgeProvider } from '../../providers/domain-age/index.js';
import { createMaliciousWebsiteProvider } from '../../providers/malicious-website/index.js';
import { createFakeDnsResolver, type FakeDnsZone } from '../../test-support/fakes.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import { processVerification, type ProcessVerificationDeps } from '../process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from '../testing.js';
import { businessWebsiteJob } from './business-website.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');

const FLOW = flowSchema.parse({
  metadata: { specVersion: 1, id: 'kyb-website', version: 1, name: 'Business website' },
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
    { id: 'website', type: 'business_website' },
    { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
  ],
  transitions: [],
});

/** Every website check enabled, the domain age, feeds and backlinks advisory. */
const ALL_CHECKS: VerificationTemplateConfig = {
  checks: {
    business_website_resolution_detection: { enabled: true, required: true },
    business_website_domain_age_detection: { enabled: true, required: false },
    business_website_malicious_website_detection: { enabled: true, required: false },
    business_website_backlink_detection: { enabled: true, required: false },
  },
};

let database: TestDatabase;
let db: Db;
let sandboxEnvironment: string;
let productionEnvironment: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  sandboxEnvironment = (await createTestTenant(db)).environment.id;
  productionEnvironment = (await createTestTenant(db, { kind: 'production' })).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

interface Target {
  id: string;
  environmentId: string;
}

/** A submitted website verification of a pending inquiry, with its entered URL. */
async function submitted(
  url: string | null,
  options: { config?: VerificationTemplateConfig; production?: boolean } = {},
): Promise<Target> {
  const environmentId = options.production === true ? productionEnvironment : sandboxEnvironment;
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: FLOW,
    verificationConfig: {
      'business-website': options.config ?? defaultTemplateConfig('business_website'),
    },
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const id = newId('ver');
  await createVerification(db, environmentId, {
    id,
    inquiryId: inquiry.id,
    type: 'business_website',
  });
  if (url !== null) {
    await seedVerificationInputs(db, environmentId, {
      verificationId: id,
      inquiryId: inquiry.id,
      values: { 'website-url': url, 'business-name': 'Utopia Synthetic Widgets Ltd' },
    });
  }
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  return { id, environmentId };
}

function setup(
  options: {
    sandbox?: BoundProviders;
    production?: BoundProviders;
    zones?: Record<string, FakeDnsZone | DnsResolverError>;
    resolver?: boolean;
  } = {},
) {
  const logger = createCapturingLogger();
  const dns = createFakeDnsResolver(options.zones ?? {});
  const deps: ProcessVerificationDeps = {
    db,
    storage: createMemoryStorage(),
    keyring: database.keyring,
    vision: createFakeVision().client,
    events: createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
      logger,
    }),
    clock: { now: () => NOW },
    logger,
    providers: { sandbox: options.sandbox ?? {}, production: options.production ?? {} },
    ...(options.resolver === false ? {} : { dnsResolver: dns }),
  };
  return { deps, dns, logger };
}

const SANDBOX_PROVIDERS: BoundProviders = {
  domainAge: createDomainAgeProvider('sandbox', { clock: { now: () => NOW } }),
  maliciousWebsite: createMaliciousWebsiteProvider('sandbox'),
  backlink: createBacklinkProvider('sandbox'),
};

const job = ({ id, environmentId }: Target) => ({ environmentId, verificationId: id });

async function checksOf({ id, environmentId }: Target) {
  const checks = (await getVerification(db, environmentId, id))?.checks ?? [];
  return Object.fromEntries(checks.map((check) => [check.name, check]));
}

describe('processVerification: business_website (C61)', () => {
  it('is built and runnable', () => {
    expect(businessWebsiteJob).toMatchObject({ type: 'business_website', runnable: true });
  });

  it('passes old.example in a sandbox environment: reserved, so resolved with no query, and twenty years old', async () => {
    const target = await submitted('https://www.old.example/about');
    const { deps, dns } = setup({ sandbox: SANDBOX_PROVIDERS });

    const result = await processVerification(job(target), deps);

    expect(result).toMatchObject({ verificationStatus: 'passed', inquiryStatus: 'completed' });
    const checks = await checksOf(target);
    expect(checks.business_website_resolution_detection).toMatchObject({
      status: 'passed',
      requirement: 'required',
      metadata: { route: 'reserved' },
    });
    expect(checks.business_website_domain_age_detection).toMatchObject({
      status: 'passed',
      metadata: { 'registered-at': '2006-10-24' },
      provenance: { provider: { id: 'sandbox', sandbox: true } },
    });
    expect(checks).not.toHaveProperty('business_website_malicious_website_detection');
    expect(dns.queries).toEqual([]);
  });

  it('fails new.example’s domain age, advisory, while the verification passes', async () => {
    const target = await submitted('https://new.example/');

    const result = await processVerification(
      job(target),
      setup({ sandbox: SANDBOX_PROVIDERS }).deps,
    );

    expect(result).toMatchObject({ verificationStatus: 'passed' });
    expect((await checksOf(target)).business_website_domain_age_detection).toMatchObject({
      status: 'failed',
      reasons: ['domain_recently_registered'],
    });
  });

  it('fails a .invalid host as domain_not_resolving, a mistyped URL', async () => {
    const target = await submitted('https://utopia.invalid/');

    const result = await processVerification(
      job(target),
      setup({ sandbox: SANDBOX_PROVIDERS }).deps,
    );

    expect(result).toMatchObject({ verificationStatus: 'failed' });
    expect((await checksOf(target)).business_website_resolution_detection).toMatchObject({
      status: 'failed',
      reasons: ['domain_not_resolving'],
    });
  });

  it('asks the feeds and the backlinks when their checks are enabled', async () => {
    const listed = await submitted('https://login.malicious.example/', { config: ALL_CHECKS });
    const linked = await submitted('https://backlinks.example/', { config: ALL_CHECKS });

    await processVerification(job(listed), setup({ sandbox: SANDBOX_PROVIDERS }).deps);
    await processVerification(job(linked), setup({ sandbox: SANDBOX_PROVIDERS }).deps);

    expect((await checksOf(listed)).business_website_malicious_website_detection).toMatchObject({
      status: 'failed',
      reasons: ['phishing'],
    });
    expect((await checksOf(listed)).business_website_backlink_detection).toMatchObject({
      status: 'failed',
      reasons: ['backlinks_below_threshold'],
    });
    expect((await checksOf(linked)).business_website_backlink_detection).toMatchObject({
      status: 'passed',
      metadata: { 'backlink-count': 250, 'backlink-threshold': 10 },
    });
    expect((await checksOf(linked)).business_website_malicious_website_detection).toMatchObject({
      status: 'passed',
    });
  });

  it('gives each provider the host alone, the feeds the URL too', async () => {
    const target = await submitted('https://www.utopia-widgets.example/shop?ref=synthetic', {
      config: ALL_CHECKS,
      production: true,
    });
    const aged: unknown[][] = [];
    const checked: unknown[][] = [];
    const domainAge: DomainAgeProvider = {
      id: 'rdap',
      sandbox: false,
      age: (...args: unknown[]) => {
        aged.push(args);
        return Promise.resolve({ outcome: 'unavailable', reason: 'not_found' });
      },
    };
    const maliciousWebsite: MaliciousWebsiteProvider = {
      id: 'feed-list',
      sandbox: false,
      check: (...args: unknown[]) => {
        checked.push(args);
        return Promise.resolve({ outcome: 'not_listed', feeds: ['synthetic'] });
      },
    };
    const { deps, dns } = setup({
      production: { domainAge, maliciousWebsite },
      zones: { 'www.utopia-widgets.example': { a: ['203.0.114.7'] } },
    });

    await processVerification(job(target), deps);

    expect(aged).toEqual([[{ host: 'www.utopia-widgets.example' }]]);
    expect(checked).toEqual([
      [
        {
          host: 'www.utopia-widgets.example',
          url: 'https://www.utopia-widgets.example/shop?ref=synthetic',
        },
      ],
    ]);
    expect(dns.queries.map((query) => query.hostname)).toEqual([
      'www.utopia-widgets.example',
      'www.utopia-widgets.example',
    ]);
    expect((await checksOf(target)).business_website_backlink_detection).toMatchObject({
      reasons: ['provider_not_configured'],
    });
  });

  it('resolves a production host through DNS: a public address passes, only private ones or none fail', async () => {
    const zones = {
      'public.example': { a: ['203.0.114.7'], aaaa: ['2001:db9::7'] },
      'private.example': { a: ['10.0.0.7'] },
      'empty.example': {},
    };
    const results: Record<string, unknown> = {};
    for (const host of ['public.example', 'private.example', 'empty.example', 'gone.example']) {
      const target = await submitted(`https://${host}/`, { production: true });
      await processVerification(job(target), setup({ zones }).deps);
      results[host] = (await checksOf(target)).business_website_resolution_detection;
    }

    expect(results['public.example']).toMatchObject({
      status: 'passed',
      metadata: { route: 'dns', 'address-count': 2, 'public-address-count': 2 },
      provenance: { provider: { id: 'dns', sandbox: false } },
    });
    expect(results['private.example']).toMatchObject({
      status: 'failed',
      reasons: ['domain_not_resolving'],
    });
    expect(results['empty.example']).toMatchObject({
      status: 'failed',
      metadata: { route: 'no-address' },
    });
    expect(results['gone.example']).toMatchObject({
      status: 'failed',
      metadata: { route: 'nxdomain' },
    });
  });

  it('retries a DNS failure while attempts remain, then records execution_error', async () => {
    const target = await submitted('https://slow.example/', { production: true });
    const { deps } = setup({ zones: { 'slow.example': new DnsResolverError('timeout') } });

    await expect(processVerification(job(target), deps)).rejects.toThrow(DnsResolverError);
    const result = await processVerification(job(target), deps, { lastAttempt: true });

    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    expect((await checksOf(target)).business_website_resolution_detection).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });

  it('answers provider_not_configured without a resolver or a domain age provider', async () => {
    const target = await submitted('https://utopia-widgets.example/', { production: true });

    const result = await processVerification(job(target), setup({ resolver: false }).deps);

    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    const checks = await checksOf(target);
    expect(checks.business_website_resolution_detection).toMatchObject({
      reasons: ['provider_not_configured'],
    });
    expect(checks.business_website_domain_age_detection).toMatchObject({
      reasons: ['provider_not_configured'],
    });
  });

  it('asks nothing without entered values', async () => {
    const target = await submitted(null);
    const { deps, dns } = setup({ sandbox: SANDBOX_PROVIDERS });

    await processVerification(job(target), deps);

    expect(dns.queries).toEqual([]);
    expect((await checksOf(target)).business_website_resolution_detection).toMatchObject({
      reasons: ['input_missing'],
    });
  });

  it('keeps the URL and its host out of every result', async () => {
    const target = await submitted('https://www.utopia-widgets.example/shop', {
      config: ALL_CHECKS,
      production: true,
    });

    await processVerification(
      job(target),
      setup({ zones: { 'www.utopia-widgets.example': { a: ['203.0.114.7'] } } }).deps,
    );

    expect(JSON.stringify(await checksOf(target))).not.toContain('utopia');
  });
});
