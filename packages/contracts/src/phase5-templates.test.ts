/**
 * C50.4 and C51.1: templates take every verification step, one config key per API type with the
 * options its type takes, the default checks of each type, and the publish-time rules that need
 * no server state (the rest are the API's async publish hooks, C54.1).
 */
import { defaultTemplateConfig, type VerificationTemplateConfig } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AAMVA_CHECKS,
  DEFAULT_BUSINESS_WEBSITE_CHECKS,
  DEFAULT_CRYPTO_WALLET_CHECKS,
  DEFAULT_DATABASE_BUSINESS_CHECKS,
  DEFAULT_DATABASE_CHECKS,
  DEFAULT_DOCUMENT_CHECKS,
  DEFAULT_EMAIL_ADDRESS_CHECKS,
  DEFAULT_GOVERNMENT_ID_NFC_CHECKS,
  DEFAULT_PHONE_NUMBER_CHECKS,
  DEFAULT_SELFIE_CHECKS,
  createInquiryTemplateAttributesSchema,
  defaultInquiryTemplateAttributes,
  templatePublishProblems,
  verificationConfigSchema,
  type DefaultChecks,
} from './inquiry-templates.js';
import { issuesOf } from './test-support.js';
import { toApiVerificationType, type SupportedVerificationType } from './verification-types.js';

/** The template config of a default-checks table. */
function configOf(defaults: DefaultChecks): VerificationTemplateConfig {
  const entries = (ids: readonly string[], enabled: boolean, required: boolean) =>
    ids.map((id): [string, { enabled: boolean; required: boolean }] => [id, { enabled, required }]);
  return {
    checks: Object.fromEntries([
      ...entries(defaults.required, true, true),
      ...entries(defaults.advisory, true, false),
      ...entries(defaults.disabled, false, false),
    ]),
  };
}

const DEFAULTS: readonly (readonly [SupportedVerificationType, DefaultChecks])[] = [
  ['selfie', DEFAULT_SELFIE_CHECKS],
  ['document', DEFAULT_DOCUMENT_CHECKS],
  ['database', DEFAULT_DATABASE_CHECKS],
  ['aamva', DEFAULT_AAMVA_CHECKS],
  ['phone_number', DEFAULT_PHONE_NUMBER_CHECKS],
  ['email_address', DEFAULT_EMAIL_ADDRESS_CHECKS],
  ['government_id_nfc', DEFAULT_GOVERNMENT_ID_NFC_CHECKS],
  ['crypto_wallet', DEFAULT_CRYPTO_WALLET_CHECKS],
  ['database_business', DEFAULT_DATABASE_BUSINESS_CHECKS],
  ['business_website', DEFAULT_BUSINESS_WEBSITE_CHECKS],
];

describe('the default checks of each type (C51.1)', () => {
  it.each(DEFAULTS)('are the registry defaults of %s', (type, defaults) => {
    expect(configOf(defaults).checks).toEqual(defaultTemplateConfig(type).checks);
    expect(defaults.required.length, type).toBeGreaterThan(0);
  });

  it('require what the C51.1 table requires', () => {
    expect(DEFAULT_DOCUMENT_CHECKS.required).toEqual([
      'document_type_detection',
      'document_extracted_properties_detection',
      'document_expired_detection',
      'document_recency_detection',
      'document_name_comparison',
    ]);
    expect(DEFAULT_DATABASE_CHECKS.required).toEqual(['database_identity_comparison']);
    expect(DEFAULT_AAMVA_CHECKS.required).toEqual(['aamva_identity_comparison']);
    expect(DEFAULT_PHONE_NUMBER_CHECKS.required).toEqual(['phone_number_otp_comparison']);
    expect(DEFAULT_EMAIL_ADDRESS_CHECKS.required).toEqual(['email_address_otp_comparison']);
    expect(DEFAULT_GOVERNMENT_ID_NFC_CHECKS).toEqual({
      required: [
        'id_nfc_expired_detection',
        'id_nfc_passive_authentication_detection',
        'id_nfc_chip_authentication_detection',
        'id_nfc_mrz_comparison',
        'id_nfc_selfie_comparison',
      ],
      advisory: ['id_nfc_repeat_detection'],
      disabled: [],
    });
    expect(DEFAULT_CRYPTO_WALLET_CHECKS.advisory).toEqual([]);
    expect(DEFAULT_DATABASE_BUSINESS_CHECKS.advisory).toEqual([
      'database_business_associated_persons_comparison',
    ]);
    expect(DEFAULT_BUSINESS_WEBSITE_CHECKS).toEqual({
      required: ['business_website_resolution_detection'],
      advisory: ['business_website_domain_age_detection'],
      disabled: [
        'business_website_malicious_website_detection',
        'business_website_backlink_detection',
      ],
    });
  });
});

