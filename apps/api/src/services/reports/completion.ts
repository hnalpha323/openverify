/**
 * C84.2 (V08, F04, H04): reports on inquiry completion, an outbox. `transitionInquiryInTx`
 * (`services/inquiries.ts`) calls {@link createInquiryReportsInTx} when an inquiry moves
 * `pending -> completed`, or `failed -> approved | needs_review`, inside the transition's
 * transaction, which already holds the inquiry row. The hook reads the version's pinned
 * `report-config` and, for each entry, builds the query from the verified data first and creates
 * the report (`pending`, `origin: inquiry_completion`, linked to the inquiry only) with its
 * `initial` run, from the report template's published version at that moment (an archived
 * template still runs, C71.1). An inquiry redacted before the move committed gets none (the
 * transition's row shows the redaction it waited for). It takes no account lock and enqueues
 * nothing: the initial run links the account under the C73.7 order and applies the recurring
 * caps (C72.5), and the report sweep enqueues the run within 15 s.
 *
 * **Query sources** (H04): each field comes from the first source that has it, and `query-sources`
 * records which:
 * - person types: the extraction of the latest government ID verification decided `passed` or
 *   `needs_review`, the inquiry's `fields`, the account's `fields`; every other name that differs
 *   is screened too, as `additional-names` (at most 3), so a prefilled name never replaces the
 *   verified one;
 * - `email-address` and `phone-number`: the destination of the latest passed OTP verification
 *   whose code was confirmed, then the inquiry's and the account's `fields`;
 * - `crypto-address-watchlist`: the latest passed crypto wallet verification's address and chain,
 *   then the inquiry's expected address and the account's `fields`;
 * - the business types: the latest passed business registry verification's legal name,
 *   registration number and LEI, then its entered business name, then the inquiry's `fields`;
 * - `address-lookup`: the inquiry's `fields`, the government ID extraction, the account's
 *   `fields`.
 *
 * A value the type's query schema refuses is left out. A query left without a required input
 * still creates the report; its initial run ends `errored` with `insufficient_input` (C84.2).
 * Nothing here logs: the values reach only the sealed query.
 */
import {
  newId,
  REPORT_QUERY_LIMITS,
  resolveReportConfig,
  resolveReportTemplateConfig,
  SERVED_REPORT_QUERY_SCHEMAS,
  type ReportQuerySource,
} from '@openverify/contracts';
import type { InquiryStatus, ReportType } from '@openverify/core';
import {
  createReport,
  firstInquiryNetwork,
  getAccount,
  getInquiryTemplateVersion,
  getPublishedReportTemplateVersion,
  getReportTemplate,
  listGovernmentIdExtractions,
  listInquiryVerifications,
  type Db,
  type Inquiry,
  type VerificationWithChecks,
} from '@openverify/db';
import { z } from 'zod';
import { loadVerificationAttributes } from '../attributes/index.js';
import { expectedCryptoAddressOf } from '../crypto-challenges/rules.js';
import { readListSubject, type ListSubject } from '../lists/subject.js';
import type { ReportHookDeps } from './hooks.js';

export interface InquiryCompletion {
  /** The inquiry after the move, as `transitionInquiryStatus` returned it. */
  inquiry: Inquiry;
  from: InquiryStatus;
  to: InquiryStatus;
}

/** The reports created; ids only. */
export interface CompletionReports {
  reportIds: readonly string[];
}

export type CreateInquiryReportsInTx = (
  tx: Db,
  deps: ReportHookDeps,
  completion: InquiryCompletion,
) => Promise<CompletionReports>;

/** C84.2: the moves that run an inquiry's report list: completion, and a failed inquiry overridden. */
export function runsCompletionReports(from: InquiryStatus, to: InquiryStatus): boolean {
  return (
    (from === 'pending' && to === 'completed') ||
    (from === 'failed' && (to === 'approved' || to === 'needs_review'))
  );
}

type Values = Readonly<Record<string, unknown>>;

/** What the inquiry and its account hold, read once per completion. */
interface CompletionData {
  governmentId: Values | null;
  inquiryFields: Values;
  accountFields: Values;
  email: string | null;
  phone: string | null;
  wallet: { address: string; chainId: string | null } | null;
  business: {
    legalName: string | null;
    registrationNumber: string | null;
    lei: string | null;
    enteredName: string | null;
  } | null;
  /** C106.1 (Workflow 7A): the first evaluated session's address, opened from its network row. */
  sessionAddress: string | null;
  /** C106.2 (Workflow 7B): what a list reads of the inquiry (C99.5). */
  listSubject: ListSubject;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const asValues = (value: unknown): Values =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Values) : {};

