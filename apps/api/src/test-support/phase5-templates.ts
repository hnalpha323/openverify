/**
 * Phase 5 template attributes for the tests (C50.3, C50.4): one with every new step that meets
 * the publish rules, and one that breaks the step-order rules. Only tests import this file.
 */
import {
  defaultInquiryTemplateAttributes,
  type CreateInquiryTemplateAttributes,
} from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import type { FlowStep } from '@openverify/flow-spec';

/** The Phase 5 steps, in an order the C50.4 rules accept after the ID and selfie steps. */
export const PHASE5_STEPS: readonly FlowStep[] = [
  { id: 'nfc', type: 'nfc', androidOnly: true },
  { id: 'aamva', type: 'aamva', source: 'government_id' },
  { id: 'document', type: 'document', documentTypes: ['utility_bill'], captureMethods: ['upload'] },
  { id: 'phone', type: 'phone_otp', allowedCountries: ['US'] },
  { id: 'email', type: 'email_otp' },
  {
    id: 'database',
    type: 'database',
    fields: ['name_first', 'name_last', 'birthdate', 'address_street_1', 'address_country_code'],
  },
  { id: 'wallet', type: 'crypto_wallet', chains: ['eip155:1'], signing: ['wallet'] },
  { id: 'business', type: 'database_business' },
  { id: 'website', type: 'business_website' },
];

/** The registry defaults of each Phase 5 API type (C51.1). */
function phase5Config(): CreateInquiryTemplateAttributes['verification-config'] {
  return {
    document: defaultTemplateConfig('document'),
    database: defaultTemplateConfig('database'),
    aamva: defaultTemplateConfig('aamva'),
    'phone-number': defaultTemplateConfig('phone_number'),
    'email-address': defaultTemplateConfig('email_address'),
    'government-id-nfc': defaultTemplateConfig('government_id_nfc'),
    'crypto-wallet': defaultTemplateConfig('crypto_wallet'),
    'database-business': defaultTemplateConfig('database_business'),
    'business-website': defaultTemplateConfig('business_website'),
  };
}

/** The default template with `steps` placed before completion, and every Phase 5 type's config. */
function withSteps(place: (steps: FlowStep[]) => FlowStep[]): CreateInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  attributes.name = 'Every Phase 5 step';
  attributes.flow.steps = place(attributes.flow.steps);
  attributes['verification-config'] = {
    ...attributes['verification-config'],
    ...phase5Config(),
  };
  return attributes;
}

/** Consent, the ID, the selfie, then every Phase 5 step: meets every C50.4 rule. */
export function phase5TemplateAttributes(): CreateInquiryTemplateAttributes {
  return withSteps((steps) => {
    const completion = steps.findIndex((step) => step.type === 'completion');
    return [...steps.slice(0, completion), ...PHASE5_STEPS, ...steps.slice(completion)];
  });
}

/**
 * The silent AAMVA step and the NFC step before the ID and selfie steps: three C50.4 problems,
 * at `/flow/steps/1/source` (AAMVA from an ID not yet captured) and twice at `/flow/steps/2`
 * (NFC before the selfie, and before the ID).
 */
export function stepOrderBreakingAttributes(): CreateInquiryTemplateAttributes {
  return withSteps((steps) => {
    const [consent, ...rest] = steps;
    const early = PHASE5_STEPS.filter((step) => step.type === 'aamva' || step.type === 'nfc');
    const late = PHASE5_STEPS.filter((step) => step.type !== 'aamva' && step.type !== 'nfc');
    const completion = rest.findIndex((step) => step.type === 'completion');
    return [
      ...(consent === undefined ? [] : [consent]),
      ...[...early].reverse(),
      ...rest.slice(0, completion),
      ...late,
      ...rest.slice(completion),
    ];
  });
}
