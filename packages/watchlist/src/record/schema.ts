/**
 * C77.1, C77.5: the normalised watchlist record and the import format, frozen in Workflow 6A
 * Stage 1a (F12), with two optional risk-data members added in Workflow 6C (owner decision 9
 * after Workflow 6B: `list_memberships` and `relative_of_class`). Inspired by FollowTheMoney's
 * model (MIT, read as a reference); our own code.
 *
 * Every parser (OFAC, EU, UK, UN, the Wikidata PEP answers) writes one record per publisher
 * entry, validated here before a sync applies (`refused_schema`, C76.2). Keys are snake_case, as
 * `watchlist_entries.data` stores them. Every string and list is capped, so a hostile or broken
 * file is refused instead of stored; the list caps are generous enough for real publications.
 */
import { WRITING_SYSTEMS } from '@openverify/checks';
import { z } from 'zod';

/** C77.1: the caps of the record. */
export const WATCHLIST_RECORD_LIMITS = Object.freeze({
  /** A name or name part. */
  name: 300,
  /** An address line, city or birthplace. */
  address: 500,
  /** An identifier value. */
  identifier: 100,
  /** A crypto address (as OFAC allows, C79.3). */
  cryptoAddress: 256,
  /** A programme, a ticker, a position label. */
  label: 200,
  /** Remarks, which neither hash reads. */
  remarks: 2000,
  /** The publisher's entry id. */
  entryId: 100,
  /** The most items of each list member. */
  names: 500,
  items: 500,
  cryptoAddresses: 1000,
});

/** C77.1: what an entry is; persons are screened against individuals, businesses against entities. */
export const WATCHLIST_ENTRY_KINDS = ['individual', 'entity', 'vessel', 'aircraft'] as const;
export type WatchlistEntryKind = (typeof WATCHLIST_ENTRY_KINDS)[number];

/** C77.1: the roles of a name's parts. */
export const NAME_PART_ROLES = [
  'given',
  'family',
  'middle',
  'patronymic',
  'title',
  'suffix',
  'legal_form',
] as const;

/** C77.1: an alias's weight, from OFAC `isLowQuality`, UN `QUALITY`, EU `strong`, UK `AliasStrength`. */
export const NAME_QUALITIES = ['strong', 'weak'] as const;

/** C77.1: the roles of a country on an entry. */
export const COUNTRY_ROLES = [
  'nationality',
  'citizenship',
  'residence',
  'birth',
  'registration',
  'address',
] as const;

/** C77.1: the kinds of identifier an entry may carry (C78.3 retrieves them exactly). */
export const IDENTIFIER_KINDS = [
  'passport',
  'national_id',
  'tax_id',
  'registration_number',
  'lei',
  'swift_bic',
  'imo',
  'mmsi',
  'aircraft_serial',
  'aircraft_tail',
  'website',
  'email',
  'other',
] as const;

/** C80.2: whether a PEP holds a position now (an open-ended tenure is `yes` only under its rule). */
export const IN_OFFICE_VALUES = ['yes', 'no', 'unknown'] as const;

/** C80.3: the family links a PEP record may carry. */
export const RELATION_KINDS = ['spouse', 'child', 'parent', 'sibling'] as const;

const L = WATCHLIST_RECORD_LIMITS;

const text = (max: number) => z.string().min(1).max(max);
const list = <Item extends z.ZodType>(item: Item, max: number = L.items) => z.array(item).max(max);
const countryCode = z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code');

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, without calendar checks (lists carry placeholders). */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const partialDate = z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/);
const LENGTH_BY_PRECISION = { year: 4, month: 7, day: 10 } as const;

export const watchlistNameSchema = z.strictObject({
  full: text(L.name),
  parts: list(z.strictObject({ role: z.enum(NAME_PART_ROLES), value: text(L.name) }), 20),
  /** C58's writing systems (`latin`, `cyrillic`, `arabic`, `han`, ..., `other`). */
  script: z.enum(WRITING_SYSTEMS),
  quality: z.enum(NAME_QUALITIES),
  primary: z.boolean(),
});

export const watchlistBirthDateSchema = z
  .strictObject({
    value: partialDate,
    precision: z.enum(['day', 'month', 'year']),
    /** OFAC date ranges, UN `BETWEEN` and circa dates. */
    range: z.strictObject({ from: partialDate, to: partialDate }).optional(),
  })
  .refine((date) => date.value.length === LENGTH_BY_PRECISION[date.precision], {
    message: 'the value does not fit its precision',
    path: ['value'],
  });

