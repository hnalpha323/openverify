/**
 * C61.1, C61.2: SEC EDGAR, bound only with the operator's fair-access User-Agent contact, through
 * the outbound HTTP client at 10 requests a second install-wide. It covers US registrants only and
 * is never authoritative. A numeric registration number is the CIK; otherwise the name is found in
 * `company_tickers.json` (listed companies only, decision 47), kept in memory for a day, and the
 * closest company kept (none below `partial`). EDGAR publishes no legal status (`status` is `null`,
 * so the active check answers `status_not_available`) and no persons.
 */
import { US_JURISDICTIONS } from '@openverify/contracts';
import { z } from 'zod';
import type { OutboundHttp, OutboundHttpClient } from '../../http/index.js';
import {
  systemClock,
  type BusinessRecord,
  type BusinessRegistryLookupResult,
  type BusinessRegistryProvider,
  type Clock,
} from '../../ports.js';
import { ProviderError } from '../errors.js';
import { closestByName, nameSearchKeeps } from './candidates.js';
import { requestJson } from './http.js';
import type { PacingRule, ProviderPacer } from './pacing.js';
import type { RegistryQueryCache } from './query-cache.js';

/** Where EDGAR's submissions and the listed companies' tickers live. */
export const SEC_EDGAR_URLS = Object.freeze({
  submissions: 'https://data.sec.gov/submissions/',
  tickers: 'https://www.sec.gov/files/company_tickers.json',
});

/** C61.2: 10 requests a second, for the whole organisation. */
export const SEC_EDGAR_PACING: PacingRule = Object.freeze({ name: 'sec-edgar', intervalMs: 100 });

/** How long the listed companies' tickers are kept in memory. */
export const SEC_EDGAR_TICKERS_TTL_MS = 24 * 60 * 60 * 1000;

export interface SecEdgarRegisterOptions {
  /** The operator's `<organisation> <contact email>` (`OPENVERIFY_SEC_EDGAR_USER_AGENT`). */
  userAgent: string;
  outboundHttp?: OutboundHttp | undefined;
  pacer: ProviderPacer;
  queryCache: RegistryQueryCache;
  clock?: Clock | undefined;
  /** Tests point them elsewhere; production uses {@link SEC_EDGAR_URLS}. */
  urls?: { submissions: string; tickers: string } | undefined;
}

/** `company_tickers.json` is about a megabyte; this leaves it room to grow. */
export const SEC_EDGAR_TICKERS_MAX_BYTES = 8 * 1024 * 1024;

const CIK = /^\d{1,10}$/;
const text = z.string().max(500);
const optionalText = text.nullable().optional();

const addressSchema = z.object({
  street1: optionalText,
  street2: optionalText,
  city: optionalText,
  stateOrCountry: optionalText,
  zipCode: optionalText,
});

const submissionsSchema = z.object({
  cik: z.union([z.string().regex(CIK), z.int().min(0)]),
  name: text.min(1),
  stateOfIncorporation: optionalText,
  formerNames: z
    .array(z.object({ name: text }))
    .max(64)
    .nullable()
    .optional(),
  addresses: z.object({ business: addressSchema.nullable().optional() }).nullable().optional(),
});
type Submissions = z.infer<typeof submissionsSchema>;

const tickersSchema = z.record(
  z.string(),
  z.object({ cik_str: z.int().min(0), title: text.min(1) }),
);

const malformed = () =>
  new ProviderError('sec-edgar: the answer is not what EDGAR publishes', {
    retryable: false,
    code: 'sec_edgar_malformed',
  });

/** A CIK without its leading zeros. */
const unpadded = (cik: string | number) => String(Number(cik));

/** C61.1: the submissions as the port carries them. */
function businessRecordOf(submissions: Submissions, entered: string | undefined): BusinessRecord {
  const cik = unpadded(submissions.cik);
  const business = submissions.addresses?.business;
  const state = business?.stateOrCountry ?? null;
  // A US address carries its state's code; EDGAR writes other countries as its own codes.
  const domestic = state !== null && (US_JURISDICTIONS as readonly string[]).includes(state);
  return {
    source: 'sec-edgar',
    recordId: cik,
    legalName: submissions.name,
    otherNames: (submissions.formerNames ?? []).map((former) => former.name),
    status: null,
    statusDetail: null,
    registeredAddress:
      business == null
        ? null
        : {
            lines: [business.street1, business.street2].filter(
              (line): line is string => typeof line === 'string' && line !== '',
            ),
            city: business.city ?? null,
            region: domestic ? `US-${state}` : null,
            postalCode: business.zipCode ?? null,
            country: domestic ? 'US' : null,
          },
    jurisdiction: submissions.stateOfIncorporation ?? null,
    // The same CIK, as the user wrote it (with or without its leading zeros).
    registrationNumber: entered !== undefined && unpadded(entered) === cik ? entered : cik,
  };
}

