import { describe, expect, it } from 'vitest';
import {
  MAX_INQUIRY_FIELDS,
  MAX_INQUIRY_NOTE_LENGTH,
  buildInquiryResource,
  updateInquiryBodySchema,
  createInquiryBodySchema,
  getInquiryQuerySchema,
  inquiryDocumentSchema,
  inquiryFieldsSchema,
  inquiryListDocumentSchema,
  inquiryResourceSchema,
  inquirySessionMetaSchema,
  listInquiriesQuerySchema,
  referenceIdSchema,
  resumeInquiryDocumentSchema,
} from './inquiries.js';
import { AT, AT_ISO, IDS, LATER, LATER_ISO, LATEST, LATEST_ISO } from './test-support.js';

const inquiry = {
  type: 'inquiry',
  id: IDS.inquiry,
  attributes: {
    status: 'pending',
    'reference-id': 'ref-test-001',
    fields: { name_first: 'Jane', name_last: 'Sample', newsletter: false, score: 3 },
    'created-at': AT_ISO,
    'updated-at': LATER_ISO,
  },
  relationships: {
    'inquiry-template': { data: { type: 'inquiry-template', id: IDS.template } },
    verifications: {
      data: [
        { type: 'verification/government-id', id: IDS.governmentId },
        { type: 'verification/selfie', id: IDS.selfie },
      ],
    },
  },
};

const sessionToken = `ovs_${'A'.repeat(43)}`;

describe('inquiry resource (C2)', () => {
  it('carries status, reference id, fields, timestamps and relationships', () => {
    expect(inquiryResourceSchema.parse(inquiry)).toEqual(inquiry);
  });

  it('allows a null reference id and empty fields', () => {
    const value = {
      ...inquiry,
      attributes: { ...inquiry.attributes, 'reference-id': null, fields: {} },
    };
    expect(inquiryResourceSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['an unknown status', { status: 'done' }],
    ['camelCase attribute names', { referenceId: 'ref-test-001' }],
    ['a local timestamp', { 'created-at': '2026-10-20T14:00:00+02:00' }],
  ])('rejects %s', (_name, change) => {
    const value = { ...inquiry, attributes: { ...inquiry.attributes, ...change } };
    expect(inquiryResourceSchema.safeParse(value).success).toBe(false);
  });

  it('is built from an inquiry record', () => {
    expect(
      buildInquiryResource({
        id: IDS.inquiry,
        status: 'pending',
        referenceId: 'ref-test-001',
        fields: { name_first: 'Jane', name_last: 'Sample', newsletter: false, score: 3 },
        inquiryTemplateId: IDS.template,
        verifications: [
          { id: IDS.governmentId, type: 'government_id' },
          { id: IDS.selfie, type: 'selfie' },
        ],
        createdAt: AT,
        updatedAt: LATER,
      }),
    ).toEqual(inquiry);
  });

  it('refuses to build an invalid resource', () => {
    expect(() =>
      buildInquiryResource({
        id: 'inq_bad',
        status: 'created',
        referenceId: null,
        fields: {},
        inquiryTemplateId: IDS.template,
        verifications: [],
        createdAt: AT,
        updatedAt: AT,
      }),
    ).toThrow();
  });
});

describe('inquiry fields', () => {
  it('use snake_case names and scalar values', () => {
    expect(inquiryFieldsSchema.safeParse({ name_first: 'Jane', birthdate: null }).success).toBe(
      true,
    );
    expect(inquiryFieldsSchema.safeParse({ 'name-first': 'Jane' }).success).toBe(false);
    expect(inquiryFieldsSchema.safeParse({ address: { city: 'Springfield' } }).success).toBe(false);
    expect(inquiryFieldsSchema.safeParse({ tags: ['a'] }).success).toBe(false);
  });

  it('are bounded', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_INQUIRY_FIELDS + 1 }, (_, index) => [`field_${String(index)}`, 'x']),
    );
    // C149.2 (Workflow 9A): the public 1,000, a C10 amendment.
    expect(MAX_INQUIRY_FIELDS).toBe(1000);
    expect(inquiryFieldsSchema.safeParse(many).success).toBe(false);
    expect(inquiryFieldsSchema.safeParse({ note: 'x'.repeat(10_001) }).success).toBe(false);
  });
});

