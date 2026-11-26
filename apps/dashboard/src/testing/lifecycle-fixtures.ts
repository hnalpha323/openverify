/**
 * Synthetic API documents for the lifecycle pages (inquiries, sessions, events, accounts,
 * account types, templates and versions). No real people and no real identifiers: every ID is
 * a made-up ULID and every value is invented. Each builder parses its result with the contract
 * schema, so a fixture that drifts from the contract fails where it is built.
 */
import {
  accountRelationListDocumentSchema,
  accountResourceSchema,
  accountTypeResourceSchema,
  dashboardInquiryDocumentSchema,
  defaultInquiryTemplateAttributes,
  eventResourceSchema,
  inquiryResourceSchema,
  inquirySessionResourceSchema,
  inquiryTemplateResourceSchema,
  inquiryTemplateVersionResourceSchema,
  verificationResourceSchema,
  type AccountRelation,
  type AccountResource,
  type AccountTypeResource,
  type DashboardInquiryDocument,
  type EventResource,
  type InquiryResource,
  type InquirySessionResource,
  type InquiryTemplateResource,
  type InquiryTemplateVersionResource,
  type VerificationResource,
} from '@openverify/contracts';

type GovernmentIdVerification = Extract<
  VerificationResource,
  { type: 'verification/government-id' }
>;

export const LIFECYCLE_IDS = {
  inquiry: 'inq_01JB0000000000000000000001',
  otherInquiry: 'inq_01JB0000000000000000000002',
  thirdInquiry: 'inq_01JB0000000000000000000003',
  template: 'itmpl_01JB0000000000000000000001',
  version: 'itmplv_01JB0000000000000000000001',
  draft: 'itmplv_01JB0000000000000000000002',
  account: 'acc_01JB0000000000000000000001',
  otherAccount: 'acc_01JB0000000000000000000002',
  thirdAccount: 'acc_01JB0000000000000000000003',
  accountType: 'acctp_01JB0000000000000000000001',
  otherAccountType: 'acctp_01JB0000000000000000000002',
  session: 'iqse_01JB0000000000000000000001',
  endedSession: 'iqse_01JB0000000000000000000002',
  governmentId: 'ver_01JB0000000000000000000001',
  selfie: 'ver_01JB0000000000000000000002',
  front: 'file_01JB0000000000000000000001',
  back: 'file_01JB0000000000000000000002',
  selfieCenter: 'file_01JB0000000000000000000003',
  event: 'evt_01JB0000000000000000000001',
  otherEvent: 'evt_01JB0000000000000000000002',
} as const;

const IDS = LIFECYCLE_IDS;
export const T0 = '2026-10-20T04:35:00.000Z';
export const T1 = '2026-10-20T04:40:00.000Z';
export const T2 = '2026-10-21T04:35:00.000Z';

type InquiryAttributes = InquiryResource['attributes'];

/** A completed inquiry of the account `IDS.account`, as the API sends it since Phase 2. */
export function inquiry(
  attributes: Partial<InquiryAttributes> = {},
  id: string = IDS.inquiry,
  accountId: string | null = IDS.account,
): InquiryResource {
  return inquiryResourceSchema.parse({
    type: 'inquiry',
    id,
    attributes: {
      status: 'completed',
      'reference-id': 'ref-synthetic-001',
      fields: { name_first: 'Synthetic', age: 42 },
      tags: ['vip'],
      note: 'Synthetic note.',
      'expires-at': T2,
      'redacted-at': null,
      'decisioned-at': null,
      'created-at': T0,
      'updated-at': T1,
      ...attributes,
    },
    relationships: {
      'inquiry-template': { data: { type: 'inquiry-template', id: IDS.template } },
      verifications: {
        data: [
          { type: 'verification/government-id', id: IDS.governmentId },
          { type: 'verification/selfie', id: IDS.selfie },
        ],
      },
      account: { data: accountId === null ? null : { type: 'account', id: accountId } },
      // C25.4: the version the inquiry pinned at creation.
      'inquiry-template-version': {
        data: { type: 'inquiry-template-version', id: IDS.version },
      },
    },
  });
}

export function inquiryList(data: InquiryResource[] = [inquiry()], next: string | null = null) {
  return { data, links: { next } };
}

