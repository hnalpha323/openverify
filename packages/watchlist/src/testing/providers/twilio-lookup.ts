/**
 * Synthetic Twilio Lookup v2 answers (C82.2) for the `twilio-lookup` adapter's tests against a
 * local stub: line type intelligence and SIM swap, on the ITU test network (MCC 001, MNC 01), for
 * NANP fictional numbers (`+1 NPA 555 01xx`), and Twilio's error body. Lookup states no prepaid
 * type and no porting, so the sandbox endings that need them (02, 04) answer as a mobile line.
 */
import { jsonAnswer, type StubAnswer } from '../stub-answer.js';

/** Lookup v2's line types. */
export const TWILIO_LINE_TYPES = [
  'landline',
  'mobile',
  'fixedVoip',
  'nonFixedVoip',
  'personal',
  'tollFree',
  'premium',
  'sharedCost',
  'uan',
  'voicemail',
  'pager',
  'unknown',
] as const;
export type TwilioLineType = (typeof TWILIO_LINE_TYPES)[number];

export interface TwilioLookupOptions {
  readonly phoneNumber: string;
  readonly valid?: boolean;
  /** `null` when the line type package was not asked for. */
  readonly lineType?: TwilioLineType | null;
  readonly carrierName?: string;
  /** `null` when the SIM swap package was not asked for; else the time since the last swap. */
  readonly simSwap?: { readonly hoursAgo: number | null } | null;
  /** The time `hoursAgo` counts from. */
  readonly now?: Date;
}

const TEST_NETWORK = { mobile_country_code: '001', mobile_network_code: '01' } as const;
const CALLING_CODES: readonly (readonly [string, string])[] = [
  ['1', 'US'],
  ['44', 'GB'],
  ['61', 'AU'],
];

const isoSeconds = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;

export function twilioLookupAnswer(options: TwilioLookupOptions): StubAnswer {
  const digits = options.phoneNumber.replace(/^\+/u, '');
  const [callingCode, country] = CALLING_CODES.find(([code]) => digits.startsWith(code)) ?? [
    '',
    null,
  ];
  const nanp = callingCode === '1' && digits.length === 11;
  const carrier = options.carrierName ?? 'Synthetic Test Carrier';
  const swap = options.simSwap ?? null;
  const now = options.now ?? new Date();
  return jsonAnswer(200, {
    calling_country_code: callingCode,
    country_code: country,
    phone_number: options.phoneNumber,
    national_format: nanp
      ? `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
      : options.phoneNumber,
    valid: options.valid ?? true,
    validation_errors: options.valid === false ? ['NOT_A_NUMBER'] : [],
    caller_name: null,
    sim_swap:
      swap === null
        ? null
        : {
            last_sim_swap: {
              last_sim_swap_date:
                swap.hoursAgo === null
                  ? null
                  : isoSeconds(new Date(now.getTime() - swap.hoursAgo * 3_600_000)),
              swapped_period: swap.hoursAgo === null ? null : `PT${String(swap.hoursAgo)}H`,
              swapped_in_period: swap.hoursAgo !== null && swap.hoursAgo <= 24,
            },
            carrier_name: carrier,
            ...TEST_NETWORK,
            error_code: null,
          },
    call_forwarding: null,
    line_status: null,
    line_type_intelligence:
      options.lineType === undefined || options.lineType === null
        ? null
        : { ...TEST_NETWORK, carrier_name: carrier, type: options.lineType, error_code: null },
    identity_match: null,
    reassigned_number: null,
    sms_pumping_risk: null,
    phone_number_quality_score: null,
    pre_fill: null,
    url: `https://lookups.twilio.com/v2/PhoneNumbers/${options.phoneNumber}`,
  });
}

export function twilioErrorAnswer(status: number, code: number, message: string): StubAnswer {
  return jsonAnswer(status, {
    code,
    message,
    more_info: `https://www.twilio.com/docs/errors/${String(code)}`,
    status,
  });
}

/** The line type of each NANP fictional ending Lookup can state (C82.4). */
const SCENARIO_TYPES: Readonly<Record<string, TwilioLineType>> = {
  '00': 'mobile',
  '01': 'nonFixedVoip',
  '02': 'mobile',
  '03': 'mobile',
  '04': 'mobile',
  '05': 'unknown',
  '06': 'fixedVoip',
};

/** The answer for a NANP fictional number by its last two digits (C82.4), as Lookup states it. */
export function twilioScenarioAnswer(phoneNumber: string, now: Date): StubAnswer {
  const ending = phoneNumber.slice(-2);
  return twilioLookupAnswer({
    phoneNumber,
    lineType: SCENARIO_TYPES[ending] ?? 'unknown',
    simSwap: { hoursAgo: ending === '03' ? 6 : null },
    now,
  });
}
