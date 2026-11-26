/**
 * `database_business_identity_comparison` (R+A, fraud, required; C58.1, C61.7): the entered business
 * against the first register's record through the configured match groups: the best level over
 * the legal name and every other name (C58.6), the registration number and the address. Passed
 * when a group is met, failed (`low_confidence_match`) only when every group is unmet, review
 * (`insufficient_data`) otherwise. A number an authoritative register lacks answers
 * `registration_number_not_found` (review: a slip is not fraud, V14); any other miss
 * `no_registry_record` (sole traders are not on company registers).
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { matchAddresses, type PostalAddress } from '../matching/addresses.js';
import { matchBusinessNames } from '../matching/business-names.js';
import { matchIdentificationNumbers } from '../matching/identifiers.js';
import {
  evaluateMatchGroups,
  fieldMatch,
  type FieldMatch,
  type MatchGroup,
} from '../matching/levels.js';
import { checkResult, presentText } from '../result.js';
import type { DatabaseBusinessContext } from './context.js';
import type { BusinessRegistryRecord, DatabaseBusinessValues } from './inputs.js';

const ID = 'database_business_identity_comparison';

const RANK = { full: 3, partial: 2, none: 1, missing: 0 } as const;

/** The best of several comparisons: full, else partial, else none, else missing. */
export function bestBusinessNameMatch(
  name: string | null | undefined,
  candidates: readonly string[],
): FieldMatch {
  let best = fieldMatch('missing');
  for (const candidate of candidates) {
    const match = matchBusinessNames(name, candidate);
    if (RANK[match.level] > RANK[best.level]) {
      best = match;
    }
  }
  return best;
}

/** The entered business's address. */
export function enteredBusinessAddress(values: DatabaseBusinessValues): PostalAddress {
  return {
    street1: values['address-street-1'] ?? null,
    street2: values['address-street-2'] ?? null,
    city: values['address-city'] ?? null,
    subdivision: values['address-subdivision'] ?? null,
    postalCode: values['address-postal-code'] ?? null,
    countryCode: values['country-code'] ?? null,
  };
}

/** A record's registered address; an ISO 3166-2 region (`US-UT`) reads as its subdivision (`UT`). */
export function registeredBusinessAddress(record: BusinessRegistryRecord): PostalAddress {
  const address = record.registeredAddress;
  if (address === null || address === undefined) {
    return {};
  }
  const region = presentText(address.region);
  const dash = region?.indexOf('-') ?? -1;
  return {
    street1: address.lines[0] ?? null,
    street2: address.lines[1] ?? null,
    city: address.city,
    subdivision: region !== null && dash === 2 ? region.slice(3) : region,
    postalCode: address.postalCode,
    countryCode: address.country,
  };
}

const describe = (match: FieldMatch) => ({
  level: match.level,
  methods: [...match.methods],
  flags: [...match.flags],
});

export function databaseBusinessIdentityComparison(context: DatabaseBusinessContext): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const options = phase5ResultOptions(config, ['match-groups']);
  const { values } = context.input;
  if (values === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const reading = context.registry;
  switch (reading.kind) {
    case 'not_configured':
      return checkResult(ID, 'not_applicable', ['provider_not_configured'], {}, options);
    case 'error':
      return checkResult(ID, 'not_applicable', ['execution_error'], {}, options);
    case 'unsupported_country':
      return checkResult(
        ID,
        'not_applicable',
        ['no_registry_record'],
        {},
        { ...options, provider: reading.provider },
      );
    case 'not_found': {
      const withProvider = { ...options, provider: reading.provider };
      const metadata = { authoritative: reading.authoritative };
      // V14: a number the authoritative register lacks is a slip to review, never fraud.
      return reading.authoritative && presentText(values['registration-number']) !== null
        ? checkResult(
            ID,
            'not_applicable',
            ['registration_number_not_found'],
            metadata,
            withProvider,
          )
        : checkResult(ID, 'not_applicable', ['no_registry_record'], metadata, withProvider);
    }
    case 'found':
      break;
  }
  const { record } = reading;
  const name = bestBusinessNameMatch(values['business-name'], [
    record.legalName,
    ...record.otherNames,
  ]);
  const number = matchIdentificationNumbers(
    values['registration-number'],
    record.registrationNumber,
  );
  const address = matchAddresses(enteredBusinessAddress(values), registeredBusinessAddress(record));
  const groups = Array.isArray(config.values['match-groups'])
    ? (config.values['match-groups'] as MatchGroup[])
    : [];
  const evaluated = evaluateMatchGroups(groups, {
    name: name.level,
    'registration-number': number.level,
    address: address.level,
  });
  const metadata = {
    source: record.source,
    authoritative: reading.authoritative,
    fields: {
      name: describe(name),
      'registration-number': describe(number),
      address: { ...describe(address), components: { ...address.components } },
    },
    groups: evaluated.groups.map((group) => ({
      fields: { ...group.fields },
      outcome: group.outcome,
    })),
  };
  const withProvider = { ...options, provider: reading.provider };
  switch (evaluated.outcome) {
    case 'met':
      return checkResult(ID, 'passed', [], metadata, withProvider);
    case 'unmet':
      return checkResult(ID, 'failed', ['low_confidence_match'], metadata, withProvider);
    case 'undecidable':
      return checkResult(ID, 'not_applicable', ['insufficient_data'], metadata, withProvider);
  }
}