/** A flow with every verification step in a valid order, and a default config for each type. */
function everyStep() {
  const base = defaultInquiryTemplateAttributes();
  const [consent, governmentId, selfie, completion, failure] = base.flow.steps;
  const flow = {
    ...base.flow,
    steps: [
      consent,
      governmentId,
      selfie,
      {
        id: 'proof',
        type: 'document',
        documentTypes: ['utility_bill'],
        captureMethods: ['upload'],
      },
      { id: 'phone', type: 'phone_otp', allowedCountries: ['US'] },
      { id: 'email', type: 'email_otp' },
      {
        id: 'records',
        type: 'database',
        fields: [
          'name_first',
          'name_last',
          'birthdate',
          'address_street_1',
          'address_country_code',
        ],
      },
      { id: 'licence', type: 'aamva', source: 'government_id' },
      { id: 'chip', type: 'nfc', androidOnly: true },
      { id: 'wallet', type: 'crypto_wallet', chains: ['eip155:1'], signing: ['paste'] },
      { id: 'business', type: 'database_business' },
      { id: 'website', type: 'business_website' },
      completion,
      failure,
    ],
  };
  const config: Record<string, unknown> = { ...base['verification-config'] };
  for (const [type, defaults] of DEFAULTS.filter(([type]) => type !== 'selfie')) {
    config[toApiVerificationType(type)] = configOf(defaults);
  }
  return { name: 'Every step', flow, 'verification-config': config };
}

describe('templates with Phase 5 steps (C50.4)', () => {
  it('take every verification step with a config for each type', () => {
    const parsed = createInquiryTemplateAttributesSchema.parse(everyStep());
    expect(parsed.flow.steps).toHaveLength(14);
    expect(templatePublishProblems(parsed.flow, parsed['verification-config'])).toEqual([]);
  });

  it('need a config for each step and a step for each config', () => {
    const value = everyStep();
    delete value['verification-config']['crypto-wallet'];
    value.flow.steps = value.flow.steps.filter((step) => step?.id !== 'website');
    expect(issuesOf(createInquiryTemplateAttributesSchema.safeParse(value))).toEqual([
      'verification-config: missing configuration for "crypto-wallet" (step "wallet")',
      'verification-config.business-website: no step in the flow creates this verification',
    ]);
  });
});

describe('type-level options (C50.4)', () => {
  const options = {
    'allowed-countries': ['US'],
    'allowed-id-classes': ['passport'],
    'allowed-chains': ['eip155:1'],
    'accept-review-without-provider': true,
  } as const;
  const takes: Readonly<Record<string, readonly (keyof typeof options)[]>> = {
    'government-id': ['allowed-countries', 'allowed-id-classes'],
    selfie: [],
    document: [],
    database: ['accept-review-without-provider'],
    aamva: ['accept-review-without-provider'],
    'phone-number': [],
    'email-address': [],
    'government-id-nfc': ['accept-review-without-provider'],
    'crypto-wallet': ['allowed-chains'],
    'database-business': ['allowed-countries'],
    'business-website': [],
  };
  const MESSAGES = {
    'allowed-countries':
      'only government-id and database-business verifications restrict countries',
    'allowed-id-classes': 'only government-id verifications restrict ID classes',
    'allowed-chains': 'only crypto-wallet verifications restrict chains',
    'accept-review-without-provider':
      'only database, aamva and government-id-nfc verifications accept review without a provider',
  } as const;

  it.each(Object.entries(takes))(
    'are taken by %s as listed, and refused otherwise',
    (apiType, allowed) => {
      const checks = (everyStep()['verification-config'][apiType] as VerificationTemplateConfig)
        .checks;
      for (const [option, value] of Object.entries(options)) {
        const result = verificationConfigSchema.safeParse({
          [apiType]: { checks, [option]: value },
        });
        if (allowed.includes(option as keyof typeof options)) {
          expect(result.success, `${apiType} ${option}`).toBe(true);
        } else {
          expect(issuesOf(result), `${apiType} ${option}`).toEqual([
            `${apiType}.${option}: ${MESSAGES[option as keyof typeof MESSAGES]}`,
          ]);
        }
      }
    },
  );
});

