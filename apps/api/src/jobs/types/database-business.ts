/**
 * C54.1, C61.1, C61.7: the `database_business` job. It reads the business the user entered
 * (`verification_inputs`), asks the environment's bound registers about it in the C61.1 order of
 * asking (the national registers, which answer `unsupported_country` outside their country, then
 * GLEIF), stopping at the first that holds a record, and runs the C61.7 evaluators of
 * `@openverify/checks` on the answers. A real register receives the business alone (country,
 * name, registration number, LEI, address: never the reference id or a person); no register is
 * asked when no enabled check reads one, or without entered values. An unbound register is
 * `provider_not_configured`; a failing one is retried, then `execution_error` on the last attempt
 * (C30.3). Officers and PSCs stay in memory; the decision seals the record's non-personal summary
 * to the verification (`business_registry_records`, C53.3) before the verification's event is
 * staged, so the event carries the registry attributes. Nothing is logged but ids.
 */
import {
  evaluateDatabaseBusinessChecks,
  type BusinessRegistryAnswer,
  type DatabaseBusinessValues,
} from '@openverify/checks';
import { stepForVerificationType } from '@openverify/contracts';
import type { CheckId } from '@openverify/core';
import {
  getVerificationInputs,
  putBusinessRegistryRecord,
  type BusinessRegistryRecordSummary,
} from '@openverify/db';
import type {
  BusinessRecord,
  BusinessRegistryProvider,
  BusinessRegistryRequest,
  SandboxBusinessRegistryProvider,
} from '../../ports.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import { askProvider, enablesAny } from './database.js';
import type { TypeEvaluationJob, VerificationTypeJob } from './index.js';

/** The `database_business` checks that read a register's answer. */
const REGISTRY_CHECKS: readonly CheckId[] = [
  'database_business_identity_comparison',
  'database_business_active_business_detection',
  'database_business_associated_persons_comparison',
  'database_business_service_available_detection',
];