describe('reference id', () => {
  it('is 1 to 255 characters without control characters', () => {
    expect(referenceIdSchema.safeParse('ref-test-001').success).toBe(true);
    expect(referenceIdSchema.safeParse('').success).toBe(false);
    expect(referenceIdSchema.safeParse('x'.repeat(256)).success).toBe(false);
    expect(referenceIdSchema.safeParse('ref\n001').success).toBe(false);
  });
});

describe('inquiry documents', () => {
  it('optionally include the verifications', () => {
    expect(inquiryDocumentSchema.safeParse({ data: inquiry }).success).toBe(true);
    expect(inquiryDocumentSchema.safeParse({ data: inquiry, included: [] }).success).toBe(true);
    expect(inquiryDocumentSchema.safeParse({ data: inquiry, included: [inquiry] }).success).toBe(
      false,
    );
  });

  it('list inquiries with a cursor link', () => {
    const document = {
      data: [inquiry],
      links: { next: `/api/v1/inquiries?page[after]=${IDS.inquiry}` },
    };
    expect(inquiryListDocumentSchema.parse(document)).toEqual(document);
  });
});

describe('POST /api/v1/inquiries body', () => {
  it('needs the template id and may carry a reference id and fields', () => {
    const body = {
      data: {
        attributes: {
          'inquiry-template-id': IDS.template,
          'reference-id': 'ref-test-001',
          fields: { name_first: 'Jane' },
        },
      },
    };
    expect(createInquiryBodySchema.parse(body)).toEqual(body);
    expect(createInquiryBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(false);
    expect(
      createInquiryBodySchema.safeParse({
        data: { attributes: { 'inquiry-template-id': IDS.template, status: 'completed' } },
      }).success,
    ).toBe(false);
  });
});

describe('inquiry queries', () => {
  it('filter and paginate the list', () => {
    expect(
      listInquiriesQuerySchema.parse({
        'page[after]': IDS.inquiry,
        'page[size]': '50',
        'filter[status]': 'completed',
        'filter[reference-id]': 'ref-test-001',
      }),
    ).toEqual({
      'page[after]': IDS.inquiry,
      'page[size]': 50,
      'filter[status]': 'completed',
      'filter[reference-id]': 'ref-test-001',
    });
    expect(listInquiriesQuerySchema.parse({})).toEqual({});
    expect(listInquiriesQuerySchema.safeParse({ 'page[size]': '101' }).success).toBe(false);
    expect(listInquiriesQuerySchema.safeParse({ 'filter[stauts]': 'completed' }).success).toBe(
      false,
    );
  });

  it('include verifications on request', () => {
    expect(getInquiryQuerySchema.parse({ include: 'verifications' })).toEqual({
      include: 'verifications',
    });
    expect(getInquiryQuerySchema.safeParse({ include: 'files' }).success).toBe(false);
  });
});

describe('POST /api/v1/inquiries/:id/resume response', () => {
  const meta = {
    'session-token': sessionToken,
    'flow-url': `https://flow.example.test/#inquiry-id=${IDS.inquiry}&session-token=${sessionToken}`,
  };

  it('returns the inquiry plus the session token and flow URL', () => {
    expect(resumeInquiryDocumentSchema.parse({ data: inquiry, meta })).toEqual({
      data: inquiry,
      meta,
    });
  });

  it('links the flow URL to the same inquiry', () => {
    const other = { ...inquiry, id: 'inq_01M5CJXPC8E4YKE16V0J2K445S' };
    const result = resumeInquiryDocumentSchema.safeParse({ data: other, meta });
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['meta.flow-url']);
  });

  it('keeps the token out of the query string and in the matching fragment', () => {
    expect(inquirySessionMetaSchema.safeParse(meta).success).toBe(true);
    expect(
      inquirySessionMetaSchema.safeParse({
        ...meta,
        'flow-url': `https://flow.example.test/?inquiry-id=${IDS.inquiry}&session-token=${sessionToken}`,
      }).success,
    ).toBe(false);
    expect(
      inquirySessionMetaSchema.safeParse({
        ...meta,
        'flow-url': `https://flow.example.test/#inquiry-id=${IDS.inquiry}&session-token=ovs_${'B'.repeat(43)}`,
      }).success,
    ).toBe(false);
    expect(
      inquirySessionMetaSchema.safeParse({ ...meta, 'session-token': 'ovs_short' }).success,
    ).toBe(false);
  });
});

