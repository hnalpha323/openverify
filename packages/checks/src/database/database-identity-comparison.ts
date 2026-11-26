/**
 * `database_identity_comparison` (R+A, fraud; C58.1, C59.3): the entered identity against the source's record
 * through the configured match groups: passed when any group is met, failed (`low_confidence_match`)
 * only when every group is unmet, review (`insufficient_data`) otherwise. A miss is
 * `record_not_found` only from an authoritative source, else `no_matching_record` (review).
 */
import type { CheckResult } from '@openverify/core';
import {
  evaluateMatchGroups,
  fieldMatch,
  type FieldLevels,
  type FieldMatch,
  type MatchGroup,
} from '../matching/levels.js';
import { checkResult } from '../result.js';
import { databaseCheckConfig, databaseResultOptions, type DatabaseCheckConfig } from './config.js';
import {
  DATABASE_MATCH_FIELD_ORDER,
  databaseFieldMatches,
  describeMatch,
  type DatabaseContext,
} from './context.js';
import { isStandInResult, providerAnswer } from './provider.js';

const ID = 'database_identity_comparison';
const KEYS = [
  'match-groups',
  'accept-precision-limited-birthdate',
  'accept-transposed-birthdate',
] as const;

/**
 * R2 and R4 under the template: a precision-limited birthdate counts unless refused, a transposed
 * one only when accepted; otherwise it is undecidable (`missing`), never a mismatch.
 */
function acceptedBirthdate(match: FieldMatch, config: DatabaseCheckConfig): FieldMatch {
  const refused =
    match.level === 'partial' &&
    ((match.flags.includes('transposed') &&
      config.values['accept-transposed-birthdate'] !== true) ||
      (match.flags.includes('precision-limited') &&
        config.values['accept-precision-limited-birthdate'] === false));
  return refused ? fieldMatch('missing', [], [...match.flags, 'not-accepted']) : match;
}

const groupsOf = (config: DatabaseCheckConfig): MatchGroup[] => {
  const groups = config.values['match-groups'];
  return Array.isArray(groups) ? (groups as MatchGroup[]) : [];
};

export function databaseIdentityComparison(context: DatabaseContext): CheckResult {
  const config = databaseCheckConfig(context.template, ID);
  const options = databaseResultOptions(config, KEYS);
  const { values } = context.input;
  if (values === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const answer = providerAnswer(ID, context.input.providers?.database, options);
  if (isStandInResult(answer)) {
    return answer;
  }
  const withProvider = { ...options, provider: answer.provider };
  const lookup = answer.result;
  if (lookup.outcome === 'unsupported_country') {
    return checkResult(ID, 'not_applicable', ['unsupported_country'], {}, withProvider);
  }
  if (lookup.outcome === 'not_found') {
    const metadata = { authoritative: lookup.authoritative };
    return lookup.authoritative
      ? checkResult(ID, 'failed', ['record_not_found'], metadata, withProvider)
      : checkResult(ID, 'not_applicable', ['no_matching_record'], metadata, withProvider);
  }
  const fields = context.fields ?? databaseFieldMatches(values, lookup.record, context.now);
  const birthdate = acceptedBirthdate(fields.birthdate, config);
  const matches = { ...fields, birthdate };
  const levels: FieldLevels = Object.fromEntries(
    DATABASE_MATCH_FIELD_ORDER.map((field) => [field, matches[field].level]),
  );
  const groups = groupsOf(config);
  const evaluated = evaluateMatchGroups(groups, levels);
  const named = [...new Set(groups.flatMap((group) => Object.keys(group)))];
  const metadata = {
    authoritative: lookup.authoritative,
    fields: {
      ...Object.fromEntries(
        DATABASE_MATCH_FIELD_ORDER.map((field) => [field, describeMatch(matches[field])]),
      ),
      address: { ...describeMatch(matches.address), components: { ...matches.address.components } },
    },
    groups: evaluated.groups.map((group) => ({
      fields: { ...group.fields },
      outcome: group.outcome,
    })),
    'not-requested-fields': DATABASE_MATCH_FIELD_ORDER.filter(
      (field) => named.includes(field) && !context.collected.has(field),
    ),
  };
  switch (evaluated.outcome) {
    case 'met':
      return checkResult(ID, 'passed', [], metadata, withProvider);
    case 'unmet':
      return checkResult(ID, 'failed', ['low_confidence_match'], metadata, withProvider);
    case 'undecidable':
      return checkResult(ID, 'not_applicable', ['insufficient_data'], metadata, withProvider);
  }
}
