/**
 * C82.1: the `email-address` report job (Workflow 6A Stage 3, owner `api-providers`), behind the
 * frozen `ReportTypeJob` of `jobs/report-types/index.ts`, over risk-logic's
 * `evaluateEmailAddressReport`. What it asks, and where the answers live:
 *
 * - **DNS** through the worker's resolver wrapped in the report DNS cache (`dns/txt.ts`, in
 *   process memory, never Valkey, P15): MX with the exchanges' real names (most preferred first,
 *   so the MX provider can be named; C56's masked Valkey cache is never read), the domain's TXT
 *   records (SPF, RFC 7208, `include:` not followed) and the RFC 9989 DMARC walk. A sandbox
 *   reserved name (C82.4) asks no DNS, and an address that is no address asks nothing.
 * - **RDAP** through the registered-domain mode of the `domainAge` binding (C85.3), for a custom
 *   domain only; its dates are kept in memory per environment, never in Valkey.
 * - **Breaches** from the bound `emailIntelligence` provider (`hibp`, `sandbox`).
 * - **Deliverability** from the inquiry's confirmed email code, for a completion report only (P05).
 *
 * The answer is `ready` with every field it could compute; a field it could not is `null` in
 * `unavailable-fields` with its reason, and a lookup that failed for good leaves the band `null`
 * when it could have reached a worse one, never `high` (C69.4, H07).
 */
import {
  classifyEmailDomain,
  emailReportDomainOf,
  evaluateEmailAddressReport,
  sandboxMailDomainRule,
  shouldQueryEmailDomainAge,
  walkDmarc,
  type DisposableDomainList,
  type DmarcLookup,
  type DomainAgeLookup,
  type EmailBreachLookup,
  type MxLookupResult,
  type ProviderOutcome,
  type TxtAnswer,
} from '@openverify/checks';
import { emailAddressQuerySchema } from '@openverify/contracts';
import { disposableDomainList } from '../../contact/disposable-list.js';
import { DnsResolverError } from '../../dns/index.js';
import { createCachedDnsResolver } from '../../dns/txt.js';
import {
  createRegisteredDomainAgeProvider,
  type RegisteredDomainAgeProvider,
} from '../../providers/domain-age/registered-domain.js';
import type { DnsResolver } from '../../ports.js';
import type { ReportJobDeps, ReportRunContext, ReportTypeJob, RunOutcome } from './job.js';
import {
  answeringProvider,
  contactConfirmationOf,
  erroredResult,
  providerOutcome,
  recordedFailure,
} from './provider-reports.js';

/** What the job reads besides the report: tests inject their own. */
export interface EmailAddressReportJobOptions {
  /** The disposable list (`disposableDomainList` by default). */
  loadList?: (() => Promise<DisposableDomainList | null>) | undefined;
  /** The registered-domain mode of the `domainAge` binding named `name`. */
  domainAge?:
    ((deps: ReportJobDeps, name: 'rdap' | 'sandbox') => RegisteredDomainAgeProvider) | undefined;
}

/** The DNS that answered (risk-logic's provider identity of a lookup). */
const DNS = { id: 'dns', sandbox: false } as const;

/** RFC 7505: a null MX names the root, `.`, which Node returns as the empty name. */
const isNullMx = (exchange: string) => exchange === '' || exchange === '.';

/** One cached resolver per worker resolver, so the report DNS cache outlives a run. */
const cachedResolvers = new WeakMap<DnsResolver, DnsResolver>();

function reportResolver(deps: ReportJobDeps): DnsResolver | undefined {
  const dns = deps.dnsResolver;
  if (dns === undefined) {
    return undefined;
  }
  let cached = cachedResolvers.get(dns);
  if (cached === undefined) {
    cached = createCachedDnsResolver(dns, { clock: deps.clock });
    cachedResolvers.set(dns, cached);
  }
  return cached;
}

/** One registered-domain mode per worker deps and binding, so its day of dates outlives a run. */
const domainAgeModes = new WeakMap<ReportJobDeps, Map<string, RegisteredDomainAgeProvider>>();

