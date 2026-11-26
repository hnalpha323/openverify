/**
 * What the per-field database checks share (C59.3): a field of the entered values against the
 * record at `min-match-level`. `not_requested` (non-blocking) when the step did not collect the
 * field, `input_missing` when the user did not enter it, `no_matching_record` without a record,
 * `no_reference_data` when the record holds nothing comparable.
 */
import type { CheckId, CheckResult } from '@openverify/core';
import { meetsRequirement, type FieldMatch } from '../matching/levels.js';
import { checkResult } from '../result.js';
import { databaseCheckConfig, databaseResultOptions } from './config.js';
import {
  databaseFieldMatches,
  describeMatch,
  type DatabaseContext,
  type DatabaseFieldMatches,
} from './context.js';
import { isStandInResult, providerAnswer } from './provider.js';

export function compareDatabaseField(
  context: DatabaseContext,
  checkId: CheckId,
  field: 'name' | 'address' | 'birthdate',
  mismatch: string,
  judge: (match: FieldMatch) => string | null = () => null,
): CheckResult {
  const config = databaseCheckConfig(context.template, checkId);
  const options = databaseResultOptions(config, ['min-match-level']);
  const { values } = context.input;
  if (values === null) {
    return checkResult(checkId, 'not_applicable', ['input_missing'], {}, options);
  }
  if (!context.collected.has(field)) {
    return checkResult(checkId, 'not_applicable', ['not_requested'], {}, options);
  }
  if (!context.entered.has(field)) {
    return checkResult(checkId, 'not_applicable', ['input_missing'], {}, options);
  }
  const answer = providerAnswer(checkId, context.input.providers?.database, options);
  if (isStandInResult(answer)) {
    return answer;
  }
  const withProvider = { ...options, provider: answer.provider };
  const lookup = answer.result;
  if (lookup.outcome !== 'found') {
    return checkResult(checkId, 'not_applicable', ['no_matching_record'], {}, withProvider);
  }
  const fields: DatabaseFieldMatches =
    context.fields ?? databaseFieldMatches(values, lookup.record, context.now);
  const match = fields[field];
  const metadata =
    field === 'address'
      ? { ...describeMatch(match), components: { ...fields.address.components } }
      : describeMatch(match);
  const special = judge(match);
  if (special !== null) {
    return checkResult(checkId, 'not_applicable', [special], metadata, withProvider);
  }
  if (match.level === 'missing') {
    return checkResult(checkId, 'not_applicable', ['no_reference_data'], metadata, withProvider);
  }
  const required = config.values['min-match-level'] === 'full' ? 'full' : 'partial';
  return meetsRequirement(match.level, required)
    ? checkResult(checkId, 'passed', [], metadata, withProvider)
    : checkResult(checkId, 'failed', [mismatch], metadata, withProvider);
}
