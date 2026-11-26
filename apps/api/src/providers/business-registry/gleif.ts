/**
 * C61.1, C61.2: the GLEIF register (CC0, no key, on by default), through the outbound HTTP client
 * at 60 requests a minute install-wide. A business with an LEI is read by its LEI; otherwise GLEIF
 * is searched by the registration number GLEIF records (`registeredAs`) in the business's country,
 * then by legal name, and the closest record by name is kept (none below `partial` for a name
 * search). GLEIF is never authoritative (small businesses are rarely on it) and publishes no
 * persons. Its status is the registration status (`ISSUED`, `LAPSED` ...) and its detail the
 * entity's (`ACTIVE`, `INACTIVE`; an entity expiration reads `INACTIVE`), for the C61.2 table.
 */
import { z } from 'zod';
import type { OutboundHttp, OutboundHttpClient } from '../../http/index.js';
import type {
  BusinessRecord,
  BusinessRegistryLookupResult,
  BusinessRegistryProvider,
  BusinessRegistryRequest,
} from '../../ports.js';
import { ProviderError } from '../errors.js';
import { closestByName, nameSearchKeeps } from './candidates.js';
import { requestJson } from './http.js';
import type { PacingRule, ProviderPacer } from './pacing.js';
import type { RegistryQueryCache } from './query-cache.js';

/** Where the GLEIF API lives. */
export const GLEIF_API_BASE_URL = 'https://api.gleif.org/api/v1';

/** C61.2: 60 requests a minute, install-wide. */
export const GLEIF_PACING: PacingRule = Object.freeze({ name: 'gleif', intervalMs: 1000 });

/** A search page: the closest of these is kept. */
export const GLEIF_SEARCH_PAGE_SIZE = 10;

export interface GleifRegisterOptions {
  outboundHttp?: OutboundHttp | undefined;
  pacer: ProviderPacer;
  queryCache: RegistryQueryCache;
  /** Tests point it elsewhere; production uses {@link GLEIF_API_BASE_URL}. */
  baseUrl?: string | undefined;
}

/** The content types of GLEIF's JSON:API answers. */
const CONTENT_TYPES = ['application/vnd.api+json', 'application/json'];

const LEI_FORMAT = /^[A-Z0-9]{18}\d{2}$/;

const text = z.string().max(500);
const optionalText = text.nullable().optional();

const addressSchema = z.object({
  addressLines: z.array(text).max(8).optional(),
  city: optionalText,
  region: optionalText,
  country: optionalText,
  postalCode: optionalText,
});

/** The parts of a `lei-records` resource the register reads. */
const leiRecordSchema = z.object({
  id: z.string().regex(LEI_FORMAT),
  attributes: z.object({
    entity: z.object({
      legalName: z.object({ name: text.min(1) }),
      otherNames: z
        .array(z.object({ name: text }))
        .max(64)
        .nullable()
        .optional(),
      transliteratedOtherNames: z
        .array(z.object({ name: text }))
        .max(64)
        .nullable()
        .optional(),
      legalAddress: addressSchema,
      registeredAs: optionalText,
      jurisdiction: optionalText,
      status: optionalText,
      expiration: z.object({ reason: optionalText }).nullable().optional(),
    }),
    registration: z.object({ status: text.min(1) }),
  }),
});
type LeiRecord = z.infer<typeof leiRecordSchema>;

const oneRecordSchema = z.object({ data: leiRecordSchema });
const recordsSchema = z.object({ data: z.array(leiRecordSchema).max(100) });

const malformed = () =>
  new ProviderError('gleif: the answer is not a GLEIF record', {
    retryable: false,
    code: 'gleif_malformed',
  });

/** Every name GLEIF holds for the entity: legal, other and transliterated. */
function namesOf(record: LeiRecord): string[] {
  const { entity } = record.attributes;
  return [
    entity.legalName.name,
    ...(entity.otherNames ?? []).map((other) => other.name),
    ...(entity.transliteratedOtherNames ?? []).map((other) => other.name),
  ];
}

/** C61.1, C61.2: the record as the port carries it. */
function businessRecordOf(record: LeiRecord): BusinessRecord {
  const { entity, registration } = record.attributes;
  const [legalName, ...otherNames] = namesOf(record);
  const address = entity.legalAddress;
  // C61.2: an entity expiration (dissolved, merged ...) reads as an inactive entity.
  const expired = entity.expiration?.reason != null;
  return {
    source: 'gleif',
    recordId: record.id,
    legalName: legalName ?? entity.legalName.name,
    otherNames,
    status: registration.status,
    statusDetail: expired ? 'INACTIVE' : (entity.status ?? null),
    registeredAddress: {
      lines: address.addressLines ?? [],
      city: address.city ?? null,
      region: address.region ?? null,
      postalCode: address.postalCode ?? null,
      country: address.country ?? null,
    },
    jurisdiction: entity.jurisdiction ?? null,
    registrationNumber: entity.registeredAs ?? null,
  };
}

