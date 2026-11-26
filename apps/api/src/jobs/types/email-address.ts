/**
 * C54.1, C56: the `email_address` job: the OTP comparison on the stored codes and counts
 * (`services/otp/evidence.ts`), the disposable check against the pinned list
 * (`contact/disposable-list.ts`; none gives `list_unavailable`), and the MX check through the MX
 * resolver over the worker's DNS resolver and cache (`contact/mx-resolver.ts`). The lookup is
 * made only when the MX check is enabled and the sandbox's reserved names do not already decide
 * (no query for them); without a resolver the check answers `provider_not_configured`, and a DNS
 * failure is retried while attempts remain, then recorded as `execution_error` (C30.3). The
 * verification writes no row of its own in the decision, so only its event is staged.
 */
import {
  evaluateEmailAddressChecks,
  sandboxMailDomainRule,
  validateEmailDestination,
  type DisposableDomainList,
  type EmailAddressCheckInput,
} from '@openverify/checks';
import { disposableDomainList } from '../../contact/disposable-list.js';
import { createMxResolver, type MxResolver } from '../../contact/mx-resolver.js';
import { loadOtpEvidence, otpCheckStateOf } from '../../services/otp/evidence.js';
import { attemptProvider } from '../attempts.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import type { TypeEvaluationJob, VerificationTypeJob } from './index.js';

/** What the job reads besides the verification: tests inject their own. */
export interface EmailAddressJobOptions {
  /** The disposable list (`disposableDomainList` by default). */
  loadList?: () => Promise<DisposableDomainList | null>;
  /** The MX lookup over the worker's resolver and cache; none without a resolver. */
  mxResolver?: (deps: ProcessVerificationDeps) => MxResolver | undefined;
}

const MX_CHECK = 'email_address_mx_detection';
const DNS_PROVIDER = Object.freeze({ id: 'dns', sandbox: false });

/** The worker's MX lookup, or none without a DNS resolver. */
function defaultMxResolver(deps: ProcessVerificationDeps): MxResolver | undefined {
  return deps.dnsResolver === undefined
    ? undefined
    : createMxResolver({ dns: deps.dnsResolver, cache: deps.cache });
}

/** The MX answer the check reads, or `undefined` when no lookup is made. */
async function mxOutcome(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
  domain: string | null,
  resolver: MxResolver | undefined,
): Promise<EmailAddressCheckInput['mx']> {
  if (
    domain === null ||
    job.config.checks[MX_CHECK]?.enabled !== true ||
    sandboxMailDomainRule(domain, job.environmentKind) !== null
  ) {
    return undefined;
  }
  if (resolver === undefined) {
    return { kind: 'not_configured' };
  }
  const attempt = await attemptProvider(() => resolver.lookup(domain), {
    lastAttempt: job.lastAttempt,
    logger: deps.logger,
    log: { verificationId: job.verificationId, check: MX_CHECK },
  });
  return attempt.ok
    ? { kind: 'result', provider: DNS_PROVIDER, result: attempt.value }
    : { kind: 'error' };
}

export function createEmailAddressJob(
  options: EmailAddressJobOptions = {},
): VerificationTypeJob<null> {
  const loadList = options.loadList ?? disposableDomainList;
  const mxResolverOf = options.mxResolver ?? defaultMxResolver;
  return {
    type: 'email_address',
    runnable: true,
    async evaluate(deps, job) {
      const evidence = await loadOtpEvidence(deps.db, job.environmentId, job.verificationId);
      const valid =
        evidence.destination === null ? null : validateEmailDestination(evidence.destination);
      const domain = valid?.ok === true ? valid.domain : null;
      return {
        results: evaluateEmailAddressChecks(
          {
            emailAddress: evidence.destination,
            otp: otpCheckStateOf(evidence),
            sender: evidence.sender,
            disposableList: await loadList(),
            mx: await mxOutcome(deps, job, domain, mxResolverOf(deps)),
            environment: job.environmentKind,
          },
          job.config,
        ),
        state: null,
      };
    },
    persistInDecisionTx: (_tx, ctx) => ctx.verificationEvent(),
    onProcessingFailed: () => Promise.resolve([]),
  };
}

export const emailAddressJob = createEmailAddressJob();
