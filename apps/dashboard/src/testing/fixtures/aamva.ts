/**
 * C59.4–C59.6, C66: AAMVA verifications whose check results carry the metadata the evaluators
 * write (`packages/checks/src/database/aamva-*.ts`): the identity's `mismatched-fields` and
 * `ignored-mismatches`, the name check's `name-first-match` and `name-last-match`, the sandbox
 * provider in their provenance. The scenarios follow the sandbox endings (C59.4): a match,
 * `0002` (the postal code differs), `9999` (no record), `5555` (the jurisdiction does not take
 * part). Every value is synthetic: an invented person and licence number.
 */
import type { VerificationCheck } from '@openverify/contracts';
import type { Phase5Verification } from '../../components/evidence';
import { phase5Verification } from '../phase5-fixtures';

/** The licence as the form, or the server's copy, holds it. */
export const AAMVA_VALUES: Readonly<Record<string, string | null>> = Object.freeze({
  'name-first': 'Rowan',
  'name-last': 'Quillon',
  birthdate: '1990-04-12',
  'identification-number': 'D1230002',
  'issuing-authority': 'CA',
  'issue-date': '2022-01-15',
  'expiration-date': '2030-04-12',
  'address-postal-code': '90001',
});

/** The values distinctive enough to search a page or a payload for. */
export const AAMVA_PII_VALUES: readonly string[] = [
  'Rowan',
  'Quillon',
  '1990-04-12',
  'D1230002',
  '2022-01-15',
  '2030-04-12',
];

export type AamvaScenario =
  'match' | 'postal-code' | 'ignored' | 'not-found' | 'not-participating' | 'no-field-list';

const SANDBOX = Object.freeze({ id: 'sandbox', sandbox: true });

const result = (
  name: string,
  status: VerificationCheck['status'],
  reasons: string[],
  metadata: Record<string, unknown>,
  thresholds: Record<string, string | string[]> = {},
): VerificationCheck =>
  ({
    name,
    status,
    reasons,
    requirement: name === 'aamva_identity_comparison' ? 'required' : 'not_required',
    metadata,
    stage: 'ga',
    confidence: null,
    provenance: {
      'implementation-version': 1,
      provider: SANDBOX,
      thresholds,
      ...(Object.keys(thresholds).length === 0
        ? {}
        : {
            'threshold-basis': Object.fromEntries(
              Object.keys(thresholds).map((key) => [key, 'provisional']),
            ),
          }),
    },
    category: 'fraud',
  }) as VerificationCheck;

const IDENTITY = 'aamva_identity_comparison';
const NAME = 'aamva_name_comparison';
const NUMBER = 'aamva_identification_number_comparison';

/** The three AAMVA results as the evaluators write them for `scenario`. */
export function aamvaChecks(scenario: AamvaScenario = 'match'): VerificationCheck[] {
  const thresholds = (ignored: string[] = []) => ({
    'ignored-fields': ignored,
    'on-jurisdiction-not-participating': 'review',
  });
  const names = { 'name-first-match': true, 'name-last-match': true };
  switch (scenario) {
    case 'match':
      return [
        result(IDENTITY, 'passed', [], { 'mismatched-fields': [] }, thresholds()),
        result(NAME, 'passed', [], names),
        result(NUMBER, 'passed', [], {}),
      ];
    case 'postal-code':
      return [
        result(
          IDENTITY,
          'failed',
          ['record_mismatch'],
          { 'mismatched-fields': ['address-postal-code'], 'ignored-mismatches': [] },
          thresholds(),
        ),
        result(NAME, 'passed', [], names),
        result(NUMBER, 'passed', [], {}),
      ];
    case 'ignored':
      return [
        result(
          IDENTITY,
          'passed',
          [],
          { 'mismatched-fields': [], 'ignored-mismatches': ['address-postal-code'] },
          thresholds(['address-postal-code']),
        ),
        result(NAME, 'passed', [], names),
        result(NUMBER, 'passed', [], {}),
      ];
    case 'not-found':
      return [
        result(IDENTITY, 'failed', ['record_not_found'], {}, thresholds()),
        result(NAME, 'failed', ['record_not_found'], {}),
        result(NUMBER, 'failed', ['record_not_found'], {}),
      ];
    case 'not-participating':
      return [IDENTITY, NAME, NUMBER].map((name) =>
        result(
          name,
          'not_applicable',
          ['jurisdiction_not_participating'],
          {},
          name === IDENTITY ? thresholds() : {},
        ),
      );
    case 'no-field-list':
      return [
        result(IDENTITY, 'failed', ['record_mismatch'], { 'mismatched-fields': [] }, thresholds()),
        result(NAME, 'not_applicable', ['execution_error'], {}),
        result(NUMBER, 'not_applicable', ['execution_error'], {}),
      ];
  }
}

const STATUS: Readonly<Record<AamvaScenario, string>> = {
  match: 'passed',
  'postal-code': 'failed',
  ignored: 'passed',
  'not-found': 'failed',
  'not-participating': 'needs_review',
  'no-field-list': 'failed',
};

export interface AamvaVerificationOptions {
  readonly scenario?: AamvaScenario;
  /** `form` by default; `government_id` for the silent step's copy (C59.6). */
  readonly source?: 'form' | 'government_id' | null;
  readonly masked?: boolean;
  readonly checks?: VerificationCheck[];
  readonly status?: string;
  readonly values?: Readonly<Record<string, string | null>>;
}

/** An AAMVA verification of `scenario`, as the API answers for it. */
export function aamvaVerification(options: AamvaVerificationOptions = {}): Phase5Verification {
  const scenario = options.scenario ?? 'match';
  return phase5Verification('verification/aamva', {
    masked: options.masked === true,
    attributes: {
      status: options.status ?? STATUS[scenario],
      checks: options.checks ?? aamvaChecks(scenario),
      source: options.source === undefined ? 'form' : options.source,
      ...AAMVA_VALUES,
      ...options.values,
    },
  });
}

/** A redacted AAMVA verification: every value `null`, every result's metadata emptied (C16). */
export function redactedAamvaVerification(): Phase5Verification {
  return aamvaVerification({
    scenario: 'postal-code',
    masked: true,
    checks: aamvaChecks('postal-code').map((check) => ({ ...check, reasons: [], metadata: {} })),
  });
}
