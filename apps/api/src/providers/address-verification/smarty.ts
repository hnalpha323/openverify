/**
 * C82.3, C83: the `smarty` adapter, Smarty's US Street API (CASS-certified), through the outbound
 * client: `GET /street-address` with the operator's `auth-id` and `auth-token`, the normalised
 * components (`street`, `secondary`, `city`, `state`, `zipcode`) and one candidate. The port only
 * takes US addresses, and the addressee is sent only when the request carries it (the template's
 * `send-addressee`, P16).
 *
 * - The candidate's `metadata` and `analysis` become the public fields (`fields.ts`): the DPV
 *   match code's deliverability, the record and ZIP types, county, carrier route, RDI, precision,
 *   coordinates, CMRA, vacancy, activity, LACSLink and SuiteLink, and the footnotes. A value in
 *   another shape is `null`.
 * - An empty answer means Smarty knows no such delivery point (`match=strict`, the default):
 *   `deliverability: not_confirmed`, every other field `null`.
 * - 401, 402 and 403 fail for good; 429 and 5xx for a retry; a body that is not a list of
 *   candidates, a redirect or any other status fails for good. Errors never carry the address or
 *   the credentials (C53.8); the credentials ride in the query string, as Smarty takes them, and
 *   the outbound client never logs a URL.
 */
import { z } from 'zod';
import type { OutboundHttp, OutboundHttpClient } from '../../http/index.js';
import type {
  AddressVerificationProvider,
  AddressVerificationRequest,
  AddressVerificationResult,
} from '../../ports.js';
import { requestJson } from '../business-registry/http.js';
import { ProviderError } from '../errors.js';
import { deliverabilityOf, emptyAddressFields, flagOf, numberIn, textOf } from './fields.js';

/** C82.3: where Smarty's US Street API answers. */
export const SMARTY_US_STREET_ORIGIN = 'https://us-street.api.smarty.com';

/** One candidate is a few kilobytes. */
const MAX_RESPONSE_BYTES = 256 * 1024;

const candidatesSchema = z
  .array(
    z.object({
      metadata: z.record(z.string(), z.unknown()).optional(),
      analysis: z.record(z.string(), z.unknown()).optional(),
    }),
  )
  .max(10);

const ZIP_TYPES: Readonly<Record<string, 'unique' | 'military' | 'po_box' | 'standard'>> = {
  Unique: 'unique',
  Military: 'military',
  POBox: 'po_box',
  Standard: 'standard',
};
const RDI: Readonly<Record<string, 'residential' | 'commercial'>> = {
  Residential: 'residential',
  Commercial: 'commercial',
};

/** The public fields of one Smarty candidate. */
function fieldsOf(candidate: z.infer<typeof candidatesSchema>[number]): AddressVerificationResult {
  const metadata = candidate.metadata ?? {};
  const analysis = candidate.analysis ?? {};
  const lookup = <T>(table: Readonly<Record<string, T>>, value: unknown): T | null =>
    typeof value === 'string' && Object.hasOwn(table, value) ? (table[value] ?? null) : null;
  const matchCode = textOf(analysis.dpv_match_code, 4);
  const fips = textOf(metadata.county_fips, 5);
  return {
    fields: {
      ...emptyAddressFields(),
      deliverability: deliverabilityOf(matchCode),
      'metadata-record-type': textOf(metadata.record_type, 8),
      'metadata-zip-type': lookup(ZIP_TYPES, metadata.zip_type),
      'metadata-county-fips': fips !== null && /^\d{5}$/u.test(fips) ? fips : null,
      'metadata-county-name': textOf(metadata.county_name, 100),
      'metadata-carrier-route': textOf(metadata.carrier_route, 8),
      'metadata-latitude': numberIn(metadata.latitude, -90, 90),
      'metadata-longitude': numberIn(metadata.longitude, -180, 180),
      'metadata-precision': textOf(metadata.precision, 32),
      'metadata-residential-delivery-indicator': lookup(RDI, metadata.rdi),
      'analysis-dpv-match-code': matchCode,
      'analysis-dpv-cmra': flagOf(analysis.dpv_cmra),
      'analysis-dpv-vacant': flagOf(analysis.dpv_vacant),
      'analysis-active': flagOf(analysis.active),
      'analysis-lacs-link-code': textOf(analysis.lacslink_code, 8),
      'analysis-lacs-link-indicator': textOf(analysis.lacslink_indicator, 8),
      'analysis-suite-link-match':
        typeof analysis.suitelink_match === 'boolean' ? analysis.suitelink_match : null,
      'analysis-dpv-footnotes': textOf(analysis.dpv_footnotes, 64),
      'analysis-footnotes': textOf(analysis.footnotes, 64),
    },
  };
}

export interface SmartyOptions {
  authId: string;
  authToken: string;
  /** The worker's outbound client; a call without one fails for good. */
  outboundHttp?: OutboundHttp | undefined;
}

/** The `smarty` adapter (C82.3). Its outbound client is made on the first call. */
export function createSmartyProvider(options: SmartyOptions): AddressVerificationProvider {
  let client: OutboundHttpClient | undefined;
  return {
    id: 'smarty',
    sandbox: false,
    async verify(request: AddressVerificationRequest): Promise<AddressVerificationResult> {
      if (options.outboundHttp === undefined) {
        throw new ProviderError('smarty: no outbound client', {
          retryable: false,
          code: 'smarty_not_configured',
        });
      }
      client ??= options.outboundHttp.client({
        name: 'smarty',
        contentTypes: ['application/json'],
        maxResponseBytes: MAX_RESPONSE_BYTES,
      });
      const query = new URLSearchParams({
        'auth-id': options.authId,
        'auth-token': options.authToken,
        street: request.street1,
        ...(request.street2 === undefined ? {} : { secondary: request.street2 }),
        city: request.city,
        state: request.subdivision,
        zipcode: request.postalCode,
        ...(request.addressee === undefined ? {} : { addressee: request.addressee }),
        candidates: '1',
      });
      // 402 (the subscription ran out) fails for good, as any refusal no retry cures.
      const answer = await requestJson(
        client,
        {
          method: 'GET',
          url: `${SMARTY_US_STREET_ORIGIN}/street-address?${query.toString()}`,
          headers: { accept: 'application/json' },
        },
        'smarty',
      );
      if (!answer.found) {
        throw new ProviderError('smarty: the service answered 404', {
          retryable: false,
          code: 'smarty_rejected',
        });
      }
      const parsed = candidatesSchema.safeParse(answer.json);
      if (!parsed.success) {
        throw new ProviderError('smarty: the answer is not a list of candidates', {
          retryable: false,
          code: 'smarty_malformed',
        });
      }
      const [candidate] = parsed.data;
      if (candidate === undefined) {
        return { fields: { ...emptyAddressFields(), deliverability: 'not_confirmed' } };
      }
      return fieldsOf(candidate);
    },
  };
}