/** The latest verification of `type` whose status is one of `statuses`. */
function latest(
  verifications: readonly VerificationWithChecks[],
  type: VerificationWithChecks['type'],
  statuses: readonly string[],
): VerificationWithChecks | undefined {
  return verifications.filter((v) => v.type === type && statuses.includes(v.status)).at(-1);
}

async function attributesOf(
  tx: Db,
  verification: VerificationWithChecks | undefined,
): Promise<Values | null> {
  return verification === undefined
    ? null
    : ((await loadVerificationAttributes(tx, verification)) ?? null);
}

/** The confirmed OTP destination of the latest passed verification of `type`, if any. */
async function confirmedDestination(
  tx: Db,
  verifications: readonly VerificationWithChecks[],
  type: 'email_address' | 'phone_number',
  member: 'email-address' | 'phone-number',
): Promise<string | null> {
  const attributes = await attributesOf(tx, latest(verifications, type, ['passed']));
  return attributes?.['confirmed-at'] == null ? null : text(attributes[member]);
}

async function completionData(tx: Db, inquiry: Inquiry): Promise<CompletionData> {
  const { environmentId } = inquiry;
  const verifications = await listInquiryVerifications(tx, environmentId, inquiry.id);
  const governmentId = latest(verifications, 'government_id', ['passed', 'needs_review']);
  const extraction =
    governmentId === undefined
      ? undefined
      : (await listGovernmentIdExtractions(tx, environmentId, [governmentId.id])).get(
          governmentId.id,
        );
  // A plain read: the completion holds the inquiry row and takes no account lock (F04).
  const account = await getAccount(tx, environmentId, inquiry.accountId);
  const wallet = await attributesOf(tx, latest(verifications, 'crypto_wallet', ['passed']));
  const business = await attributesOf(tx, latest(verifications, 'database_business', ['passed']));
  const walletAddress = text(wallet?.['wallet-address']);
  return {
    governmentId: extraction?.fields ?? null,
    inquiryFields: asValues(inquiry.fields),
    accountFields: asValues(account?.fields),
    email: await confirmedDestination(tx, verifications, 'email_address', 'email-address'),
    phone: await confirmedDestination(tx, verifications, 'phone_number', 'phone-number'),
    wallet:
      walletAddress === null
        ? null
        : { address: walletAddress, chainId: text(wallet?.['chain-id']) },
    business:
      business === null
        ? null
        : {
            legalName: text(business['registry-legal-name']),
            registrationNumber: text(business['registration-number']),
            lei: text(business.lei),
            enteredName: text(business['business-name']),
          },
    sessionAddress: (await firstInquiryNetwork(tx, environmentId, inquiry.id))?.ip ?? null,
    listSubject: await readListSubject(tx, inquiry),
  };
}

/** A query being built: each member from the first source that has a value the schema takes. */
class QueryBuilder {
  readonly query: Record<string, unknown> = {};
  readonly sources: Record<string, ReportQuerySource> = {};
  private readonly shape: Readonly<Record<string, z.ZodType>>;

  constructor(type: ReportType) {
    this.shape = (SERVED_REPORT_QUERY_SCHEMAS[type] as unknown as z.ZodObject).shape;
  }

  /** Sets `member` from the first candidate whose value the schema takes. */
  take(member: string, candidates: readonly [ReportQuerySource, unknown][]): void {
    if (member in this.query) {
      return;
    }
    for (const [source, value] of candidates) {
      if (value === null || value === undefined || value === '') {
        continue;
      }
      const schema = this.shape[member];
      if (schema?.safeParse(value).success === true) {
        this.query[member] = value;
        this.sources[member] = source;
        return;
      }
    }
  }
}

interface PersonName {
  source: ReportQuerySource;
  first: string | null;
  middle: string | null;
  last: string | null;
}

const personNameOf = (source: ReportQuerySource, values: Values, snake: boolean): PersonName => ({
  source,
  first: text(values[snake ? 'name_first' : 'name-first']),
  middle: text(values[snake ? 'name_middle' : 'name-middle']),
  last: text(values[snake ? 'name_last' : 'name-last']),
});

const nameKey = (name: PersonName) =>
  [name.first, name.middle, name.last]
    .filter((part): part is string => part !== null)
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase('en');

