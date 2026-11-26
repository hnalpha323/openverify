/**
 * Workflow 5C review P008, P025 (C52.8): the golden Workflow 5A verifications
 * (`contracts/fixtures/api/verification-phone-number`, `-email-address`, `-database`, `-aamva`
 * and `-crypto-wallet`) carry what the API serves for a stated synthetic input, as the 5B ones do
 * (`phase5b-golden-fixtures.test.ts`): their checks are the evaluators' results on it, mapped as
 * the resources map a stored check (the template's requirement, the registry's category). The
 * dashboard, `@openverify/node` and Android decode these files, so a changed evaluator fails here
 * first. The inputs are the ones each job assembles from the fixture's own attributes: the OTP
 * counts and the sender, the pinned disposable list's identity, the sandbox database and AAMVA
 * answers, and a synthetic key's EIP-191 signature. Every value is invented.
 */
import { readFileSync } from 'node:fs';
import {
  evaluateAamvaChecks,
  evaluateCryptoWalletChecks,
  evaluateDatabaseChecks,
  evaluateEmailAddressChecks,
  evaluatePhoneNumberChecks,
  type DatabaseStepField,
  type DatabaseValues,
} from '@openverify/checks';
import {
  checkRequirementFor,
  OTP_MAX_WRONG_ENTRIES,
  verificationDocumentSchema,
} from '@openverify/contracts';
import {
  defaultTemplateConfig,
  emptyExtractedFields,
  getCheckDefinition,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { DISPOSABLE_LIST_PIN } from '../contact/disposable-list.js';
import { createSandboxDatabaseProvider } from '../providers/database/sandbox.js';
import { createSandboxAamvaProvider } from '../providers/sandbox.js';
import {
  signTestPersonalMessage,
  testWalletAddress,
} from '../services/crypto-challenges/testing.js';

const SANDBOX = { id: 'sandbox', sandbox: true } as const;
/** When the golden verifications were decided (their `updated-at`). */
const DECIDED_AT = new Date('2026-10-20T12:05:30.000Z');

function golden(name: string) {
  const parsed = verificationDocumentSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../../../contracts/fixtures/api/verification-${name}.json`, import.meta.url),
        'utf8',
      ),
    ),
  );
  return parsed.data.attributes as unknown as Record<string, unknown> & {
    checks: readonly { name: string }[];
  };
}

/** The results as the resource serves the stored checks (`toCheck` in the contracts). */
function served(results: readonly CheckResult[], config: VerificationTemplateConfig) {
  return results.map((result) => ({
    name: result.name,
    status: result.status,
    reasons: result.reasons,
    requirement: checkRequirementFor(config.checks[result.name]?.required === true),
    metadata: result.metadata,
    stage: result.stage,
    confidence: result.confidence,
    provenance: result.provenance,
    category: getCheckDefinition(result.name)?.category,
  }));
}

const text = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('expected a text attribute');
  }
  return value;
};
const count = (value: unknown): number => {
  if (typeof value !== 'number') {
    throw new Error('expected a count attribute');
  }
  return value;
};

describe('the golden phone number verification (C52.8, C56)', () => {
  it('serves the OTP comparison the evaluator writes for a code confirmed after one wrong try', () => {
    const attributes = golden('phone-number');
    const config = defaultTemplateConfig('phone_number');
    const results = evaluatePhoneNumberChecks(
      {
        phoneNumber: text(attributes['phone-number']),
        otp: {
          confirmed: true,
          sends: count(attributes.sends),
          wrongEntries: count(attributes['failed-attempts']),
          maxWrongEntries: OTP_MAX_WRONG_ENTRIES,
          limitedReason: null,
        },
        sender: SANDBOX,
      },
      config,
    );

    expect(attributes.checks).toEqual(served(results, config));
  });
});

describe('the golden email address verification (C52.8, C56)', () => {
  it('serves the OTP, disposable and MX checks the evaluators write for a reserved sandbox domain', () => {
    const attributes = golden('email-address');
    const config = defaultTemplateConfig('email_address');
    const results = evaluateEmailAddressChecks(
      {
        emailAddress: text(attributes['email-address']),
        otp: {
          confirmed: true,
          sends: count(attributes.sends),
          wrongEntries: count(attributes['failed-attempts']),
          maxWrongEntries: OTP_MAX_WRONG_ENTRIES,
          limitedReason: null,
        },
        // An email code's provider is `smtp` in every environment (api-otp).
        sender: { id: 'smtp', sandbox: false },
        // The pinned list (its identity is the result's model); its domains are not the address's.
        disposableList: {
          domains: new Set(['disposable.test']),
          source: { id: DISPOSABLE_LIST_PIN.id, sha256: DISPOSABLE_LIST_PIN.sha256 },
        },
        // `example.test` is reserved in a sandbox environment: no DNS lookup is made.
        environment: 'sandbox',
      },
      config,
    );

    expect(attributes.checks).toEqual(served(results, config));
  });
});

describe('the golden database verification (C52.8, C59)', () => {
  it('serves the checks the evaluators write on the sandbox record that echoes the entry', async () => {
    const attributes = golden('database');
    const config = defaultTemplateConfig('database');
    const collected: readonly DatabaseStepField[] = [
      'name_first',
      'name_last',
      'birthdate',
      'address_street_1',
      'address_city',
      'address_subdivision',
      'address_postal_code',
      'address_country_code',
    ];
    const values: DatabaseValues = Object.fromEntries(
      collected.map((field) => [
        field.replaceAll('_', '-'),
        text(attributes[field.replaceAll('_', '-')]),
      ]),
    );
    const fields = Object.fromEntries(
      collected.map((field) => [
        field.replaceAll('_', '-'),
        text(attributes[field.replaceAll('_', '-')]),
      ]),
    );
    const lookup = await createSandboxDatabaseProvider().lookup(
      { country: text(attributes['address-country-code']), fields },
      { referenceId: null },
    );
    const results = evaluateDatabaseChecks(
      {
        values,
        collectedFields: collected,
        providers: { database: { kind: 'result', provider: SANDBOX, result: lookup } },
        // The inquiry holds no fields.
        inquiryFields: null,
        now: DECIDED_AT,
      },
      config,
    );

    expect(attributes.checks).toEqual(served(results, config));
  });
});

describe('the golden AAMVA verification (C52.8, C59.4, C59.6)', () => {
  it('serves the checks the evaluators write for a jurisdiction the sandbox says does not take part', async () => {
    const attributes = golden('aamva');
    const config = defaultTemplateConfig('aamva');
    const values = {
      'name-first': text(attributes['name-first']),
      'name-last': text(attributes['name-last']),
      birthdate: text(attributes.birthdate),
      'identification-number': text(attributes['identification-number']),
      'issuing-authority': text(attributes['issuing-authority']),
      'issue-date': text(attributes['issue-date']),
      'expiration-date': text(attributes['expiration-date']),
      'address-postal-code': text(attributes['address-postal-code']),
    };
    const lookup = await createSandboxAamvaProvider().lookup({
      jurisdiction: values['issuing-authority'],
      fields: {
        ...emptyExtractedFields(),
        'name-first': values['name-first'],
        'name-last': values['name-last'],
        birthdate: values.birthdate,
        'identification-number': values['identification-number'],
        'issue-date': values['issue-date'],
        'expiration-date': values['expiration-date'],
        'address-postal-code': values['address-postal-code'],
      },
    });
    const results = evaluateAamvaChecks(
      {
        values,
        source: 'government_id',
        providers: { aamva: { kind: 'result', provider: SANDBOX, result: lookup } },
      },
      config,
    );

    expect(attributes.status).toBe('skipped');
    expect(attributes.checks).toEqual(served(results, config));
  });
});

describe('the golden crypto wallet verification (C52.8, C57)', () => {
  it('serves the checks the evaluators write for a valid EIP-191 signature over the challenge', () => {
    const attributes = golden('crypto-wallet');
    const config = defaultTemplateConfig('crypto_wallet');
    const chainId = text(attributes['chain-id']);
    const message = 'Synthetic challenge: prove you control this wallet.';
    // The validity check reads the fixture's own address (EIP-55's all-caps example, which no
    // known key controls); the other checks never name the address, so a synthetic key's valid
    // signature over the challenge gives them as served.
    const [validity] = evaluateCryptoWalletChecks(
      {
        chainId,
        walletAddress: text(attributes['wallet-address']),
        challenge: null,
        submission: null,
      },
      config,
    );
    const label = 'golden/crypto-wallet';
    const signed = evaluateCryptoWalletChecks(
      {
        chainId,
        walletAddress: testWalletAddress(label).toUpperCase().replace(/^0X/u, '0x'),
        challenge: { message },
        submission: { signature: signTestPersonalMessage(message, label), scheme: 'eip191' },
      },
      config,
    );

    expect(attributes.checks).toEqual(
      served([...(validity === undefined ? [] : [validity]), ...signed.slice(1)], config),
    );
  });
});
