/**
 * C82.2, C83: the `twilio-lookup` adapter, Twilio Lookup v2, through the outbound client:
 * `GET /v2/PhoneNumbers/{E.164}?Fields=line_type_intelligence,sim_swap` with HTTP Basic auth by
 * the operator's API key SID and secret (`OPENVERIFY_TWILIO_LOOKUP_*`, separate from the API's SMS
 * credentials, decision 32). Only the number is sent (P16).
 *
 * - **Line type.** `line_type_intelligence.type` in Lookup's own vocabulary (`mobile`,
 *   `landline`, `fixedVoip`, `nonFixedVoip`, `tollFree`, `pager`, …); `unknown`, an error code or
 *   no package is no answer. The carrier is the package's `carrier_name`.
 * - **SIM swap.** Checked only when the package answered with `last_sim_swap_date`; a package that
 *   is not enabled for the account (carrier approval), an error code or no date is "not checked",
 *   never "no swap". Lookup states no porting, so porting is never checked here.
 * - **Errors.** 401 and 403 fail for good; 429 and 5xx for a retry; a body that is not Lookup's
 *   answer, a redirect or any other status fails for good; a 404 is no answer at all. Errors name
 *   the adapter and the failure only, never the number or the key (C53.8).
 */
import type { NetworkLineType } from '@openverify/checks';
import { z } from 'zod';
import type { OutboundHttp, OutboundHttpClient } from '../../http/index.js';
import type { PhoneIntelligenceProvider, PhoneIntelligenceResult } from '../../ports.js';
import { requestJson } from '../business-registry/http.js';
import { ProviderError } from '../errors.js';
import { answerOf, type PhoneIntelligenceAnswer } from './answer.js';

/** C82.2: where Twilio Lookup v2 answers. */
export const TWILIO_LOOKUP_ORIGIN = 'https://lookups.twilio.com';

/** Lookup's answer is a few hundred bytes. */
const MAX_RESPONSE_BYTES = 64 * 1024;

/** Lookup v2's line types (the rule reads every one of them). */
const LOOKUP_LINE_TYPES = [
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
] as const satisfies readonly NetworkLineType[];

const text = z.string().max(500).nullable().optional();

const answerSchema = z.object({
  line_type_intelligence: z
    .object({
      type: z.string().max(64).nullable().optional(),
      carrier_name: text,
      error_code: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  sim_swap: z
    .object({
      last_sim_swap: z
        .object({ last_sim_swap_date: z.string().max(64).nullable().optional() })
        .nullable()
        .optional(),
      carrier_name: text,
      error_code: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const nothing = (): PhoneIntelligenceAnswer =>
  answerOf({
    lineType: null,
    carrier: null,
    simSwap: { checked: false },
    porting: { checked: false },
  });

function lineTypeOf(type: string | null | undefined): NetworkLineType | null {
  const known = LOOKUP_LINE_TYPES.find((name) => name === type);
  return known === undefined || known === 'unknown' ? null : known;
}

function dateOf(value: string | null | undefined): Date | null {
  const time = value == null ? Number.NaN : Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

export interface TwilioLookupOptions {
  apiKeySid: string;
  apiKeySecret: string;
  /** The worker's outbound client; a call without one fails for good. */
  outboundHttp?: OutboundHttp | undefined;
}

/** The `twilio-lookup` adapter (C82.2). Its outbound client is made on the first call. */
export function createTwilioLookupProvider(
  options: TwilioLookupOptions,
): PhoneIntelligenceProvider {
  let client: OutboundHttpClient | undefined;
  const authorization = `Basic ${Buffer.from(`${options.apiKeySid}:${options.apiKeySecret}`).toString('base64')}`;
  return {
    id: 'twilio-lookup',
    sandbox: false,
    async lookup({ phoneNumber }): Promise<PhoneIntelligenceResult> {
      if (options.outboundHttp === undefined) {
        throw new ProviderError('twilio-lookup: no outbound client', {
          retryable: false,
          code: 'twilio_lookup_not_configured',
        });
      }
      client ??= options.outboundHttp.client({
        name: 'twilio-lookup',
        contentTypes: ['application/json'],
        maxResponseBytes: MAX_RESPONSE_BYTES,
      });
      const query = new URLSearchParams({ Fields: 'line_type_intelligence,sim_swap' });
      const answer = await requestJson(
        client,
        {
          method: 'GET',
          url: `${TWILIO_LOOKUP_ORIGIN}/v2/PhoneNumbers/${encodeURIComponent(phoneNumber)}?${query.toString()}`,
          headers: { accept: 'application/json', authorization },
        },
        'twilio_lookup',
      );
      if (!answer.found) {
        return nothing();
      }
      const parsed = answerSchema.safeParse(answer.json);
      if (!parsed.success) {
        throw new ProviderError('twilio-lookup: the answer is not Lookup’s', {
          retryable: false,
          code: 'twilio_lookup_malformed',
        });
      }
      const line = parsed.data.line_type_intelligence ?? null;
      const swap = parsed.data.sim_swap ?? null;
      const lineAnswered = line !== null && line.error_code == null;
      const swapAnswered = swap !== null && swap.error_code == null;
      const lastSwapAt = swapAnswered ? dateOf(swap.last_sim_swap?.last_sim_swap_date) : null;
      return answerOf({
        lineType: lineAnswered ? lineTypeOf(line.type) : null,
        carrier:
          (lineAnswered ? line.carrier_name : null) ??
          (swapAnswered ? swap.carrier_name : null) ??
          null,
        simSwap: lastSwapAt === null ? { checked: false } : { checked: true, lastSwapAt },
        porting: { checked: false },
      });
    },
  };
}
