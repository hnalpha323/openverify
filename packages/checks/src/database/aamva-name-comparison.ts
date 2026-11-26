/**
 * `aamva_name_comparison` (A, fraud; C59.5): the record's verdict on the first and last names
 * (metadata `name-first-match`, `name-last-match`).
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { aamvaVerdict, mismatchedFieldsOf } from './aamva-verdict.js';
import { isStandInResult } from './provider.js';
import type { AamvaContext } from './context.js';

const ID = 'aamva_name_comparison';
const JUDGED: readonly string[] = ['name-first', 'name-last'];

export function aamvaNameComparison(context: AamvaContext): CheckResult {
  const answer = aamvaVerdict(context, ID, ['name-first', 'name-last'], {});
  if (isStandInResult(answer)) {
    return answer;
  }
  const options = { provider: answer.provider };
  const { result } = answer;
  switch (result.outcome) {
    case 'match':
      return checkResult(
        ID,
        'passed',
        [],
        { 'name-first-match': true, 'name-last-match': true },
        options,
      );
    case 'no_match': {
      const fields = mismatchedFieldsOf(result);
      if (fields === null) {
        // DLDV answers per attribute; a no-match without them says nothing about this one.
        return checkResult(ID, 'not_applicable', ['execution_error'], {}, options);
      }
      const metadata = {
        'name-first-match': !fields.includes('name-first'),
        'name-last-match': !fields.includes('name-last'),
      };
      return JUDGED.some((field) => fields.includes(field))
        ? checkResult(ID, 'failed', ['name_mismatch'], metadata, options)
        : checkResult(ID, 'passed', [], metadata, options);
    }
    case 'not_found':
      return checkResult(ID, 'failed', ['record_not_found'], {}, options);
    case 'jurisdiction_not_participating':
      return checkResult(ID, 'not_applicable', ['jurisdiction_not_participating'], {}, options);
  }
}