/** The person types (C84.2): the verified name first, every other name as an additional name. */
function personQuery(type: ReportType, data: CompletionData, country: string): QueryBuilder {
  const built = new QueryBuilder(type);
  const id = data.governmentId ?? {};
  const names = [
    personNameOf('government_id', id, false),
    personNameOf('inquiry_fields', data.inquiryFields, true),
    personNameOf('account_fields', data.accountFields, true),
  ].filter((name) => name.first !== null || name.last !== null);
  const distinct: PersonName[] = [];
  for (const name of names) {
    if (!distinct.some((seen) => nameKey(seen) === nameKey(name))) {
      distinct.push(name);
    }
  }
  const [primary, ...others] = distinct;
  if (primary !== undefined) {
    built.take('name-first', [[primary.source, primary.first]]);
    built.take('name-middle', [[primary.source, primary.middle]]);
    built.take('name-last', [[primary.source, primary.last]]);
  }
  const additional = others.slice(0, REPORT_QUERY_LIMITS.additionalNames).map((name) => {
    const parts: [string, string | null][] = [
      ['name-first', name.first],
      ['name-middle', name.middle],
      ['name-last', name.last],
    ];
    return Object.fromEntries(parts.filter(([, value]) => value !== null));
  });
  const firstOther = others[0];
  if (firstOther !== undefined) {
    built.take('additional-names', [[firstOther.source, additional]]);
  }
  built.take('birthdate', [
    ['government_id', id.birthdate],
    ['inquiry_fields', data.inquiryFields.birthdate],
    ['account_fields', data.accountFields.birthdate],
  ]);
  built.take(country, [
    ['government_id', id['address-country-code']],
    ['inquiry_fields', data.inquiryFields.address_country_code],
    ['account_fields', data.accountFields.address_country_code],
  ]);
  return built;
}

/** The address members, in the `address-lookup` query's names. */
const ADDRESS_MEMBERS = [
  'address-street-1',
  'address-street-2',
  'address-city',
  'address-subdivision',
  'address-postal-code',
  'address-country-code',
] as const;

/**
 * C106.2 (Workflow 7B, `api-lists`): the query sources of C99.5, the values the screening reads, a
 * rejected handoff's left out. A name comes whole from one source. Its `list-ids` are the
 * template's: without them, or with nothing to screen, the run ends `errored` with
 * `insufficient_input`, never read as screened.
 */
function customListQuery(data: CompletionData): QueryBuilder {
  const built = new QueryBuilder('custom-list');
  const { governmentId, inquiryFields, accountFields, email, phone, databaseNumber } =
    data.listSubject;
  const named = governmentId?.nameFirst != null || governmentId?.nameLast != null;
  const nameSource: ReportQuerySource = named ? 'government_id' : 'inquiry_fields';
  built.take('name-first', [
    [nameSource, named ? governmentId.nameFirst : inquiryFields.name_first],
  ]);
  built.take('name-last', [[nameSource, named ? governmentId.nameLast : inquiryFields.name_last]]);
  built.take('email-address', [
    ['otp_confirmed', email],
    ['inquiry_fields', inquiryFields.email_address],
    ['account_fields', accountFields.email_address],
  ]);
  built.take('phone-number', [
    ['otp_confirmed', phone],
    ['inquiry_fields', inquiryFields.phone_number],
    ['account_fields', accountFields.phone_number],
  ]);
  built.take('government-id-number', [
    ['government_id', governmentId?.number],
    ['government_id', databaseNumber],
  ]);
  if (built.query['government-id-number'] === governmentId?.number) {
    built.take('government-id-class', [['government_id', governmentId?.idClass]]);
  }
  built.take('ip-address', [['inquiry_session', data.sessionAddress]]);
  built.take('country-code', [
    ['government_id_country', governmentId?.country],
    ['inquiry_fields', inquiryFields.address_country_code],
    ['account_fields', accountFields.address_country_code],
  ]);
  return built;
}

