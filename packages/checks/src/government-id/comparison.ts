/**
 * The inquiry and account comparisons (C34): the extraction against user-entered or account
 * fields (the snake_case keys of the default account fields schema), under the C31.2 rules with
 * the configured `name-threshold`. Names allow a middle name or token the user left out;
 * addresses compare after normalization. Only names of fields, never values, reach the result.
 */
import type { CheckId, CheckResult, ExtractedFields, ExtractionField } from '@openverify/core';
import { fieldsAgree, namesAgree } from '../extraction/agreement.js';
import { checkResult, presentText } from '../result.js';
import { checkConfigOf, type GovernmentIdContext } from './context.js';
import { listOf, numberOf } from './values.js';

type ComparisonField = 'name' | 'birthdate' | 'address' | 'identification-number';

const ADDRESS: readonly (readonly [reference: string, field: ExtractionField])[] = [
  ['address_street_1', 'address-street-1'],
  ['address_street_2', 'address-street-2'],
  ['address_city', 'address-city'],
  ['address_subdivision', 'address-subdivision'],
  ['address_postal_code', 'address-postal-code'],
  ['address_country_code', 'address-country-code'],
];

interface Outcome {
  /** The reference holds data for the field. */
  referenced: boolean;
  /** `null` when the field could not be compared (one side lacks it). */
  agrees: boolean | null;
}

const text = (reference: Readonly<Record<string, unknown>>, key: string): string | null =>
  presentText(reference[key]);

function compareName(
  reference: Readonly<Record<string, unknown>>,
  fields: ExtractedFields,
  threshold: number,
): Outcome {
  const first = text(reference, 'name_first');
  const middle = text(reference, 'name_middle');
  const last = text(reference, 'name_last');
  const referenced = first !== null || last !== null;
  const parts: boolean[] = [];
  if (last !== null && fields['name-last'] !== null) {
    parts.push(namesAgree(last, fields['name-last'], { threshold, allowMissingTokens: true }));
  }
  const documentGiven = [fields['name-first'], fields['name-middle']]
    .filter((part) => part !== null)
    .join(' ');
  if (first !== null && documentGiven !== '') {
    const given = [first, middle].filter((part) => part !== null).join(' ');
    parts.push(namesAgree(given, documentGiven, { threshold, allowMissingTokens: true }));
  }
  return { referenced, agrees: parts.length === 0 ? null : parts.every(Boolean) };
}

function compareValues(
  pairs: readonly (readonly [string | null, string | null, ExtractionField])[],
): Outcome {
  const referenced = pairs.some(([value]) => value !== null);
  const compared = pairs.filter(
    (pair): pair is readonly [string, string, ExtractionField] =>
      pair[0] !== null && pair[1] !== null,
  );
  return {
    referenced,
    agrees:
      compared.length === 0 ? null : compared.every(([a, b, field]) => fieldsAgree(field, a, b)),
  };
}

function compare(
  field: ComparisonField,
  reference: Readonly<Record<string, unknown>>,
  fields: ExtractedFields,
  threshold: number,
): Outcome {
  switch (field) {
    case 'name':
      return compareName(reference, fields, threshold);
    case 'birthdate':
      return compareValues([[text(reference, 'birthdate'), fields.birthdate, 'birthdate']]);
    case 'identification-number':
      return compareValues([
        [
          text(reference, 'identification_number'),
          fields['identification-number'],
          'identification-number',
        ],
      ]);
    case 'address':
      return compareValues(
        ADDRESS.map(([key, name]) => [text(reference, key), fields[name], name]),
      );
  }
}

/**
 * Compares the extraction with a reference: `passed` when every field compared agrees, a
 * `<field>_mismatch` per field that does not, `no_reference_data` when the reference holds none
 * of the configured fields (or there is no reference), and `input_missing` when it holds some the
 * extraction lacks, or when the worker passed no reference at all.
 */
export function compareWithReference(
  context: GovernmentIdContext,
  checkId: CheckId,
  reference: Readonly<Record<string, unknown>> | null | undefined,
): CheckResult {
  const config = checkConfigOf(context, checkId);
  const threshold = numberOf(config, 'name-threshold') ?? 0.88;
  const configured = (listOf(config, 'fields') ?? []) as readonly ComparisonField[];
  const thresholds = { 'name-threshold': threshold, fields: [...configured] };
  if (reference === undefined) {
    return checkResult(checkId, 'not_applicable', ['input_missing'], {}, { thresholds });
  }
  if (reference === null) {
    return checkResult(checkId, 'not_applicable', ['no_reference_data'], {}, { thresholds });
  }
  const outcomes = configured.map(
    (field) =>
      [
        field,
        compare(field, reference, context.extraction.consolidated.fields, threshold),
      ] as const,
  );
  const compared = outcomes
    .filter(([, outcome]) => outcome.agrees !== null)
    .map(([field]) => field);
  const mismatched = outcomes
    .filter(([, outcome]) => outcome.agrees === false)
    .map(([field]) => field);
  const metadata = { 'compared-fields': compared, 'mismatched-fields': mismatched };
  if (mismatched.length > 0) {
    return checkResult(
      checkId,
      'failed',
      mismatched.map((field) => `${field.replace(/-/g, '_')}_mismatch`),
      metadata,
      { thresholds },
    );
  }
  if (compared.length === 0) {
    const referenced = outcomes.some(([, outcome]) => outcome.referenced);
    return checkResult(
      checkId,
      'not_applicable',
      [referenced ? 'input_missing' : 'no_reference_data'],
      metadata,
      { thresholds },
    );
  }
  return checkResult(checkId, 'passed', [], metadata, { thresholds });
}
