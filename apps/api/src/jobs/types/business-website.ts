/**
 * C54.1, C61.3-C61.5: the `business_website` job. It reads the URL the user entered
 * (`verification_inputs`) and takes its host (`websiteHostOf`: lower-case ASCII, never an IP
 * literal). The resolution check asks the worker's DNS resolver for the host's A and AAAA records
 * (C61.3: no HTTP fetch; in a sandbox environment `*.example` and `*.test` resolve and `*.invalid`
 * does not, with no query); the domain age, malicious-website and backlink checks ask their bound
 * providers with the host alone (the feeds also get the URL, of which they read only the host).
 * Each is asked only when its check is enabled. An unbound provider or resolver is
 * `provider_not_configured`; a failure a retry may cure is retried, then `execution_error` on the
 * last attempt (C30.3). The site itself is never fetched, and the decision writes no row of its
 * own: the domain's registration date is read back from the domain age check's metadata.
 */
import {
  evaluateBusinessWebsiteChecks,
  sandboxWebsiteHostRule,
  websiteHostOf,
  type BusinessWebsiteValues,
  type ProviderOutcome,
  type WebsiteHostResolution,
} from '@openverify/checks';
import type { CheckId } from '@openverify/core';
import { getVerificationInputs } from '@openverify/db';
import { DnsResolverError } from '../../dns/index.js';
import type { DnsResolver } from '../../ports.js';
import { attemptProvider } from '../attempts.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import { askProvider } from './database.js';
import type { TypeEvaluationJob, VerificationTypeJob } from './index.js';

const RESOLUTION: CheckId = 'business_website_resolution_detection';
const DOMAIN_AGE: CheckId = 'business_website_domain_age_detection';
const MALICIOUS: CheckId = 'business_website_malicious_website_detection';
const BACKLINK: CheckId = 'business_website_backlink_detection';

/** The resolution's provenance: the worker's own resolver (C61.3). */
const DNS_PROVIDER = Object.freeze({ id: 'dns', sandbox: false });

const enabled = (job: TypeEvaluationJob, check: CheckId) =>
  job.config.checks[check]?.enabled === true;

/** The entered values the evaluators read. */
function websiteValuesOf(
  values: Readonly<Record<string, unknown>> | null,
): BusinessWebsiteValues | null {
  if (values === null) {
    return null;
  }
  const url = values['website-url'];
  const name = values['business-name'];
  return {
    'website-url': typeof url === 'string' ? url : undefined,
    'business-name': typeof name === 'string' ? name : undefined,
  };
}

/**
 * C61.3: the host's A and AAAA answers. A name that does not exist is `not_found`; a name with no
 * address record `no_address`. Any other failure is thrown, for the retry rule.
 */
async function resolveHost(dns: DnsResolver, host: string): Promise<WebsiteHostResolution> {
  const answers = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
  const addresses = answers.flatMap((answer) =>
    answer.status === 'fulfilled' ? answer.value : [],
  );
  if (addresses.length > 0) {
    return { kind: 'addresses', addresses };
  }
  const failures = answers.flatMap((answer) =>
    answer.status === 'rejected' ? [answer.reason as unknown] : [],
  );
  const cured = failures.find(
    (failure) =>
      !(failure instanceof DnsResolverError) ||
      (failure.code !== 'not_found' && failure.code !== 'no_data'),
  );
  if (cured !== undefined) {
    throw cured instanceof Error ? cured : new DnsResolverError('failed');
  }
  return failures.some((failure) => (failure as DnsResolverError).code === 'not_found')
    ? { kind: 'not_found' }
    : { kind: 'no_address' };
}

/** The resolution the check reads, or `undefined` when the check or the sandbox rule decides. */
async function resolution(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
  host: string,
): Promise<ProviderOutcome<WebsiteHostResolution> | undefined> {
  if (!enabled(job, RESOLUTION) || sandboxWebsiteHostRule(host, job.environmentKind) !== null) {
    return undefined;
  }
  const dns = deps.dnsResolver;
  if (dns === undefined) {
    return { kind: 'not_configured' };
  }
  const attempt = await attemptProvider(() => resolveHost(dns, host), {
    lastAttempt: job.lastAttempt,
    logger: deps.logger,
    log: { verificationId: job.verificationId, check: RESOLUTION },
  });
  return attempt.ok
    ? { kind: 'result', provider: DNS_PROVIDER, result: attempt.value }
    : { kind: 'error' };
}

async function evaluateWebsite(deps: ProcessVerificationDeps, job: TypeEvaluationJob) {
  const inputs = await getVerificationInputs(deps.db, job.environmentId, job.verificationId);
  const values = websiteValuesOf(inputs?.values ?? null);
  const url = values?.['website-url'] ?? null;
  const host = url === null ? null : websiteHostOf(url);
  const bound = deps.providers?.[job.environmentKind];
  const context = (check: CheckId) => ({
    lastAttempt: job.lastAttempt,
    logger: deps.logger,
    log: { verificationId: job.verificationId, check },
  });
  if (host === null || url === null) {
    return evaluateBusinessWebsiteChecks(
      { values, environment: job.environmentKind, now: job.now },
      job.config,
    );
  }
  return evaluateBusinessWebsiteChecks(
    {
      values,
      resolution: await resolution(deps, job, host),
      ...(enabled(job, DOMAIN_AGE)
        ? {
            domainAge: await askProvider(
              bound?.domainAge,
              (provider) => provider.age({ host }),
              context(DOMAIN_AGE),
            ),
          }
        : {}),
      ...(enabled(job, MALICIOUS)
        ? {
            maliciousWebsite: await askProvider(
              bound?.maliciousWebsite,
              (provider) => provider.check({ host, url }),
              context(MALICIOUS),
            ),
          }
        : {}),
      ...(enabled(job, BACKLINK)
        ? {
            backlink: await askProvider(
              bound?.backlink,
              (provider) => provider.count({ host }),
              context(BACKLINK),
            ),
          }
        : {}),
      environment: job.environmentKind,
      now: job.now,
    },
    job.config,
  );
}

export const businessWebsiteJob: VerificationTypeJob<null> = {
  type: 'business_website',
  runnable: true,
  async evaluate(deps, job) {
    return { results: await evaluateWebsite(deps, job), state: null };
  },
  persistInDecisionTx: (_tx, ctx) => ctx.verificationEvent(),
  onProcessingFailed: () => Promise.resolve([]),
};
