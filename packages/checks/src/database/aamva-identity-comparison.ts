/**
 * `aamva_identity_comparison` (A, fraud; C59.5): fails `record_mismatch` when the jurisdiction's
 * record disagrees on any field outside `ignored-fields`, naming the fields, and
 * `record_not_found` without a record. A jurisdiction outside DLDV answers
 * `jurisdiction_not_participating` (review, or a skip of the verification: see
 * `aamvaSkipsVerification`).
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { aamvaVerdict, mismatchedFieldsOf } from './aamva-verdict.js';
import { isStandInResult } from './provider.js';
import { databaseCheckConfig, databaseResultOptions } from './config.js';
import type { AamvaContext } from './context.js';

const ID = 'aamva_identity_comparison';

export function aamvaIdentityComparison(context: AamvaContext): CheckResult {
  const config = databaseCheckConfig(context.template, ID);
  const options = databaseResultOptions(config, [
    'ignored-fields',
    'on-jurisdiction-not-participating',
  ]);
  const answer = aamvaVerdict(
    context,
    ID,
    ['name-first', 'name-last', 'birthdate', 'identification-number', 'issuing-authority'],
    options,
  );
  if (isStandInResult(answer)) {
    return answer;
  }
  const withProvider = { ...options, provider: answer.provider };
  const ignoredSetting = config.values['ignored-fields'];
  const ignored = Array.isArray(ignoredSetting) ? (ignoredSetting as readonly string[]) : [];
  const { result } = answer;
  switch (result.outcome) {
    case 'match':
      return checkResult(ID, 'passed', [], { 'mismatched-fields': [] }, withProvider);
    case 'no_match': {
      const fields = mismatchedFieldsOf(result);
      if (fields === null) {
        // Without the fields, an ignored one may be all that differs: no verdict is drawn then.
        return ignored.length === 0
          ? checkResult(
              ID,
              'failed',
              ['record_mismatch'],
              { 'mismatched-fields': [] },
              withProvider,
            )
          : checkResult(ID, 'not_applicable', ['execution_error'], {}, withProvider);
      }
      const metadata = {
        'mismatched-fields': fields.filter((field) => !ignored.includes(field)),
        'ignored-mismatches': fields.filter((field) => ignored.includes(field)),
      };
      return metadata['mismatched-fields'].length > 0
        ? checkResult(ID, 'failed', ['record_mismatch'], metadata, withProvider)
        : checkResult(ID, 'passed', [], metadata, withProvider);
    }
    case 'not_found':
      return checkResult(ID, 'failed', ['record_not_found'], {}, withProvider);
    case 'jurisdiction_not_participating':
      return checkResult(
        ID,
        'not_applicable',
        ['jurisdiction_not_participating'],
        {},
        withProvider,
      );
  }
}
