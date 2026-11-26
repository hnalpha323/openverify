/**
 * C61.1, C61.2: the UK Companies House register, bound only with the operator's key for the
 * environment kind (the live register for production environments, the Companies House sandbox for
 * sandbox ones), HTTP Basic with the key as the user name, through the outbound HTTP client at 600
 * requests per five minutes. It covers GB only. A company number is read directly, and a number
 * the register lacks is an authoritative miss; otherwise the register is searched by name and the
 * closest company kept (none below `partial`). Its active officers and individual persons with
 * significant control are read on every lookup (never cached, C61.2), with only the month and year
 * of birth the register publishes.
 */
import { z } from 'zod';
import type { OutboundHttp, OutboundHttpClient } from '../../http/index.js';
import type {
  BusinessPerson,
  BusinessRecord,
  BusinessRegistryLookupResult,
  BusinessRegistryProvider,
  EnvironmentKind,
} from '../../ports.js';
import { ProviderError } from '../errors.js';
import { closestByName, nameSearchKeeps } from './candidates.js';
import { requestJson } from './http.js';
import type { PacingRule, ProviderPacer } from './pacing.js';
import type { RegistryQueryCache } from './query-cache.js';

/** Where the Companies House public data API lives, per environment kind. */
export const COMPANIES_HOUSE_BASE_URLS: Readonly<Record<EnvironmentKind, string>> = Object.freeze({
  production: 'https://api.company-information.service.gov.uk',
  sandbox: 'https://api-sandbox.company-information.service.gov.uk',
});

/** C61.2: 600 requests per five minutes. */
export const COMPANIES_HOUSE_PACING: PacingRule = Object.freeze({
  name: 'companies-house',
  intervalMs: 500,
});

/** C52.3: a company number: eight digits, or two letters and six digits. */
export const COMPANY_NUMBER = /^(?:\d{8}|[A-Z]{2}\d{6})$/;

export interface CompaniesHouseRegisterOptions {
  /** The key for `environment`. Secret: never logged or echoed. */
  apiKey: string;
  environment: EnvironmentKind;
  outboundHttp?: OutboundHttp | undefined;
  pacer: ProviderPacer;
  queryCache: RegistryQueryCache;
  /** Tests point it elsewhere; production uses {@link COMPANIES_HOUSE_BASE_URLS}. */
  baseUrl?: string | undefined;
}

/** A search page: the closest of these is kept. */
export const COMPANIES_HOUSE_SEARCH_PAGE_SIZE = 20;
/** The officers and PSCs read: the register's largest page. */
export const COMPANIES_HOUSE_PERSONS_PAGE_SIZE = 100;

const text = z.string().max(500);
const optionalText = text.nullable().optional();
const birthSchema = z
  .object({ month: z.int().min(1).max(12), year: z.int().min(1800).max(2200) })
  .nullable()
  .optional();

const profileSchema = z.object({
  company_name: text.min(1),
  company_number: z.string().regex(COMPANY_NUMBER),
  company_status: optionalText,
  company_status_detail: optionalText,
  jurisdiction: optionalText,
  registered_office_address: z
    .object({
      premises: optionalText,
      address_line_1: optionalText,
      address_line_2: optionalText,
      locality: optionalText,
      region: optionalText,
      postal_code: optionalText,
    })
    .nullable()
    .optional(),
  previous_company_names: z
    .array(z.object({ name: text }))
    .max(64)
    .nullable()
    .optional(),
});
type Profile = z.infer<typeof profileSchema>;

const searchSchema = z.object({
  items: z
    .array(z.object({ company_number: z.string().regex(COMPANY_NUMBER), title: text }))
    .max(100)
    .optional(),
});

const officersSchema = z.object({
  items: z
    .array(
      z.object({
        name: text.min(1),
        officer_role: optionalText,
        resigned_on: optionalText,
        date_of_birth: birthSchema,
      }),
    )
    .max(COMPANIES_HOUSE_PERSONS_PAGE_SIZE)
    .optional(),
});

const pscsSchema = z.object({
  items: z
    .array(
      z.object({
        name: text.optional(),
        kind: optionalText,
        ceased_on: optionalText,
        ceased: z.boolean().nullable().optional(),
        date_of_birth: birthSchema,
      }),
    )
    .max(COMPANIES_HOUSE_PERSONS_PAGE_SIZE)
    .optional(),
});

const malformed = () =>
  new ProviderError('companies-house: the answer is not what the register publishes', {
    retryable: false,
    code: 'companies_house_malformed',
  });

function parsed<T>(schema: z.ZodType<T>, json: unknown): T {
  const result = schema.safeParse(json);
  if (!result.success) {
    throw malformed();
  }
  return result.data;
}

/** `YYYY-MM`, the only part of a birth date the register publishes. */
const birthMonthOf = (birth: { month: number; year: number } | null | undefined) =>
  birth == null ? null : `${String(birth.year)}-${String(birth.month).padStart(2, '0')}`;

/** C61.1: the profile as the port carries it, with its persons. */
function businessRecordOf(
  profile: Profile,
  persons: readonly BusinessPerson[] | undefined,
): BusinessRecord {
  const office = profile.registered_office_address;
  const first = [office?.premises, office?.address_line_1].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  );
  return {
    source: 'companies-house',
    recordId: profile.company_number,
    legalName: profile.company_name,
    otherNames: (profile.previous_company_names ?? []).map((previous) => previous.name),
    status: profile.company_status ?? null,
    statusDetail: profile.company_status_detail ?? null,
    registeredAddress:
      office == null
        ? null
        : {
            lines: [first.join(' '), office.address_line_2 ?? ''].filter((line) => line !== ''),
            city: office.locality ?? null,
            region: office.region ?? null,
            postalCode: office.postal_code ?? null,
            country: 'GB',
          },
    jurisdiction: profile.jurisdiction ?? null,
    registrationNumber: profile.company_number,
    ...(persons === undefined ? {} : { persons }),
  };
}