/** C84.2: the query of `type` from what the inquiry and its account hold. */
function completionQuery(type: ReportType, data: CompletionData): QueryBuilder {
  const fields = data.inquiryFields;
  const account = data.accountFields;
  switch (type) {
    case 'watchlist':
      return personQuery(type, data, 'address-country-code');
    case 'politically-exposed-person':
    case 'adverse-media':
      return personQuery(type, data, 'country-code');
    case 'email-address': {
      const built = new QueryBuilder(type);
      built.take('email-address', [
        ['otp_confirmed', data.email],
        ['inquiry_fields', fields.email_address],
        ['account_fields', account.email_address],
      ]);
      return built;
    }
    case 'phone-number': {
      const built = new QueryBuilder(type);
      built.take('phone-number', [
        ['otp_confirmed', data.phone],
        ['inquiry_fields', fields.phone_number],
        ['account_fields', account.phone_number],
      ]);
      return built;
    }
    case 'crypto-address-watchlist': {
      const built = new QueryBuilder(type);
      built.take('crypto-address', [
        ['crypto_wallet', data.wallet?.address],
        ['inquiry_fields', expectedCryptoAddressOf(fields)],
        ['account_fields', account.crypto_address],
      ]);
      if (built.sources['crypto-address'] === 'crypto_wallet') {
        built.take('chain-id', [['crypto_wallet', data.wallet?.chainId]]);
      }
      return built;
    }
    case 'business-watchlist':
    case 'business-adverse-media': {
      const built = new QueryBuilder(type);
      const business = data.business;
      built.take('term', [
        ['business_registry', business?.legalName],
        ['business_entered', business?.enteredName],
        ['inquiry_fields', fields.business_name],
      ]);
      if (type === 'business-watchlist') {
        built.take('registration-number', [
          ['business_registry', business?.registrationNumber],
          ['inquiry_fields', fields.registration_number],
        ]);
        built.take('lei', [['business_registry', business?.lei]]);
        built.take('address-country-code', [['inquiry_fields', fields.address_country_code]]);
      } else {
        built.take('country-code', [['inquiry_fields', fields.address_country_code]]);
      }
      return built;
    }
    case 'address-lookup': {
      const built = new QueryBuilder(type);
      const id = data.governmentId ?? {};
      for (const member of ADDRESS_MEMBERS) {
        const snake = member.replaceAll('-', '_');
        built.take(member, [
          ['inquiry_fields', fields[snake]],
          ['government_id', id[member]],
          ['account_fields', account[snake]],
        ]);
      }
      return built;
    }
    case 'ip-address': {
      // C106.1 (Workflow 7A, `api-network`): the first evaluated session's address
      // (`inquiry_session`), as its network row holds it (IPv4-mapped folded). Without one the
      // query is empty and the run ends `errored` with `insufficient_input`, never read as screened.
      const built = new QueryBuilder(type);
      built.take('ip-address', [['inquiry_session', data.sessionAddress]]);
      return built;
    }
    case 'custom-list':
      return customListQuery(data);
  }
}

const DAY = 86_400_000;

export const createInquiryReportsInTx: CreateInquiryReportsInTx = async (tx, deps, completion) => {
  const { inquiry, from, to } = completion;
  if (!runsCompletionReports(from, to)) {
    return { reportIds: [] };
  }
  // C73.7 (owner decision 11): `inquiry` is the row the transition updated and holds, so a
  // redaction that committed while the transition waited for it shows here. A redacted inquiry
  // gets no report: its redaction has run, and no cascade would ever reach a report made now.
  if (inquiry.redactedAt !== null) {
    return { reportIds: [] };
  }
  const { environmentId } = inquiry;
  const version = await getInquiryTemplateVersion(
    tx,
    environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const entries = resolveReportConfig(version?.reportConfig ?? {})['on-completion'];
  if (entries.length === 0) {
    return { reportIds: [] };
  }
  const data = await completionData(tx, inquiry);
  const now = deps.clock.now();
  const reportIds: string[] = [];
  for (const entry of entries) {
    const templateId = entry['report-template-id'];
    const published = await getPublishedReportTemplateVersion(tx, environmentId, templateId);
    const template =
      published === null ? null : await getReportTemplate(tx, environmentId, templateId);
    if (published === null || template === null) {
      continue;
    }
    const type = template.reportType;
    const built = completionQuery(type, data);
    const config = resolveReportTemplateConfig(type, published.config);
    const interval =
      typeof config['recurrence-interval-days'] === 'number'
        ? config['recurrence-interval-days']
        : null;
    const id = newId('rep');
    await createReport(tx, environmentId, {
      id,
      reportType: type,
      reportTemplateId: templateId,
      reportTemplateVersionId: published.id,
      origin: 'inquiry_completion',
      query: built.query,
      querySources: built.sources,
      inquiryId: inquiry.id,
      accountId: null,
      recurrenceIntervalDays: interval,
      nextRunAt: interval === null ? null : new Date(now.getTime() + interval * DAY),
      createdAt: now,
      initialRun: { id: newId('rpr'), scheduledFor: now },
    });
    reportIds.push(id);
  }
  return { reportIds };
};
