/**
 * C54.1, C59.1, C59.3: the `database` job. It reads the values the user entered
 * (`verification_inputs`), asks the environment's `database` provider about the country and the
 * step's collected fields (a real adapter receives that request alone; the sandbox provider also
 * the inquiry's reference id, for its magic tokens, C59.2), and runs the C59 evaluators of
 * `@openverify/checks` on the answer, the collected fields and the inquiry's own fields. No
 * provider is asked when no enabled check needs one; an unbound provider is
 * `provider_not_configured`, and a failed one is retried, then `execution_error` on the last
 * attempt (C30.3). The provider's record stays in memory: nothing but the check results (levels,
 * methods, flags, field names) is written, and no value is logged. The decision writes no row of
 * its own.
 */
import { comparisonSourceFor } from '../../flow-engine/initial-fields.js';
import {
  DATABASE_VALUE_NAMES,
  evaluateDatabaseChecks,
  type DatabaseLookup,
  type DatabaseStepField,
  type DatabaseValues,
  type ProviderOutcome,
} from '@openverify/checks';
import { stepForVerificationType } from '@openverify/contracts';
import type { CheckId, VerificationTemplateConfig } from '@openverify/core';
import { getVerificationInputs } from '@openverify/db';
import type {
  DatabaseLookupRequest,
  DatabaseProvider,
  ProviderIdentity,
  SandboxDatabaseProvider,
} from '../../ports.js';
import { attemptProvider, type AttemptContext } from '../attempts.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import type { TypeEvaluationJob, VerificationTypeJob } from './index.js';

/** The `database` checks that read the provider's record. */
const PROVIDER_CHECKS: readonly CheckId[] = [
  'database_identity_comparison',
  'database_name_comparison',
  'database_address_comparison',
  'database_birthdate_comparison',
];

/** Whether the template enables any of `checks`. */
export const enablesAny = (
  config: VerificationTemplateConfig,
  checks: readonly CheckId[],
): boolean => checks.some((check) => config.checks[check]?.enabled === true);

/** The identity results are labelled with (C29.2 `provenance.provider`). */
const identityOf = (provider: ProviderIdentity) => ({ id: provider.id, sandbox: provider.sandbox });

/**
 * Asks a bound provider under the C30.3 rule: `not_configured` without one, `error` once it failed
 * for good; a failure a retry may cure is thrown while attempts remain.
 */
export async function askProvider<Provider extends ProviderIdentity, Result>(
  provider: Provider | undefined,
  call: (provider: Provider) => Promise<Result>,
  context: AttemptContext,
): Promise<ProviderOutcome<Result>> {
  if (provider === undefined) {
    return { kind: 'not_configured' };
  }
  const answered = await attemptProvider(() => call(provider), context);
  return answered.ok
    ? { kind: 'result', provider: identityOf(provider), result: answered.value }
    : { kind: 'error' };
}

/** The entered values the evaluators read: text members only, by their body names. */
function databaseValuesOf(values: Readonly<Record<string, unknown>> | null): DatabaseValues | null {
  if (values === null) {
    return null;
  }
  return Object.fromEntries(
    DATABASE_VALUE_NAMES.flatMap((name) => {
      const value = values[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

/** C59.1: the lookup request: the country and the collected fields' values, nothing more. */
function lookupRequest(
  values: DatabaseValues,
  collected: readonly DatabaseStepField[],
): DatabaseLookupRequest | null {
  const country = values['address-country-code'];
  if (country == null) {
    return null;
  }
  const fields: Record<string, string> = {};
  for (const field of collected) {
    const name = field.replaceAll('_', '-') as keyof DatabaseValues;
    const value = values[name];
    if (value != null) {
      fields[name] = value;
    }
  }
  return { country, fields };
}

/** Asks the bound `database` provider; the sandbox one also gets the reference id (C59.2). */
function lookUp(
  provider: DatabaseProvider | SandboxDatabaseProvider,
  request: DatabaseLookupRequest,
  referenceId: string | null,
): Promise<DatabaseLookup> {
  return provider.sandbox ? provider.lookup(request, { referenceId }) : provider.lookup(request);
}

async function evaluateDatabase(deps: ProcessVerificationDeps, job: TypeEvaluationJob) {
  const inputs = await getVerificationInputs(deps.db, job.environmentId, job.verificationId);
  const step = stepForVerificationType(job.flow, 'database');
  const collected: readonly DatabaseStepField[] = step?.type === 'database' ? step.fields : [];
  const entered = databaseValuesOf(inputs?.values ?? null);
  const request = entered === null ? null : lookupRequest(entered, collected);
  // Without a country no source can be asked: the input the lookup needs is missing.
  const values = request === null ? null : entered;
  const bound = deps.providers?.[job.environmentKind].database;
  const database =
    request !== null && enablesAny(job.config, PROVIDER_CHECKS)
      ? await askProvider(bound, (provider) => lookUp(provider, request, job.inquiry.referenceId), {
          lastAttempt: job.lastAttempt,
          logger: deps.logger,
          log: { verificationId: job.verificationId, check: 'database_identity_comparison' },
        })
      : undefined;
  // C149.4 (Workflow 9A Stage 1b (S)): a field's initial value when one exists (`api-flow-engine`),
  // and (Workflow 9B, api-flow-carry) where each came from, which the check records.
  const { fields, sources } = await comparisonSourceFor(deps.db, job.inquiry);
  return evaluateDatabaseChecks(
    {
      values,
      collectedFields: collected,
      providers: { database },
      inquiryFields: Object.keys(fields).length === 0 ? null : fields,
      inquiryFieldSources: sources,
      now: job.now,
    },
    job.config,
  );
}

export const databaseJob: VerificationTypeJob<null> = {
  type: 'database',
  runnable: true,
  async evaluate(deps, job) {
    return { results: await evaluateDatabase(deps, job), state: null };
  },
  persistInDecisionTx: (_tx, ctx) => ctx.verificationEvent(),
  onProcessingFailed: () => Promise.resolve([]),
};
