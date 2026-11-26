/**
 * `document_address_comparison` (R, fraud, advisory; C60.6): the addressee block's address against
 * the reference's (the inquiry's fields, else its latest government ID, else the account), at
 * `min-match-level` through the C58 address matcher. Fails `postal_code_mismatch` when only the postal
 * code contradicts it, else `address_mismatch`; no reference answers `no_reference_data`, no
 * readable address or an undecidable comparison `input_missing`.
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { matchAddresses } from '../matching/addresses.js';
import { meetsRequirement } from '../matching/levels.js';
import { checkResult } from '../result.js';
import { documentReferenceAddress, type DocumentContext } from './context.js';

const ID = 'document_address_comparison';

/** The components besides the postal code that must agree for `postal_code_mismatch`. */
const OTHERS = ['country', 'house-number', 'street', 'unit'] as const;

export function documentAddressComparison(context: DocumentContext): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const options = phase5ResultOptions(config, ['min-match-level']);
  const { established, extraction } = context;
  if (established === null || extraction === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const reference = documentReferenceAddress(context.input);
  if (reference === null) {
    return checkResult(ID, 'not_applicable', ['no_reference_data'], {}, options);
  }
  if (extraction.address === null) {
    return checkResult(
      ID,
      'not_applicable',
      ['input_missing'],
      { 'reference-source': reference.source },
      options,
    );
  }
  const match = matchAddresses(extraction.address, reference.address);
  const metadata = {
    level: match.level,
    methods: [...match.methods],
    flags: [...match.flags],
    components: { ...match.components },
    'reference-source': reference.source,
  };
  if (match.level === 'missing') {
    return checkResult(ID, 'not_applicable', ['input_missing'], metadata, options);
  }
  const required = config.values['min-match-level'] === 'full' ? 'full' : 'partial';
  if (meetsRequirement(match.level, required)) {
    return checkResult(ID, 'passed', [], metadata, options);
  }
  const onlyPostalCode =
    match.components['postal-code'] === 'mismatch' &&
    OTHERS.every((component) => match.components[component] !== 'mismatch');
  return checkResult(
    ID,
    'failed',
    [onlyPostalCode ? 'postal_code_mismatch' : 'address_mismatch'],
    metadata,
    options,
  );
}