function defaultDomainAge(deps: ReportJobDeps, name: 'rdap' | 'sandbox') {
  let modes = domainAgeModes.get(deps);
  if (modes === undefined) {
    modes = new Map();
    domainAgeModes.set(deps, modes);
  }
  let mode = modes.get(name);
  if (mode === undefined) {
    mode = createRegisteredDomainAgeProvider(name, {
      outboundHttp: deps.outboundHttp,
      cache: deps.cache,
      rateLimiter: deps.rateLimiter,
      clock: deps.clock,
    });
    modes.set(name, mode);
  }
  return mode;
}

/** A lookup's records, or `null` for NXDOMAIN and NODATA; any other failure is thrown. */
async function recordsOrNone<T>(query: () => Promise<T[]>): Promise<T[] | null> {
  try {
    return await query();
  } catch (error) {
    if (error instanceof DnsResolverError && !error.retryable) {
      return null;
    }
    throw error;
  }
}

/**
 * MX with the exchanges' names, most preferred first; on NODATA the domain's own A and AAAA
 * records (the RFC 5321 §5.1 implicit MX); NXDOMAIN as `not_found`.
 */
async function mailOf(dns: DnsResolver, domain: string): Promise<MxLookupResult> {
  let records: Awaited<ReturnType<DnsResolver['resolveMx']>>;
  try {
    records = await dns.resolveMx(domain);
  } catch (error) {
    if (error instanceof DnsResolverError && error.code === 'not_found') {
      return { kind: 'not_found' };
    }
    if (!(error instanceof DnsResolverError && error.code === 'no_data')) {
      throw error;
    }
    records = [];
  }
  if (records.length > 0) {
    return {
      kind: 'mx',
      exchanges: [...records]
        .sort((a, b) => a.priority - b.priority)
        .map(({ exchange }) => (isNullMx(exchange) ? '' : exchange.toLowerCase())),
    };
  }
  const addresses =
    ((await recordsOrNone(() => dns.resolve4(domain))) ?? []).length +
    ((await recordsOrNone(() => dns.resolve6(domain))) ?? []).length;
  return { kind: 'no_mx', addressRecords: addresses };
}

/** Whether the author domain exists for the DMARC walk: `null` when MX could not say. */
function authorDomainExists(mx: ProviderOutcome<MxLookupResult>): boolean | null {
  if (mx.kind !== 'result') {
    return null;
  }
  return mx.result.kind !== 'not_found';
}

/** A resolved configuration's number, or `undefined` for the evaluator's default. */
const numberOf = (value: unknown) => (typeof value === 'number' ? value : undefined);

/** Two addresses are the same when they are equal once trimmed and lower-cased (C55.8). */
const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface DnsAnswers {
  mx?: ProviderOutcome<MxLookupResult>;
  txt?: ProviderOutcome<TxtAnswer>;
  dmarc?: Awaited<ReturnType<typeof walkDmarc>> | { kind: 'not_configured' };
}

async function dnsAnswers(
  ctx: ReportRunContext,
  dns: DnsResolver | undefined,
  domain: string,
): Promise<DnsAnswers> {
  if (dns === undefined) {
    return {
      mx: { kind: 'not_configured' },
      txt: { kind: 'not_configured' },
      dmarc: { kind: 'not_configured' },
    };
  }
  let mx: ProviderOutcome<MxLookupResult>;
  try {
    mx = { kind: 'result', provider: DNS, result: await mailOf(dns, domain) };
  } catch (error) {
    mx = recordedFailure(ctx, error);
  }
  let txt: ProviderOutcome<TxtAnswer>;
  try {
    const records = await recordsOrNone(() => dns.resolveTxt(domain));
    txt = {
      kind: 'result',
      provider: DNS,
      result: records === null ? { kind: 'none' } : { kind: 'records', records },
    };
  } catch (error) {
    txt = recordedFailure(ctx, error);
  }
  const lookup = async (name: string): Promise<DmarcLookup> => {
    try {
      const records = await recordsOrNone(() => dns.resolveTxt(name));
      return records === null ? { kind: 'none' } : { kind: 'records', records };
    } catch (error) {
      return recordedFailure(ctx, error);
    }
  };
  const dmarc = await walkDmarc(domain, lookup, authorDomainExists(mx));
  return { mx, txt, dmarc };
}