describe('templatePublishProblems (C50.4, V18): rules on create and publish only', () => {
  const problemsOf = (mutate: (value: ReturnType<typeof everyStep>) => void) => {
    const value = everyStep();
    mutate(value);
    const parsed = createInquiryTemplateAttributesSchema.parse(value);
    return templatePublishProblems(parsed.flow, parsed['verification-config']);
  };
  const stepIndex = (value: ReturnType<typeof everyStep>, id: string) =>
    value.flow.steps.findIndex((step) => step?.id === id);

  it('need an earlier government ID step for an AAMVA step that reads it', () => {
    expect(
      problemsOf((value) => {
        const [licence] = value.flow.steps.splice(stepIndex(value, 'licence'), 1);
        value.flow.steps.splice(1, 0, licence);
      }),
    ).toEqual([
      {
        pointer: '/flow/steps/1/source',
        detail: 'an aamva step with source government_id needs an earlier government_id step',
      },
    ]);
    // The form source needs none.
    expect(
      problemsOf((value) => {
        const index = stepIndex(value, 'licence');
        value.flow.steps[index] = { id: 'licence', type: 'aamva', source: 'form' };
        const [licence] = value.flow.steps.splice(index, 1);
        value.flow.steps.splice(1, 0, licence);
      }),
    ).toEqual([]);
  });

  it('need an earlier selfie step for an NFC step, and an earlier government ID step when the flow has one', () => {
    expect(
      problemsOf((value) => {
        const [chip] = value.flow.steps.splice(stepIndex(value, 'chip'), 1);
        value.flow.steps.splice(2, 0, chip);
      }),
    ).toEqual([{ pointer: '/flow/steps/2', detail: 'an nfc step needs an earlier selfie step' }]);
    expect(
      problemsOf((value) => {
        const [chip] = value.flow.steps.splice(stepIndex(value, 'chip'), 1);
        value.flow.steps.splice(1, 0, chip);
      }),
    ).toEqual([
      { pointer: '/flow/steps/1', detail: 'an nfc step needs an earlier selfie step' },
      { pointer: '/flow/steps/1', detail: 'an nfc step needs an earlier government_id step' },
    ]);
  });

  it('keep the offered chains within the allowed chains', () => {
    expect(
      problemsOf((value) => {
        const wallet = value['verification-config']['crypto-wallet'] as VerificationTemplateConfig;
        wallet['allowed-chains'] = ['bip122:000000000019d6689c085ae165831e93'];
      }),
    ).toEqual([
      {
        pointer: `/flow/steps/${String(9)}/chains/0`,
        detail: 'chain eip155:1 is not in the crypto-wallet allowed-chains',
      },
    ]);
  });

  it('refuse xrpl:0 while the address check is required, since nothing proves its ownership', () => {
    const withXrpl = (value: ReturnType<typeof everyStep>) => {
      value.flow.steps[stepIndex(value, 'wallet')] = {
        id: 'wallet',
        type: 'crypto_wallet',
        chains: ['eip155:1', 'xrpl:0'],
        signing: ['paste'],
      };
    };
    expect(problemsOf(withXrpl)).toEqual([
      {
        pointer: '/flow/steps/9/chains/1',
        detail:
          'xrpl:0 has no ownership proof, so it cannot be offered while crypto_wallet_address_comparison is required',
      },
    ]);
    expect(
      problemsOf((value) => {
        withXrpl(value);
        const wallet = value['verification-config']['crypto-wallet'] as VerificationTemplateConfig;
        wallet.checks.crypto_wallet_address_comparison = { enabled: true, required: false };
      }),
    ).toEqual([]);
  });

  it('keep the database match groups to the fields the step collects, the default groups too', () => {
    // The default groups name the birthdate and the address.
    expect(
      problemsOf((value) => {
        value.flow.steps[stepIndex(value, 'records')] = {
          id: 'records',
          type: 'database',
          fields: ['name_first', 'name_last', 'phone_number', 'address_country_code'],
        };
      }),
    ).toEqual([
      {
        pointer:
          '/verification-config/database/checks/database_identity_comparison/config/match-groups/0',
        detail: 'match group 1 names birthdate, address, which the database step does not collect',
      },
    ]);
    expect(
      problemsOf((value) => {
        value.flow.steps[stepIndex(value, 'records')] = {
          id: 'records',
          type: 'database',
          fields: ['name_first', 'name_last', 'phone_number', 'address_country_code'],
        };
        const database = value['verification-config'].database as VerificationTemplateConfig;
        database.checks.database_identity_comparison = {
          enabled: true,
          required: true,
          config: { 'match-groups': [{ name: 'partial', 'phone-number': 'full' }] },
        };
      }),
    ).toEqual([]);
  });

  it('find nothing in the default template', () => {
    const { flow, 'verification-config': config } = defaultInquiryTemplateAttributes();
    expect(templatePublishProblems(flow, config)).toEqual([]);
  });
});