const NOT_FOUND: BusinessRegistryLookupResult = { outcome: 'not_found', authoritative: false };

/** The EDGAR register (C61.1). Its outbound clients are made once, on the first lookup. */
export function createSecEdgarRegister(options: SecEdgarRegisterOptions): BusinessRegistryProvider {
  const { outboundHttp, pacer, queryCache } = options;
  const clock = options.clock ?? systemClock;
  const urls = options.urls ?? SEC_EDGAR_URLS;
  const headers = { 'user-agent': options.userAgent, accept: 'application/json' };
  let submissionsClient: OutboundHttpClient | undefined;
  let tickersClient: OutboundHttpClient | undefined;
  let tickers: { at: number; companies: { cik: string; title: string }[] } | undefined;

  /** The submissions and tickers clients, made together on the first lookup. */
  function clients(): { submissions: OutboundHttpClient; tickers: OutboundHttpClient } {
    if (outboundHttp === undefined) {
      throw new ProviderError('sec-edgar: no outbound client', {
        retryable: false,
        code: 'sec_edgar_not_configured',
      });
    }
    submissionsClient ??= outboundHttp.client({
      name: 'sec-edgar',
      contentTypes: ['application/json'],
      timeoutMs: 10_000,
    });
    tickersClient ??= outboundHttp.client({
      name: 'sec-edgar',
      contentTypes: ['application/json'],
      maxResponseBytes: SEC_EDGAR_TICKERS_MAX_BYTES,
      timeoutMs: 10_000,
    });
    return { submissions: submissionsClient, tickers: tickersClient };
  }

  async function get(client: OutboundHttpClient, url: string): Promise<unknown> {
    await pacer.acquire(SEC_EDGAR_PACING, 'install');
    const answer = await requestJson(client, { method: 'GET', url, headers }, 'sec_edgar');
    return answer.found ? answer.json : null;
  }

  /** The submissions of a CIK, or `null` when EDGAR holds none. */
  async function submissionsOf(cik: string): Promise<Submissions | null> {
    const json = await get(
      clients().submissions,
      `${urls.submissions}CIK${cik.padStart(10, '0')}.json`,
    );
    if (json === null) {
      return null;
    }
    const parsed = submissionsSchema.safeParse(json);
    if (!parsed.success) {
      throw malformed();
    }
    return parsed.data;
  }

  /** The listed companies, kept in memory for a day (decision 47). */
  async function listedCompanies() {
    const now = clock.now().getTime();
    if (tickers !== undefined && now - tickers.at <= SEC_EDGAR_TICKERS_TTL_MS) {
      return tickers.companies;
    }
    const json = await get(clients().tickers, urls.tickers);
    const parsed = tickersSchema.safeParse(json ?? {});
    if (!parsed.success) {
      throw malformed();
    }
    const companies = Object.values(parsed.data).map((entry) => ({
      cik: String(entry.cik_str),
      title: entry.title,
    }));
    tickers = { at: now, companies };
    return companies;
  }

  return {
    id: 'sec-edgar',
    sandbox: false,
    source: 'sec-edgar',
    async lookup(request) {
      if (request.country.toUpperCase() !== 'US') {
        return { outcome: 'unsupported_country' };
      }
      clients();
      const entered = request.registrationNumber?.trim();
      const byCik = entered !== undefined && CIK.test(entered);
      const query = {
        country: 'US',
        businessName: byCik ? undefined : request.businessName,
        registrationNumber: byCik ? entered : undefined,
      };
      const cached = await queryCache.get('sec-edgar', query);
      if (cached?.kind === 'not_found') {
        return NOT_FOUND;
      }
      let cik: string | null = byCik ? unpadded(entered) : (cached?.recordId ?? null);
      if (cik === null) {
        const closest = closestByName(request.businessName, await listedCompanies(), (company) => [
          company.title,
        ]);
        cik = closest !== null && nameSearchKeeps(closest.level) ? closest.candidate.cik : null;
      }
      const submissions = cik === null ? null : await submissionsOf(cik);
      if (submissions === null) {
        await queryCache.put('sec-edgar', query, { kind: 'not_found', authoritative: false });
        return NOT_FOUND;
      }
      const record = businessRecordOf(submissions, byCik ? entered : undefined);
      if (!byCik) {
        await queryCache.put('sec-edgar', query, { kind: 'record', recordId: record.recordId });
      }
      return { outcome: 'found', record, authoritative: false, personsAvailable: false };
    },
  };
}
