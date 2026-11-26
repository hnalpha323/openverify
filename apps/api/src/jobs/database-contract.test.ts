/**
 * The database and AAMVA contract (C51.2): the reasons each evaluator of `@openverify/checks` may
 * emit are exactly the ones `@openverify/contracts` lists for its check (the checks package cannot
 * import contracts, so the two meet here), and every result the evaluators give on the sandbox
 * providers' answers, each magic value and each provider state, carries only listed reasons, a
 * valid C29 shape and no entered value. Every value is synthetic.
 */
import {
  DATABASE_EVALUATOR_REASONS,
  evaluateAamvaChecks,
  evaluateDatabaseChecks,
  type AamvaValues,
  type DatabaseStepField,
  type ProviderOutcome,
} from '@openverify/checks';
import { DATABASE_CHECK_IDS, DATABASE_CHECK_REASONS } from '@openverify/contracts';
import {
  checkResultSchema,
  defaultTemplateConfig,
  emptyExtractedFields,
  type CheckResult,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import type { DatabaseLookupResult } from '../ports.js';
import {
  SANDBOX_DATABASE_MAGIC,
  createSandboxDatabaseProvider,
} from '../providers/database/sandbox.js';
import { SANDBOX_MAGIC, createSandboxAamvaProvider } from '../providers/sandbox.js';

const SANDBOX = { id: 'sandbox', sandbox: true } as const;
const NOW = new Date('2026-10-23T12:00:00.000Z');

const DATABASE_VALUES = {
  'name-first': 'Bob',
  'name-last': 'Testerton',
  birthdate: '1990-05-17',
  'address-street-1': '123 Main Street',
  'address-city': 'Springfield',
  'address-postal-code': '62704',
  'address-country-code': 'US',
};
const COLLECTED: DatabaseStepField[] = [
  'name_first',
  'name_last',
  'birthdate',
  'address_street_1',
  'address_city',
  'address_postal_code',
  'address_country_code',
];
const AAMVA_VALUES: AamvaValues = {
  'name-first': 'Avery',
  'name-last': 'Example',
  birthdate: '1990-04-12',
  'identification-number': 'D1234567',
  'issuing-authority': 'CA',
};

/** Every database result the sandbox, an unbound and a failed provider reach. */
async function databaseResults(): Promise<CheckResult[]> {
  const provider = createSandboxDatabaseProvider();
  const answers: (ProviderOutcome<DatabaseLookupResult> | undefined)[] = [
    undefined,
    { kind: 'not_configured' },
    { kind: 'error' },
  ];
  for (const reference of [
    null,
    ...SANDBOX_DATABASE_MAGIC.map((token) => `sandbox-database-${token}`),
  ]) {
    answers.push({
      kind: 'result',
      provider: SANDBOX,
      result: await provider.lookup(
        { country: 'US', fields: DATABASE_VALUES },
        { referenceId: reference },
      ),
    });
  }
  answers.push({ kind: 'result', provider: SANDBOX, result: { outcome: 'unsupported_country' } });
  answers.push({
    kind: 'result',
    provider: SANDBOX,
    result: { outcome: 'not_found', authoritative: true },
  });
  const config = defaultTemplateConfig('database');
  const results: CheckResult[] = [];
  for (const database of answers) {
    for (const inquiryFields of [null, { name_first: 'Bob', name_last: 'Quillfeather' }]) {
      results.push(
        ...evaluateDatabaseChecks(
          {
            values: DATABASE_VALUES,
            collectedFields: COLLECTED,
            providers: { database },
            inquiryFields,
            now: NOW,
          },
          config,
        ),
      );
    }
  }
  results.push(
    ...evaluateDatabaseChecks({ values: null, collectedFields: COLLECTED, now: NOW }, config),
    ...evaluateDatabaseChecks(
      {
        values: { ...DATABASE_VALUES, 'address-street-1': 'PO Box 12' },
        collectedFields: COLLECTED,
        providers: { database: { kind: 'not_configured' } },
        now: NOW,
      },
      config,
    ),
  );
  return results;
}

/** Every AAMVA result the sandbox endings and the provider states reach. */
async function aamvaResults(): Promise<CheckResult[]> {
  const provider = createSandboxAamvaProvider();
  const config = defaultTemplateConfig('aamva');
  const results: CheckResult[] = [];
  for (const ending of [...Object.values(SANDBOX_MAGIC.aamva), '4567']) {
    const values = { ...AAMVA_VALUES, 'identification-number': `D123${ending}` };
    const result = await provider.lookup({
      jurisdiction: 'CA',
      fields: {
        ...emptyExtractedFields(),
        'identification-number': values['identification-number'],
      },
    });
    for (const source of ['form', 'government_id'] as const) {
      results.push(
        ...evaluateAamvaChecks(
          { values, source, providers: { aamva: { kind: 'result', provider: SANDBOX, result } } },
          config,
        ),
      );
    }
  }
  for (const aamva of [
    undefined,
    { kind: 'not_configured' as const },
    { kind: 'error' as const },
  ]) {
    results.push(
      ...evaluateAamvaChecks(
        { values: AAMVA_VALUES, source: 'form', providers: { aamva } },
        config,
      ),
    );
  }
  results.push(...evaluateAamvaChecks({ values: null, source: 'government_id' }, config));
  return results;
}

describe('the database and AAMVA contract (C51.2)', () => {
  it('lets each evaluator emit exactly the reasons the contracts list for its check', () => {
    expect(Object.keys(DATABASE_EVALUATOR_REASONS).sort()).toEqual([...DATABASE_CHECK_IDS].sort());
    for (const id of DATABASE_CHECK_IDS) {
      expect([...(DATABASE_EVALUATOR_REASONS[id] ?? [])].sort(), id).toEqual(
        [...DATABASE_CHECK_REASONS[id]].sort(),
      );
    }
  });

  it('gives only listed reasons, a valid result and no entered value, on every sandbox answer', async () => {
    const results = [...(await databaseResults()), ...(await aamvaResults())];
    const reached = new Set<string>();

    for (const result of results) {
      expect(checkResultSchema.safeParse(result).success, result.name).toBe(true);
      const listed: readonly string[] =
        DATABASE_CHECK_REASONS[result.name as (typeof DATABASE_CHECK_IDS)[number]];
      for (const reason of result.reasons) {
        expect(listed, `${result.name}: ${reason}`).toContain(reason);
        reached.add(`${result.name}:${reason}`);
      }
      const serialized = JSON.stringify(result);
      for (const value of [...Object.values(DATABASE_VALUES), ...Object.values(AAMVA_VALUES)]) {
        if (typeof value === 'string' && value.length > 2) {
          expect(serialized, result.name).not.toContain(value);
        }
      }
    }
    expect(reached.size).toBeGreaterThanOrEqual(30);
  });
});
