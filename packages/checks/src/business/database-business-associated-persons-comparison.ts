/**
 * `database_business_associated_persons_comparison` (R+A, fraud, advisory; C61.7): each submitted
 * person matches an active officer or person with significant control on the record by name (at
 * `min-match-level`) and month and year of birth. A person the register does not hold fails
 * `associated_person_not_on_register` (the docs explain the PSC threshold); a name match whose birth
 * month cannot be compared answers `input_missing` (review). `not_requested` (non-blocking) when
 * the step does not collect persons, `source_has_no_persons` when the source publishes none.
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { meetsRequirement } from '../matching/levels.js';
import { matchNameStrings } from '../matching/names.js';
import { checkResult, presentText } from '../result.js';
import type { DatabaseBusinessContext } from './context.js';
import type { AssociatedPersonValues, BusinessPersonRecord } from './inputs.js';

const ID = 'database_business_associated_persons_comparison';

const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])/;

/** A register's `SURNAME, Forenames` as `Forenames SURNAME`; other forms as written. */
export function registerPersonName(name: string): string {
  const comma = name.indexOf(',');
  return comma === -1 ? name : `${name.slice(comma + 1).trim()} ${name.slice(0, comma).trim()}`;
}

/** `equal`, `different`, or `unknown` when either side has no birth month. */
function birthMonths(
  entered: string | null | undefined,
  published: string | null,
): 'equal' | 'different' | 'unknown' {
  const left = presentText(entered);
  if (left === null || published === null || !MONTH.test(left) || !MONTH.test(published)) {
    return 'unknown';
  }
  // Both sides are a month and a year: equal months are the evidence (a register publishes no day).
  return left.slice(0, 7) === published.slice(0, 7) ? 'equal' : 'different';
}

type PersonOutcome = 'matched' | 'unmatched' | 'undecided';

function personOutcome(
  person: AssociatedPersonValues,
  register: readonly BusinessPersonRecord[],
  required: 'partial' | 'full',
): PersonOutcome {
  const name = [person['name-first'], person['name-last']]
    .map((part) => presentText(part))
    .join(' ');
  const comparisons = register
    .filter((officer) => officer.active)
    .filter((officer) =>
      meetsRequirement(matchNameStrings(name, registerPersonName(officer.name)).level, required),
    )
    .map((officer) => birthMonths(person.birthdate, officer.birthMonth));
  if (comparisons.includes('equal')) {
    return 'matched';
  }
  return comparisons.includes('unknown') ? 'undecided' : 'unmatched';
}

export function databaseBusinessAssociatedPersonsComparison(
  context: DatabaseBusinessContext,
): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const options = phase5ResultOptions(config, ['min-match-level']);
  const { values, collectAssociatedPersons } = context.input;
  if (values === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  if (!collectAssociatedPersons) {
    return checkResult(ID, 'not_applicable', ['not_requested'], {}, options);
  }
  const persons = (values['associated-persons'] ?? []).filter(
    (person) =>
      presentText(person['name-first']) !== null && presentText(person['name-last']) !== null,
  );
  if (persons.length === 0) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const reading = context.registry;
  switch (reading.kind) {
    case 'not_configured':
      return checkResult(ID, 'not_applicable', ['provider_not_configured'], {}, options);
    case 'error':
      return checkResult(ID, 'not_applicable', ['execution_error'], {}, options);
    case 'unsupported_country':
    case 'not_found':
      return checkResult(
        ID,
        'not_applicable',
        ['no_registry_record'],
        {},
        { ...options, provider: reading.provider },
      );
    case 'found':
      break;
  }
  const withProvider = { ...options, provider: reading.provider };
  if (!reading.personsAvailable) {
    return checkResult(
      ID,
      'not_applicable',
      ['source_has_no_persons'],
      { source: reading.record.source },
      withProvider,
    );
  }
  const required = config.values['min-match-level'] === 'full' ? 'full' : 'partial';
  const outcomes = persons.map((person) =>
    personOutcome(person, reading.record.persons ?? [], required),
  );
  const count = (outcome: PersonOutcome) => outcomes.filter((one) => one === outcome).length;
  const metadata = {
    source: reading.record.source,
    persons: persons.length,
    matched: count('matched'),
    unmatched: count('unmatched'),
    undecided: count('undecided'),
  };
  if (metadata.unmatched > 0) {
    return checkResult(ID, 'failed', ['associated_person_not_on_register'], metadata, withProvider);
  }
  return metadata.undecided > 0
    ? checkResult(ID, 'not_applicable', ['input_missing'], metadata, withProvider)
    : checkResult(ID, 'passed', [], metadata, withProvider);
}