/** The Companies House register (C61.1). Its outbound client is made once, on the first lookup. */
export function createCompaniesHouseRegister(
  options: CompaniesHouseRegisterOptions,
): BusinessRegistryProvider {
  const { outboundHttp, pacer, queryCache, environment } = options;
  const baseUrl = options.baseUrl ?? COMPANIES_HOUSE_BASE_URLS[environment];
  const authorization = `Basic ${Buffer.from(`${options.apiKey}:`).toString('base64')}`;
  let client: OutboundHttpClient | undefined;

  async function get(path: string): Promise<unknown> {
    if (outboundHttp === undefined) {
      throw new ProviderError('companies-house: no outbound client', {
        retryable: false,
        code: 'companies_house_not_configured',
      });
    }
    client ??= outboundHttp.client({
      name: 'companies-house',
      contentTypes: ['application/json'],
      timeoutMs: 10_000,
    });
    await pacer.acquire(COMPANIES_HOUSE_PACING, environment);
    const answer = await requestJson(
      client,
      {
        method: 'GET',
        url: `${baseUrl}${path}`,
        headers: { authorization, accept: 'application/json' },
      },
      'companies_house',
    );
    return answer.found ? answer.json : null;
  }

  const companyPath = (number: string) => `/company/${encodeURIComponent(number)}`;

  /**
   * C61.2: the officers and individual PSCs, never cached, read only for a lookup that asks for
   * persons (Workflow 5C review K6).
   */
  async function personsOf(number: string): Promise<BusinessPerson[]> {
    const page = `items_per_page=${String(COMPANIES_HOUSE_PERSONS_PAGE_SIZE)}`;
    const officers = await get(`${companyPath(number)}/officers?${page}`);
    const pscs = await get(`${companyPath(number)}/persons-with-significant-control?${page}`);
    const people: BusinessPerson[] = [];
    for (const officer of officers === null ? [] : (parsed(officersSchema, officers).items ?? [])) {
      // A corporate officer is a company, never an associated person (C61.7).
      if (officer.officer_role?.startsWith('corporate') !== true) {
        people.push({
          name: officer.name,
          birthMonth: birthMonthOf(officer.date_of_birth),
          role: 'officer',
          active: officer.resigned_on == null,
        });
      }
    }
    for (const psc of pscs === null ? [] : (parsed(pscsSchema, pscs).items ?? [])) {
      if (psc.kind?.startsWith('individual') === true && psc.name !== undefined) {
        people.push({
          name: psc.name,
          birthMonth: birthMonthOf(psc.date_of_birth),
          role: 'psc',
          active: psc.ceased_on == null && psc.ceased !== true,
        });
      }
    }
    return people;
  }

  /**
   * The company of `number`, with its persons when `withPersons`, or `null` when the register has
   * none. Without persons the record carries none; the register still publishes them.
   */
  async function company(
    number: string,
    withPersons: boolean,
  ): Promise<BusinessRegistryLookupResult | null> {
    const json = await get(companyPath(number));
    if (json === null) {
      return null;
    }
    const profile = parsed(profileSchema, json);
    return {
      outcome: 'found',
      record: businessRecordOf(
        profile,
        withPersons ? await personsOf(profile.company_number) : undefined,
      ),
      authoritative: true,
      personsAvailable: true,
    };
  }

  /** The closest company of a name search, or `null`. */
  async function searchByName(name: string): Promise<string | null> {
    const query = new URLSearchParams({
      q: name,
      items_per_page: String(COMPANIES_HOUSE_SEARCH_PAGE_SIZE),
    });
    const json = await get(`/search/companies?${query.toString()}`);
    const items = json === null ? [] : (parsed(searchSchema, json).items ?? []);
    const closest = closestByName(name, items, (item) => [item.title]);
    return closest !== null && nameSearchKeeps(closest.level)
      ? closest.candidate.company_number
      : null;
  }

  return {
    id: 'companies-house',
    sandbox: false,
    source: 'companies-house',
    async lookup(request) {
      if (request.country.toUpperCase() !== 'GB') {
        return { outcome: 'unsupported_country' };
      }
      const number = request.registrationNumber?.toUpperCase().replace(/\s/g, '');
      const byNumber = number !== undefined && COMPANY_NUMBER.test(number);
      const query = {
        country: 'GB',
        businessName: byNumber ? undefined : request.businessName,
        registrationNumber: byNumber ? number : undefined,
      };
      const cached = await queryCache.get('companies-house', query);
      if (cached?.kind === 'not_found') {
        return { outcome: 'not_found', authoritative: cached.authoritative };
      }
      const known = cached?.kind === 'record' ? cached.recordId : null;
      const resolved = byNumber ? number : (known ?? (await searchByName(request.businessName)));
      const answer =
        resolved === null ? null : await company(resolved, request.withPersons === true);
      if (answer === null) {
        // C61.1: the register is authoritative for a company number it was given.
        await queryCache.put('companies-house', query, {
          kind: 'not_found',
          authoritative: byNumber,
        });
        return { outcome: 'not_found', authoritative: byNumber };
      }
      if (!byNumber && resolved !== null) {
        await queryCache.put('companies-house', query, { kind: 'record', recordId: resolved });
      }
      return answer;
    },
  };
}
