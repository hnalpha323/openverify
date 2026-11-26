/**
 * Synthetic Smarty US Street API answers (C82.3) for the `smarty` adapter's tests against a local
 * stub: candidates with their components, metadata and DPV analysis, an empty answer for an
 * address Smarty cannot match, a 401, and the sandbox house numbers 1000-1006 (C82.4). Candidates
 * echo the request's components; nothing in them is a real delivery point.
 */
import { jsonAnswer, textAnswer, type StubAnswer } from '../stub-answer.js';

/** The request fields the adapter sends (the normalised components; never an addressee). */
export interface SmartyInput {
  readonly street: string;
  readonly secondary?: string;
  readonly city: string;
  readonly state: string;
  readonly zipcode: string;
}

/** How a candidate's delivery point matched. */
export type SmartyDeliverability =
  'confirmed' | 'missing_secondary' | 'invalid_secondary' | 'not_confirmed';

export interface SmartyCandidateOptions {
  readonly deliverability?: SmartyDeliverability;
  readonly residential?: boolean;
  readonly cmra?: boolean;
  readonly vacant?: boolean;
}

/** A US Street API candidate (fields as Smarty names them). */
export type SmartyCandidate = Readonly<Record<string, unknown>>;

/** DPV match codes and footnotes per deliverability. */
const DPV: Readonly<Record<SmartyDeliverability, readonly [string, string]>> = {
  confirmed: ['Y', 'AABB'],
  missing_secondary: ['D', 'AAN1'],
  invalid_secondary: ['S', 'AACC'],
  not_confirmed: ['N', 'AAM1'],
};

const flag = (value: boolean): string => (value ? 'Y' : 'N');

export function smartyCandidate(
  input: SmartyInput,
  options: SmartyCandidateOptions = {},
): SmartyCandidate {
  const [primary = '', ...rest] = input.street.split(' ');
  const suffix = rest.length > 1 ? (rest.at(-1) ?? '') : '';
  const streetName = (suffix === '' ? rest : rest.slice(0, -1)).join(' ');
  const [matchCode, footnotes] = DPV[options.deliverability ?? 'confirmed'];
  return {
    input_index: 0,
    candidate_index: 0,
    delivery_line_1:
      input.secondary === undefined ? input.street : `${input.street} ${input.secondary}`,
    last_line: `${input.city} ${input.state} ${input.zipcode}-0001`,
    delivery_point_barcode: `${input.zipcode}000100`,
    components: {
      primary_number: primary,
      street_name: streetName,
      ...(suffix === '' ? {} : { street_suffix: suffix }),
      ...(input.secondary === undefined ? {} : { secondary_number: input.secondary }),
      city_name: input.city,
      default_city_name: input.city,
      state_abbreviation: input.state,
      zipcode: input.zipcode,
      plus4_code: '0001',
      delivery_point: '00',
      delivery_point_check_digit: '0',
    },
    metadata: {
      record_type: 'S',
      zip_type: 'Standard',
      county_fips: '00000',
      county_name: 'Synthetic',
      carrier_route: 'C001',
      congressional_district: '00',
      rdi: options.residential === false ? 'Commercial' : 'Residential',
      elot_sequence: '0001',
      elot_sort: 'A',
      latitude: 0,
      longitude: 0,
      precision: 'Zip9',
      time_zone: 'Central',
      utc_offset: -6,
      dst: true,
    },
    analysis: {
      dpv_match_code: matchCode,
      dpv_footnotes: footnotes,
      dpv_cmra: flag(options.cmra === true),
      dpv_vacant: flag(options.vacant === true),
      dpv_no_stat: 'N',
      active: 'Y',
      enhanced_match: 'postal-match',
    },
  };
}

export function smartyStreetAnswer(candidates: readonly SmartyCandidate[]): StubAnswer {
  return jsonAnswer(200, candidates);
}

export function smartyUnauthorizedAnswer(): StubAnswer {
  return textAnswer(401, 'The credentials are missing or not valid. (synthetic)');
}

/** What each sandbox house number answers (1002, undeliverable, has no candidate). */
const SCENARIOS: Readonly<Record<string, SmartyCandidateOptions | null>> = {
  '1000': { residential: true },
  '1001': { residential: false },
  '1002': null,
  '1003': { cmra: true },
  '1004': { vacant: true },
  '1005': { deliverability: 'missing_secondary' },
  '1006': { deliverability: 'invalid_secondary' },
};

/** The answer for the sandbox house numbers 1000-1006, else an unmatched address. */
export function smartyScenarioAnswer(input: SmartyInput): StubAnswer {
  const options = SCENARIOS[input.street.split(' ')[0] ?? ''] ?? null;
  return smartyStreetAnswer(options === null ? [] : [smartyCandidate(input, options)]);
}