function file(id: string, kind: string, verificationId: string, verificationType: string) {
  return {
    type: 'file',
    id,
    attributes: { kind, 'mime-type': 'image/jpeg', 'byte-size': 2048, 'created-at': T0 },
    relationships: { verification: { data: { type: verificationType, id: verificationId } } },
  };
}

/** The inquiry's government ID verification, passed, as `GET /verifications/:id` has it. */
export function governmentIdVerification(
  attributes: Partial<GovernmentIdVerification['attributes']> = {},
): GovernmentIdVerification {
  const verification = verificationResourceSchema.parse({
    type: 'verification/government-id',
    id: IDS.governmentId,
    attributes: {
      status: 'passed',
      country: 'US',
      'id-class': 'drivers_license',
      checks: [
        {
          name: 'id_blur_detection',
          status: 'passed',
          reasons: [],
          requirement: 'required',
          metadata: { score: 0.9 },
        },
      ],
      'created-at': T0,
      'updated-at': T1,
      ...attributes,
    },
    relationships: {
      inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
      files: {
        data: [
          { type: 'file', id: IDS.front },
          { type: 'file', id: IDS.back },
        ],
      },
    },
  });
  if (verification.type !== 'verification/government-id') {
    throw new Error('Not a government ID verification');
  }
  return verification;
}

/** `GET /dashboard/inquiries/:id`: the inquiry with a government ID (both sides) and a selfie. */
export function inquiryDocument(
  attributes: Partial<InquiryAttributes> = {},
): DashboardInquiryDocument {
  const redacted = (attributes['redacted-at'] ?? null) !== null;
  const check = (name: string, status: string, reasons: string[] = []) => ({
    name,
    status,
    reasons: redacted ? [] : reasons,
    requirement: 'required',
    metadata: redacted ? {} : { score: 0.9 },
  });
  return dashboardInquiryDocumentSchema.parse({
    data: inquiry(attributes),
    included: [
      {
        type: 'verification/government-id',
        id: IDS.governmentId,
        attributes: {
          status: 'passed',
          country: 'US',
          'id-class': 'drivers_license',
          checks: [check('id_blur_detection', 'passed')],
          'created-at': T0,
          'updated-at': T1,
        },
        relationships: {
          inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
          files: {
            data: [
              { type: 'file', id: IDS.front },
              { type: 'file', id: IDS.back },
            ],
          },
        },
      },
      {
        type: 'verification/selfie',
        id: IDS.selfie,
        attributes: {
          status: 'failed',
          checks: [check('selfie_id_comparison', 'failed', ['face_mismatch'])],
          'created-at': T0,
          'updated-at': T1,
        },
        relationships: {
          inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
          files: { data: [{ type: 'file', id: IDS.selfieCenter }] },
        },
      },
      file(IDS.front, 'front', IDS.governmentId, 'verification/government-id'),
      file(IDS.back, 'back', IDS.governmentId, 'verification/government-id'),
      file(IDS.selfieCenter, 'selfie-center', IDS.selfie, 'verification/selfie'),
    ],
  });
}

/** One inquiry session of `IDS.inquiry`. */
export function session(
  attributes: Partial<InquirySessionResource['attributes']> = {},
  id: string = IDS.session,
): InquirySessionResource {
  return inquirySessionResourceSchema.parse({
    type: 'inquiry-session',
    id,
    attributes: {
      status: 'active',
      'created-at': T0,
      'started-at': T1,
      'expires-at': T2,
      'ip-address': '203.0.113.7',
      'user-agent': 'SyntheticBrowser/1.0',
      ...attributes,
    },
    relationships: { inquiry: { data: { type: 'inquiry', id: IDS.inquiry } } },
  });
}

/** An event about `IDS.inquiry`; `inquiry.transitioned` carries `{ from, to }`. */
export function inquiryEvent(
  name: EventResource['attributes']['name'],
  id: string = IDS.event,
  meta?: Record<string, unknown>,
): EventResource {
  return eventResourceSchema.parse({
    type: 'event',
    id,
    attributes: {
      name,
      payload: { data: inquiry(), ...(meta === undefined ? {} : { meta }) },
      simulated: false,
      'created-at': T1,
    },
  });
}

/** An event about the inquiry's government ID verification (C25.7 timeline). */
export function verificationEvent(
  name: Extract<EventResource['attributes']['name'], `verification.${string}`>,
  id: string = IDS.event,
): EventResource {
  return eventResourceSchema.parse({
    type: 'event',
    id,
    attributes: {
      name,
      payload: { data: governmentIdVerification() },
      simulated: false,
      'created-at': T1,
    },
  });
}