describe('Phase 2 inquiry attributes (C10, C13)', () => {
  const phase2 = {
    ...inquiry,
    attributes: {
      ...inquiry.attributes,
      status: 'approved',
      tags: ['vip', 'Tier:Gold'],
      note: 'Synthetic reviewer note',
      'expires-at': LATEST_ISO,
      'redacted-at': null,
      'decisioned-at': LATER_ISO,
    },
    relationships: {
      ...inquiry.relationships,
      account: { data: { type: 'account', id: IDS.account } },
    },
  };

  it('adds tags, note, expiry, redaction and decision times and the account', () => {
    expect(inquiryResourceSchema.parse(phase2)).toEqual(phase2);
  });

  it('allows a masked or empty note, and an inquiry without an account yet', () => {
    const value = {
      ...phase2,
      attributes: { ...phase2.attributes, note: null },
      relationships: { ...phase2.relationships, account: { data: null } },
    };
    expect(inquiryResourceSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['tags that repeat ignoring case', { tags: ['vip', 'VIP'] }],
    ['an untrimmed tag', { tags: [' vip'] }],
    ['a note over 2,000 characters', { note: 'x'.repeat(2001) }],
    ['a local expiry time', { 'expires-at': '2026-10-21T14:00:00+02:00' }],
  ])('rejects %s', (_name, change) => {
    const value = { ...phase2, attributes: { ...phase2.attributes, ...change } };
    expect(inquiryResourceSchema.safeParse(value).success).toBe(false);
  });

  it('rejects an account linkage to another resource type', () => {
    const value = {
      ...phase2,
      relationships: {
        ...phase2.relationships,
        account: { data: { type: 'account-type', id: IDS.accountType } },
      },
    };
    expect(inquiryResourceSchema.safeParse(value).success).toBe(false);
  });

  it('is built from a record that carries them', () => {
    expect(
      buildInquiryResource({
        id: IDS.inquiry,
        status: 'approved',
        referenceId: 'ref-test-001',
        fields: { name_first: 'Jane', name_last: 'Sample', newsletter: false, score: 3 },
        inquiryTemplateId: IDS.template,
        verifications: [
          { id: IDS.governmentId, type: 'government_id' },
          { id: IDS.selfie, type: 'selfie' },
        ],
        createdAt: AT,
        updatedAt: LATER,
        tags: ['vip', 'Tier:Gold'],
        note: 'Synthetic reviewer note',
        expiresAt: LATEST,
        redactedAt: null,
        decisionedAt: LATER,
        accountId: IDS.account,
      }),
    ).toEqual(phase2);
  });

  it('builds null times and a missing account as null', () => {
    const built = buildInquiryResource({
      id: IDS.inquiry,
      status: 'created',
      referenceId: null,
      fields: {},
      inquiryTemplateId: IDS.template,
      verifications: [],
      createdAt: AT,
      updatedAt: AT,
      expiresAt: null,
      redactedAt: AT,
      decisionedAt: null,
      accountId: null,
    });
    expect(built.attributes).toMatchObject({
      'expires-at': null,
      'redacted-at': AT_ISO,
      'decisioned-at': null,
    });
    expect(built.relationships.account).toEqual({ data: null });
  });

  it('caps the note at 2,000 characters', () => {
    expect(MAX_INQUIRY_NOTE_LENGTH).toBe(2000);
  });
});

describe('the pinned template version (C25.4, Workflow 2E)', () => {
  const pinned = {
    ...inquiry,
    relationships: {
      ...inquiry.relationships,
      'inquiry-template-version': {
        data: { type: 'inquiry-template-version', id: IDS.templateVersion },
      },
    },
  };

  it('is an optional relationship, so earlier answers still parse', () => {
    expect(inquiryResourceSchema.parse(pinned)).toEqual(pinned);
    expect(inquiryResourceSchema.parse(inquiry)).toEqual(inquiry);
  });

  it('links an inquiry-template-version id only', () => {
    const wrong = {
      ...pinned,
      relationships: {
        ...pinned.relationships,
        'inquiry-template-version': { data: { type: 'inquiry-template', id: IDS.template } },
      },
    };
    expect(inquiryResourceSchema.safeParse(wrong).success).toBe(false);
  });

  it('is built from a record that names the version', () => {
    expect(
      buildInquiryResource({
        id: IDS.inquiry,
        status: 'pending',
        referenceId: 'ref-test-001',
        fields: { name_first: 'Jane', name_last: 'Sample', newsletter: false, score: 3 },
        inquiryTemplateId: IDS.template,
        inquiryTemplateVersionId: IDS.templateVersion,
        verifications: [
          { id: IDS.governmentId, type: 'government_id' },
          { id: IDS.selfie, type: 'selfie' },
        ],
        createdAt: AT,
        updatedAt: LATER,
      }),
    ).toEqual(pinned);
  });
});

describe('POST /api/v1/inquiries with an account (C13)', () => {
  it('accepts an account id', () => {
    const body = {
      data: { attributes: { 'inquiry-template-id': IDS.template, 'account-id': IDS.account } },
    };
    expect(createInquiryBodySchema.parse(body)).toEqual(body);
    expect(
      createInquiryBodySchema.safeParse({
        data: { attributes: { 'inquiry-template-id': IDS.template, 'account-id': IDS.inquiry } },
      }).success,
    ).toBe(false);
  });
});

describe('PATCH /api/v1/inquiries/:id body (C10)', () => {
  it('changes fields, the reference id or the note', () => {
    const body = {
      data: {
        attributes: { fields: { name_first: 'Janet' }, 'reference-id': null, note: 'Checked' },
      },
    };
    expect(updateInquiryBodySchema.parse(body)).toEqual(body);
    expect(
      updateInquiryBodySchema.safeParse({ data: { attributes: { note: null } } }).success,
    ).toBe(true);
  });

  it.each([
    ['nothing', {}],
    ['a status', { status: 'approved' }],
    ['tags', { tags: ['vip'] }],
    ['an overlong note', { note: 'x'.repeat(2001) }],
  ])('rejects %s', (_name, attributes) => {
    expect(updateInquiryBodySchema.safeParse({ data: { attributes } }).success).toBe(false);
  });
});

describe('Phase 2 inquiry list filters (C9, C10)', () => {
  it('filter by account, template, tag, status lists and creation time', () => {
    const query = {
      'filter[status]': 'completed,failed',
      'filter[account-id]': `${IDS.account},${IDS.otherAccount}`,
      'filter[inquiry-template-id]': IDS.template,
      'filter[tag]': 'vip,Tier:Gold',
      'filter[created-at-start]': '2026-10-01T00:00:00Z',
      'filter[created-at-end]': '2026-11-01T00:00:00Z',
    };
    expect(listInquiriesQuerySchema.parse(query)).toEqual(query);
  });

  it.each([
    ['an unknown status in a list', { 'filter[status]': 'completed,done' }],
    ['an account id of another kind', { 'filter[account-id]': IDS.inquiry }],
    ['an invalid tag', { 'filter[tag]': 'vip!' }],
    [
      'a range that ends before it starts',
      {
        'filter[created-at-start]': '2026-11-01T00:00:00Z',
        'filter[created-at-end]': '2026-10-01T00:00:00Z',
      },
    ],
  ])('reject %s', (_name, query) => {
    expect(listInquiriesQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('GET /api/v1/inquiries/:id?include=reports (C70.5, F08)', () => {
  it('names the include and carries reports in included', async () => {
    const { INQUIRY_INCLUDES, inquiryIncludeDocumentSchema } = await import('./inquiries.js');
    const { readFixture } = await import('./test-support.js');
    expect(INQUIRY_INCLUDES).toEqual([
      'verifications',
      'selfies',
      'reports',
      'list-matches',
      'decisions',
    ]);
    const inquiry = (readFixture('api/inquiry.json') as { data: unknown }).data;
    const report = (readFixture('api/report-watchlist.json') as { data: unknown }).data;
    expect(
      inquiryIncludeDocumentSchema.safeParse({ data: inquiry, included: [report] }).success,
    ).toBe(true);
  });
});