async function domainAgeOf(
  ctx: ReportRunContext,
  options: EmailAddressReportJobOptions,
  domain: string,
): Promise<ProviderOutcome<DomainAgeLookup>> {
  const binding = ctx.providers.domainAge;
  if (binding === undefined) {
    return { kind: 'not_configured' };
  }
  const name = binding.id === 'sandbox' ? 'sandbox' : 'rdap';
  const mode = (options.domainAge ?? defaultDomainAge)(ctx.deps, name);
  return providerOutcome(ctx, mode, async (bound): Promise<DomainAgeLookup> => {
    const answer = await bound.registeredDomainAge({
      domain,
      scope: ctx.report.environmentId,
    });
    return answer.outcome === 'registered'
      ? { outcome: 'registered', registeredAt: answer.registeredAt, domain: answer.domain }
      : { outcome: 'unavailable', reason: answer.reason };
  });
}

async function run(
  ctx: ReportRunContext,
  options: EmailAddressReportJobOptions,
): Promise<RunOutcome> {
  const query = emailAddressQuerySchema.safeParse(ctx.report.query);
  if (!query.success) {
    return { kind: 'completed', result: erroredResult('insufficient_input') };
  }
  const emailAddress = query.data['email-address'];
  const environment = ctx.report.environmentKind;
  const now = ctx.deps.clock.now();
  const disposableList = await (options.loadList ?? disposableDomainList)();
  const confirmation = await contactConfirmationOf(ctx, 'email_address', (destination) =>
    sameAddress(destination, emailAddress),
  );
  const domain = emailReportDomainOf(emailAddress);
  let answers: DnsAnswers = {};
  let domainAge: ProviderOutcome<DomainAgeLookup> | undefined;
  let breach: ProviderOutcome<EmailBreachLookup> = { kind: 'not_configured' };
  if (domain !== null) {
    if (sandboxMailDomainRule(domain, environment) === null) {
      answers = await dnsAnswers(ctx, reportResolver(ctx.deps), domain);
    }
    const { kind } = classifyEmailDomain(domain, {
      disposable: disposableList?.domains ?? null,
      environment,
    });
    if (shouldQueryEmailDomainAge(kind)) {
      domainAge = await domainAgeOf(ctx, options, domain);
    }
    breach = await providerOutcome(ctx, ctx.providers.emailIntelligence, (bound) =>
      bound.breaches({ emailAddress }),
    );
  }
  const evaluation = evaluateEmailAddressReport({
    emailAddress,
    environment,
    now,
    config: {
      'min-domain-age-days': numberOf(ctx.report.config['min-domain-age-days']),
      'young-domain-days': numberOf(ctx.report.config['young-domain-days']),
    },
    disposableList,
    ...answers,
    ...(domainAge === undefined ? {} : { domainAge }),
    breach,
    confirmation,
  });
  return {
    kind: 'completed',
    result: {
      errors: [],
      sources: [],
      coverage: null,
      result: { ...evaluation.fields, details: evaluation.details },
      unavailableFields: evaluation.unavailableFields,
      provider: answeringProvider(breach),
      thresholds: evaluation.thresholds,
      notices: [],
      matcherVersion: null,
      matches: [],
    },
  };
}

/** The job, with the disposable list and the RDAP mode `options` names. */
export function createEmailAddressReportJob(
  options: EmailAddressReportJobOptions = {},
): ReportTypeJob {
  return { type: 'email-address', run: (ctx) => run(ctx, options) };
}

export const emailAddressReportJob: ReportTypeJob = createEmailAddressReportJob();
