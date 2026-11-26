/**
 * C52.3: a business registry body. Its schema checks the registration number against the
 * registry of the country and the LEI's check digits; the step and the template add two rules:
 * associated persons only when the step collects them, and every input that each configured
 * `database_business_identity_comparison` match group names (`required-inputs`, also the guidance
 * of the type, C52.2).
 */
import { phase5ConfigDefaults, type VerificationTemplateConfig } from '@openverify/core';
import { inputError, isEntered, type InputRule } from './rules.js';

/** The body member of each business match field (C51.3 `BUSINESS_MATCH_FIELDS`). */
const BUSINESS_INPUT_OF = Object.freeze({
  name: 'business-name',
  'registration-number': 'registration-number',
  address: 'address-street-1',
});
type BusinessMatchField = keyof typeof BUSINESS_INPUT_OF;
const BUSINESS_MATCH_FIELD_ORDER = Object.keys(BUSINESS_INPUT_OF) as BusinessMatchField[];

const IDENTITY_CHECK = 'database_business_identity_comparison';

/** The configured match groups of the identity check, or its default ones. */
function matchGroupsOf(config: VerificationTemplateConfig | undefined): readonly object[] {
  const configured = config?.checks[IDENTITY_CHECK]?.config?.['match-groups'];
  const groups = Array.isArray(configured)
    ? configured
    : phase5ConfigDefaults(IDENTITY_CHECK)['match-groups'];
  return Array.isArray(groups)
    ? groups.filter((group): group is object => typeof group === 'object' && group !== null)
    : [];
}

/**
 * The business inputs a body must carry because every match group of the identity check names
 * them, in body order; none when the check is not enabled. Without a configuration, the default
 * groups decide.
 */
export function businessRequiredInputs(config: VerificationTemplateConfig | undefined): string[] {
  if (config !== undefined && config.checks[IDENTITY_CHECK]?.enabled !== true) {
    return [];
  }
  const groups = matchGroupsOf(config);
  if (groups.length === 0) {
    return [];
  }
  return BUSINESS_MATCH_FIELD_ORDER.filter((field) => groups.every((group) => field in group)).map(
    (field) => BUSINESS_INPUT_OF[field],
  );
}

export const databaseBusinessInputRule: InputRule = {
  refusals({ step, config, values }) {
    const refused =
      step.type === 'database_business' &&
      step.collectAssociatedPersons !== true &&
      values['associated-persons'] !== undefined
        ? [inputError('associated-persons', 'is not collected by this step')]
        : [];
    const missing = businessRequiredInputs(config)
      .filter((name) => !isEntered(values[name]))
      .map((name) => inputError(name, 'is required by every match group of the template'));
    return [...refused, ...missing];
  },
};