export const watchlistPositionSchema = z.strictObject({
  /** The position's QID (or a fictional `Q-test-…` id in the synthetic lists). */
  position: text(64),
  label: text(L.label),
  /** C80.2: the public class numbers; `null` when the position has none. */
  pep_class: z.int().min(1).max(4).nullable(),
  country: countryCode.nullable(),
  start: partialDate.nullable(),
  end: z.union([partialDate, z.literal('unknown')]).nullable(),
  in_office: z.enum(IN_OFFICE_VALUES),
});

/**
 * Owner decision 9 after Workflow 6B: one list other than the SDN List that an OFAC entry is on
 * (the Consolidated, non-SDN lists: sectoral, menu-based and the others), so a non-blocking
 * listing is never read as an SDN-level block. Risk data (C77.3), read by neither the matcher nor
 * the content hash.
 */
export const watchlistListMembershipSchema = z.strictObject({
  /** The list's name as the publisher writes it (`Sectoral Sanctions Identifications List`). */
  list: text(L.label),
  /** A programme the file ties to that list, or `null` when the file ties none to it. */
  program: text(L.label).nullable(),
});
export type WatchlistListMembership = z.infer<typeof watchlistListMembershipSchema>;

export const watchlistRecordSchema = z
  .strictObject({
    /** The publisher's id (OFAC UID, EU logical id, UK unique id, UN reference, a QID). */
    entry_id: text(L.entryId),
    kind: z.enum(WATCHLIST_ENTRY_KINDS),
    names: z.array(watchlistNameSchema).min(1).max(L.names),
    birth_dates: list(watchlistBirthDateSchema, 50),
    birth_places: list(text(L.address), 50),
    countries: list(
      z.strictObject({ code: countryCode.nullable(), role: z.enum(COUNTRY_ROLES) }),
      100,
    ),
    gender: z.enum(['female', 'male']).optional(),
    identifiers: list(
      z.strictObject({
        kind: z.enum(IDENTIFIER_KINDS),
        value: text(L.identifier),
        country: countryCode.optional(),
      }),
    ),
    /** Not matched in Phase 6. */
    addresses: list(
      z.strictObject({
        country: countryCode.optional(),
        city: text(L.address).optional(),
        postcode: text(L.address).optional(),
        lines: list(text(L.address), 20),
      }),
    ),
    /** Kept raw; canonicalised at ingestion by the C79.3 table, the ticker as metadata. */
    crypto_addresses: list(
      z.strictObject({ raw: text(L.cryptoAddress), ticker: text(L.label) }),
      L.cryptoAddresses,
    ),
    programs: list(text(L.label), 100),
    listed_at: partialDate.optional(),
    /** PEP only (C80.2). */
    positions: list(watchlistPositionSchema),
    /** PEP family links only (C80.3): the linked PEP's entry id. */
    relations: list(
      z.strictObject({ relation: z.enum(RELATION_KINDS), entity_id: text(L.entryId) }),
      200,
    ),
    /** Neither hash reads them (C77.3). */
    remarks: text(L.remarks).optional(),
    /**
     * Owner decision 9 after 6B: the entry's OFAC lists other than the SDN List. Absent, never
     * empty, when it has none, so a record without it keeps both hashes.
     */
    list_memberships: z.array(watchlistListMembershipSchema).min(1).max(100).optional(),
    /**
     * Owner decision 9 after 6B: on a PEP relative (a record with `relations`), the class of the
     * PEP it relates to, derived by the PEP build on each pass; the most senior when several.
     */
    relative_of_class: z.int().min(1).max(4).optional(),
  })
  .refine((record) => record.relative_of_class === undefined || record.relations.length > 0, {
    message: 'a relative’s class needs the family link it came from',
    path: ['relative_of_class'],
  });
export type WatchlistRecord = z.infer<typeof watchlistRecordSchema>;

/** A manifest source id (C76.1). */
const sourceId = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(64);

/**
 * C77.5: the normalised JSON import format, `{ source, published_at, entries }`, accepted for the
 * sandbox sources, or with `--allow-normalised` (C76.2, P08). Entry ids are unique.
 */
export const watchlistImportSchema = z
  .strictObject({
    source: sourceId,
    published_at: z.iso.datetime(),
    entries: z.array(watchlistRecordSchema),
  })
  .refine(
    (file) => new Set(file.entries.map((entry) => entry.entry_id)).size === file.entries.length,
    { message: 'an entry id occurs twice', path: ['entries'] },
  );
export type WatchlistImport = z.infer<typeof watchlistImportSchema>;