/** An event about the inquiry's session (C25.7 timeline). */
export function sessionEvent(
  name: Extract<EventResource['attributes']['name'], `inquiry-session.${string}`>,
  id: string = IDS.event,
): EventResource {
  return eventResourceSchema.parse({
    type: 'event',
    id,
    attributes: { name, payload: { data: session() }, simulated: false, 'created-at': T1 },
  });
}

/** An account of the type `IDS.accountType`. */
export function account(
  attributes: Partial<AccountResource['attributes']> = {},
  id: string = IDS.account,
  inquiryIds: readonly string[] = [IDS.inquiry],
): AccountResource {
  return accountResourceSchema.parse({
    type: 'account',
    id,
    attributes: {
      'reference-id': 'acct-ref-001',
      status: 'active',
      fields: { name_first: 'Synthetic' },
      tags: ['vip'],
      'consolidated-into': null,
      'created-at': T0,
      'updated-at': T1,
      'redacted-at': null,
      ...attributes,
    },
    relationships: {
      'account-type': { data: { type: 'account-type', id: IDS.accountType } },
      inquiries: { data: inquiryIds.map((inquiryId) => ({ type: 'inquiry', id: inquiryId })) },
    },
  });
}

export function accountType(
  name = 'user',
  id: string = IDS.accountType,
  fieldsSchema: AccountTypeResource['attributes']['fields-schema'] = {
    name_first: { type: 'string', label: 'First name' },
  },
): AccountTypeResource {
  return accountTypeResourceSchema.parse({
    type: 'account-type',
    id,
    attributes: { name, 'fields-schema': fieldsSchema, 'created-at': T0, 'contest-route': null },
  });
}

/** `GET /accounts/:id/relations`. */
export function relations(items: Partial<AccountRelation>[] = [{}]) {
  return accountRelationListDocumentSchema.parse({
    data: items.map((item) => ({
      direction: 'outgoing',
      'relation-type': 'spouse',
      'related-account': { type: 'account', id: IDS.otherAccount },
      'created-at': T0,
      ...item,
    })),
  });
}

const defaults = defaultInquiryTemplateAttributes();

/** The default template's flow and verification config, as a version carries them. */
export const VERSION_CONTENT = {
  flow: defaults.flow,
  'verification-config': defaults['verification-config'],
} as const;

export const RESOLVED_SETTINGS = {
  'inquiry-expiration-seconds': 86_400,
  'session-expiration-seconds': 86_400,
  'one-time-link-expiration-seconds': 86_400,
  'retention-days': null,
  // C91.5 (Phase 7): the session cap.
  'max-sessions': 25,
  'expire-inquiry-on-session-limit': false,
} as const;

export function template(
  attributes: Partial<InquiryTemplateResource['attributes']> = {},
): InquiryTemplateResource {
  return inquiryTemplateResourceSchema.parse({
    type: 'inquiry-template',
    id: IDS.template,
    attributes: {
      name: 'Synthetic ID and selfie',
      status: 'active',
      'current-version': {
        id: IDS.version,
        'version-number': 1,
        ...VERSION_CONTENT,
        settings: RESOLVED_SETTINGS,
        'created-at': T0,
      },
      'created-at': T0,
      'updated-at': T1,
      ...attributes,
    },
  });
}

export function version(
  attributes: Partial<InquiryTemplateVersionResource['attributes']> = {},
  id: string = IDS.version,
): InquiryTemplateVersionResource {
  return inquiryTemplateVersionResourceSchema.parse({
    type: 'inquiry-template-version',
    id,
    attributes: {
      'version-number': 1,
      status: 'published',
      ...VERSION_CONTENT,
      settings: RESOLVED_SETTINGS,
      'created-at': T0,
      'published-at': T1,
      ...attributes,
    },
    relationships: { 'inquiry-template': { data: { type: 'inquiry-template', id: IDS.template } } },
  });
}

/** A draft version 2 of `IDS.template`. */
export function draft(
  attributes: Partial<InquiryTemplateVersionResource['attributes']> = {},
): InquiryTemplateVersionResource {
  return version(
    { 'version-number': 2, status: 'draft', 'published-at': null, ...attributes },
    IDS.draft,
  );
}

export function single<Resource>(data: Resource) {
  return { data };
}