/** What the decision writes: the record the verification was judged against, if one was found. */
export interface DatabaseBusinessState {
  found: { record: BusinessRecord; fetchedAt: Date } | null;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** The entered values the evaluators read, by their body names. */
function businessValuesOf(
  values: Readonly<Record<string, unknown>> | null,
): DatabaseBusinessValues | null {
  if (values === null) {
    return null;
  }
  const persons = values['associated-persons'];
  return {
    'business-name': text(values['business-name']),
    'country-code': text(values['country-code']),
    'registration-number': text(values['registration-number']),
    lei: text(values.lei),
    'address-street-1': text(values['address-street-1']),
    'address-street-2': text(values['address-street-2']),
    'address-city': text(values['address-city']),
    'address-subdivision': text(values['address-subdivision']),
    'address-postal-code': text(values['address-postal-code']),
    'associated-persons': Array.isArray(persons)
      ? persons.flatMap((person: unknown) =>
          typeof person === 'object' && person !== null
            ? [
                {
                  'name-first': text((person as Record<string, unknown>)['name-first']),
                  'name-last': text((person as Record<string, unknown>)['name-last']),
                  birthdate: text((person as Record<string, unknown>).birthdate),
                },
              ]
            : [],
        )
      : undefined,
  };
}

/**
 * C61.1: what a register is asked: the business, never a person or the reference id. With
 * `withPersons` (the step collects associated persons and their check runs, Workflow 5C review
 * K6) the register also reads its officers and persons with significant control.
 */
function registryRequest(
  values: DatabaseBusinessValues,
  withPersons: boolean,
): BusinessRegistryRequest | null {
  const country = values['country-code'];
  const businessName = values['business-name'];
  if (country == null || businessName == null) {
    return null;
  }
  const address = {
    ...(values['address-street-1'] == null ? {} : { street1: values['address-street-1'] }),
    ...(values['address-city'] == null ? {} : { city: values['address-city'] }),
    ...(values['address-subdivision'] == null
      ? {}
      : { subdivision: values['address-subdivision'] }),
    ...(values['address-postal-code'] == null ? {} : { postalCode: values['address-postal-code'] }),
  };
  return {
    country,
    businessName,
    ...(values['registration-number'] == null
      ? {}
      : { registrationNumber: values['registration-number'] }),
    ...(values.lei == null ? {} : { lei: values.lei }),
    ...(Object.keys(address).length === 0 ? {} : { address }),
    ...(withPersons ? { withPersons: true } : {}),
  };
}

/** C61.1: the bound registers in the order of asking: the national ones, then GLEIF. */
function inOrderOfAsking(
  bound: readonly BusinessRegistryProvider[] | SandboxBusinessRegistryProvider,
): readonly (BusinessRegistryProvider | SandboxBusinessRegistryProvider)[] {
  if (!Array.isArray(bound)) {
    return [bound as SandboxBusinessRegistryProvider];
  }
  const registers = bound as readonly BusinessRegistryProvider[];
  return [
    ...registers.filter((register) => register.source !== 'gleif'),
    ...registers.filter((register) => register.source === 'gleif'),
  ];
}

const sourceOf = (register: BusinessRegistryProvider | SandboxBusinessRegistryProvider) =>
  register.sandbox ? 'sandbox' : register.source;

/** Asks each register in turn until one holds a record (C61.1). */
async function askRegisters(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
  request: BusinessRegistryRequest,
): Promise<{ answers: BusinessRegistryAnswer[]; found: BusinessRecord | null }> {
  const bound = deps.providers?.[job.environmentKind].businessRegistry;
  if (bound === undefined) {
    return { answers: [], found: null };
  }
  const answers: BusinessRegistryAnswer[] = [];
  for (const register of inOrderOfAsking(bound)) {
    const outcome = await askProvider(register, (provider) => provider.lookup(request), {
      lastAttempt: job.lastAttempt,
      logger: deps.logger,
      log: { verificationId: job.verificationId, check: 'database_business_identity_comparison' },
    });
    answers.push({ source: sourceOf(register), outcome });
    if (outcome.kind === 'result' && outcome.result.outcome === 'found') {
      return { answers, found: outcome.result.record };
    }
  }
  return { answers, found: null };
}

/** C53.3: the record's non-personal summary as sealed: never its persons. */
function summaryOf(record: BusinessRecord): BusinessRegistryRecordSummary {
  const address = record.registeredAddress;
  const parts =
    address == null
      ? []
      : [...address.lines, address.city, address.region, address.postalCode, address.country];
  const line = parts.filter((part): part is string => typeof part === 'string' && part !== '');
  return {
    recordId: record.recordId,
    legalName: record.legalName,
    status: record.status,
    jurisdiction: record.jurisdiction ?? null,
    registeredAddress: line.length === 0 ? null : line.join(', '),
  };
}

export const databaseBusinessJob: VerificationTypeJob<DatabaseBusinessState> = {
  type: 'database_business',
  runnable: true,
  async evaluate(deps, job) {
    const inputs = await getVerificationInputs(deps.db, job.environmentId, job.verificationId);
    const values = businessValuesOf(inputs?.values ?? null);
    const step = stepForVerificationType(job.flow, 'database_business');
    const collectAssociatedPersons =
      step?.type === 'database_business' && step.collectAssociatedPersons === true;
    const withPersons =
      collectAssociatedPersons &&
      job.config.checks.database_business_associated_persons_comparison?.enabled === true;
    const request = values === null ? null : registryRequest(values, withPersons);
    const asked =
      request !== null && enablesAny(job.config, REGISTRY_CHECKS)
        ? await askRegisters(deps, job, request)
        : { answers: [], found: null };
    return {
      results: evaluateDatabaseBusinessChecks(
        { values, collectAssociatedPersons, registry: asked.answers },
        job.config,
      ),
      state: { found: asked.found === null ? null : { record: asked.found, fetchedAt: job.now } },
    };
  },
  async persistInDecisionTx(tx, ctx) {
    const { found } = ctx.state;
    if (found !== null) {
      await putBusinessRegistryRecord(tx, ctx.environmentId, {
        verificationId: ctx.verificationId,
        inquiryId: ctx.inquiry.id,
        source: found.record.source,
        record: summaryOf(found.record),
        fetchedAt: found.fetchedAt,
      });
    }
    return ctx.verificationEvent();
  },
  onProcessingFailed: () => Promise.resolve([]),
};