const found = (record: LeiRecord): BusinessRegistryLookupResult => ({
  outcome: 'found',
  record: businessRecordOf(record),
  authoritative: false,
  personsAvailable: false,
});

const NOT_FOUND: BusinessRegistryLookupResult = { outcome: 'not_found', authoritative: false };

/** The GLEIF register (C61.1). Its outbound client is made once, on the first lookup. */
export function createGleifRegister(options: GleifRegisterOptions): BusinessRegistryProvider {
  const { outboundHttp, pacer, queryCache } = options;
  const baseUrl = options.baseUrl ?? GLEIF_API_BASE_URL;
  let client: OutboundHttpClient | undefined;

  async function get(url: string): Promise<unknown> {
    if (outboundHttp === undefined) {
      throw new ProviderError('gleif: no outbound client', {
        retryable: false,
        code: 'gleif_not_configured',
      });
    }
    client ??= outboundHttp.client({
      name: 'gleif',
      contentTypes: CONTENT_TYPES,
      timeoutMs: 10_000,
    });
    await pacer.acquire(GLEIF_PACING, 'install');
    const answer = await requestJson(
      client,
      { method: 'GET', url, headers: { accept: 'application/vnd.api+json' } },
      'gleif',
    );
    return answer.found ? answer.json : null;
  }

  /** The record of an LEI, or `null` when GLEIF holds none. */
  async function byLei(lei: string): Promise<LeiRecord | null> {
    const json = await get(`${baseUrl}/lei-records/${encodeURIComponent(lei)}`);
    if (json === null) {
      return null;
    }
    const parsed = oneRecordSchema.safeParse(json);
    if (!parsed.success) {
      throw malformed();
    }
    return parsed.data.data;
  }

  /** One search page in the business's country. */
  async function search(filter: string, value: string, country: string): Promise<LeiRecord[]> {
    const query = new URLSearchParams({
      [filter]: value,
      'filter[entity.legalAddress.country]': country,
      'page[size]': String(GLEIF_SEARCH_PAGE_SIZE),
    });
    const json = await get(`${baseUrl}/lei-records?${query.toString()}`);
    if (json === null) {
      return [];
    }
    const parsed = recordsSchema.safeParse(json);
    if (!parsed.success) {
      throw malformed();
    }
    return parsed.data.data;
  }

  /** By number, then by name: the closest record, or `null`. */
  async function bySearch(request: BusinessRegistryRequest): Promise<LeiRecord | null> {
    const country = request.country.toUpperCase();
    if (request.registrationNumber !== undefined) {
      const byNumber = await search(
        'filter[entity.registeredAs]',
        request.registrationNumber,
        country,
      );
      // A record GLEIF holds under the number is the business, whatever its name now.
      const closest = closestByName(request.businessName, byNumber, namesOf);
      if (closest !== null) {
        return closest.candidate;
      }
    }
    const byName = await search('filter[entity.legalName]', request.businessName, country);
    const closest = closestByName(request.businessName, byName, namesOf);
    return closest !== null && nameSearchKeeps(closest.level) ? closest.candidate : null;
  }

  return {
    id: 'gleif',
    sandbox: false,
    source: 'gleif',
    async lookup(request) {
      const lei = request.lei?.toUpperCase();
      if (lei !== undefined && LEI_FORMAT.test(lei)) {
        const record = await byLei(lei);
        return record === null ? NOT_FOUND : found(record);
      }
      const query = {
        country: request.country,
        businessName: request.businessName,
        registrationNumber: request.registrationNumber,
      };
      const cached = await queryCache.get('gleif', query);
      if (cached?.kind === 'not_found') {
        return NOT_FOUND;
      }
      if (cached?.kind === 'record') {
        const record = await byLei(cached.recordId);
        if (record !== null) {
          return found(record);
        }
      }
      const record = await bySearch(request);
      await queryCache.put(
        'gleif',
        query,
        record === null
          ? { kind: 'not_found', authoritative: false }
          : { kind: 'record', recordId: record.id },
      );
      return record === null ? NOT_FOUND : found(record);
    },
  };
}
