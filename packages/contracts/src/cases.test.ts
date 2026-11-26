import { describe, expect, it } from 'vitest';
import {
  CASE_INCLUDES,
  PII_CASE_ATTRIBUTES,
  addCaseCommentBodySchema,
  addCaseObjectsBodySchema,
  addCaseTagBodySchema,
  buildCaseBulkActionResource,
  buildCaseHistoryEntryResource,
  buildCaseResource,
  caseAttributesSchema,
  caseBulkActionDocumentSchema,
  caseDocumentSchema,
  caseHeldObjectIdSchema,
  caseHeldObjectListDocumentSchema,
  caseHistoryListDocumentSchema,
  caseIncludeDocumentSchema,
  caseNameSchema,
  caseResourceSchema,
  caseSearchBodySchema,
  caseSearchDocumentSchema,
  createCaseBodySchema,
  createCaseBulkActionBodySchema,
  createInquiryReviewRequestBodySchema,
  assignCaseBodySchema,
  getCaseQuerySchema,
  listCaseHeldObjectsQuerySchema,
  listCaseHistoryQuerySchema,
  listCasesQuerySchema,
  nextCaseBodySchema,
  nextCaseDocumentSchema,
  printCaseBodySchema,
  removeCaseObjectsBodySchema,
  removeCaseTagBodySchema,
  setCaseStatusBodySchema,
  setCaseTagsBodySchema,
  updateCaseBodySchema,
  type CaseRecord,
} from './cases.js';
import { newId } from './ids.js';
import { readFixture } from './test-support.js';

const CASE = 'case_01M5CN00000000000000000001';
const OTHER_CASE = 'case_01M5CN00000000000000000017';
const TEMPLATE = 'ctmpl_01M5CN00000000000000000002';
const VERSION = 'ctmplv_01M5CN00000000000000000003';
const QUEUE = 'cqueue_01M5CN00000000000000000005';
const POLICY = 'cap_01M5CN00000000000000000006';
const COMMENT = 'cscm_01M5CN00000000000000000008';
const RUN = 'wfr_01M5CM00000000000000000003';
const REVIEWER = 'usr_01M5CN00000000000000000011';
const ACCOUNT = 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8';
const INQUIRY = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const REPORT = 'rep_01M5CN00000000000000000013';
const AT = new Date('2026-10-20T12:00:00.000Z');
const LATER = new Date('2026-10-20T12:05:00.000Z');
const RESOLVED = new Date('2026-10-21T09:30:00.000Z');

const golden = caseDocumentSchema.parse(readFixture('api/case.json'));

const record: CaseRecord = {
  id: CASE,
  name: 'KYC-6',
  status: 'open',
  statusCategory: 'initial',
  resolution: null,
  caseTemplateId: TEMPLATE,
  caseTemplateVersionId: VERSION,
  caseQueueId: QUEUE,
  creatorType: 'workflow-run',
  creatorId: RUN,
  assigneeId: REVIEWER,
  assignerType: 'case-assignment-policy',
  assignerId: POLICY,
  resolverType: null,
  resolverId: null,
  updaterType: null,
  updaterId: null,
  tags: ['manual-review'],
  fields: golden.data.attributes.fields,
  lockVersion: 2,
  heldObjectCounts: golden.data.attributes['held-object-counts'],
  commentIds: [COMMENT],
  accounts: [{ type: 'account', id: ACCOUNT }],
  inquiries: [{ type: 'inquiry', id: INQUIRY }],
  reports: [{ type: 'report/watchlist', id: REPORT }],
  verifications: [],
  transactions: [],
  reportRunIds: [],
  graphQueryIds: [],
  slaExpiresAt: RESOLVED,
  slaState: 'running',
  attachments: [
    {
      id: 'catt_01M5CN00000000000000000019',
      caseId: CASE,
      filename: 'synthetic-statement.pdf',
      byteSize: 48213,
      attachmentType: 'pdf',
      scanStatus: 'clean',
      scanProvider: 'sandbox',
      scannedAt: LATER,
      renditionStatus: 'ready',
      pageCount: 2,
      createdAt: AT,
    },
  ],
  assignedAt: LATER,
  resolvedAt: null,
  redactedAt: null,
  createdAt: AT,
  updatedAt: LATER,
};

const attributesWith = (changes: Record<string, unknown>) => ({
  ...golden.data.attributes,
  ...changes,
});
const fits = (changes: Record<string, unknown>) =>
  caseAttributesSchema.safeParse(attributesWith(changes)).success;

describe('the case resource (C129.2)', () => {
  it('builds the golden case', () => {
    expect(buildCaseResource(record)).toEqual(golden.data);
  });

  it('reads no SLA from a record that holds none', () => {
    const { slaExpiresAt, slaState, ...rest } = record;
    expect([slaExpiresAt, slaState]).toEqual([RESOLVED, 'running']);
    expect(buildCaseResource(rest).attributes).toMatchObject({
      'sla-expires-at': null,
      'sla-state': 'none',
    });
  });

  it('holds a name as the template key and a counter', () => {
    expect(caseNameSchema.safeParse('KYC-6').success).toBe(true);
    expect(caseNameSchema.safeParse('A1-120').success).toBe(true);
    expect(caseNameSchema.safeParse('KYC-0').success).toBe(false);
    expect(caseNameSchema.safeParse('kyc-6').success).toBe(false);
    expect(caseNameSchema.safeParse('KYC').success).toBe(false);
  });

  it('names actors by id, never by an email address (decision 64)', () => {
    expect(fits({ 'creator-type': 'user', 'creator-id': REVIEWER })).toBe(true);
    expect(fits({ 'creator-type': 'user', 'creator-id': 'reviewer@example.com' })).toBe(false);
    expect(fits({ 'creator-type': 'user', 'creator-id': RUN })).toBe(false);
    expect(fits({ 'assignee-id': 'reviewer@example.com' })).toBe(false);
    expect(fits({ 'assigner-type': 'user', 'assigner-id': REVIEWER })).toBe(true);
    expect(fits({ 'assigner-type': 'case-assignment-policy', 'assigner-id': REVIEWER })).toBe(
      false,
    );
    expect(fits({ 'resolver-type': 'api-key', 'resolver-id': REVIEWER })).toBe(false);
    expect(fits({ 'updater-type': 'workflow-run', 'updater-id': RUN })).toBe(true);
  });

  it('holds an actor whole: a type with no id, or an id with no type, is refused', () => {
    expect(fits({ 'assigner-type': null, 'assigner-id': null })).toBe(true);
    expect(fits({ 'assigner-type': 'user', 'assigner-id': null })).toBe(false);
    expect(fits({ 'assigner-type': null, 'assigner-id': REVIEWER })).toBe(false);
  });

  it('refuses an actor type outside its list', () => {
    expect(fits({ 'resolver-type': 'system', 'resolver-id': RUN })).toBe(false);
  });

  it('takes fields null, for a redacted case, an event and a masked reader', () => {
    expect(fits({ fields: null })).toBe(true);
    expect(fits({ fields: { summary: { type: 'string', value: null } } })).toBe(true);
    expect(fits({ fields: { summary: 'Synthetic' } })).toBe(false);
  });

  it('serves at most the newest 50 of a kind, and the counts give the totals', () => {
    const ids = (count: number) =>
      Array.from({ length: count }, () => ({ type: 'account', id: newId('acc') }));
    const withAccounts = (count: number) =>
      caseResourceSchema.safeParse({
        ...golden.data,
        relationships: { ...golden.data.relationships, accounts: { data: ids(count) } },
      }).success;
    expect(withAccounts(50)).toBe(true);
    expect(withAccounts(51)).toBe(false);
  });

  it('refuses a member it does not declare, as every resource does', () => {
    expect(fits({ priority: 'high' })).toBe(false);
  });

  it('includes a template and a comment beside the case (C143.6)', () => {
    expect(caseIncludeDocumentSchema.safeParse(readFixture('api/case-included.json')).success).toBe(
      true,
    );
    expect(getCaseQuerySchema.safeParse({ include: 'case-template,accounts' }).success).toBe(true);
    expect(getCaseQuerySchema.safeParse({ include: 'secrets' }).success).toBe(false);
    expect(CASE_INCLUDES).toContain('case-comments');
  });

  it('lists the PII names for the masks (C143.5)', () => {
    expect(PII_CASE_ATTRIBUTES).toEqual([
      'fields',
      'creator-email-address',
      'statement',
      'user-email-address',
    ]);
  });
});

describe('listing cases (C129.5, C137.1)', () => {
  it('takes the public filters, then ours', () => {
    expect(
      listCasesQuerySchema.safeParse({
        'filter[status]': 'open,pending',
        'filter[case-template-id]': TEMPLATE,
        'filter[account-id]': ACCOUNT,
        'filter[reference-id]': 'customer-1',
        'filter[inquiry-id]': INQUIRY,
        'filter[report-id]': REPORT,
        'filter[case-queue-id]': QUEUE,
        'filter[assignee-id]': REVIEWER,
        'filter[status-category]': 'end',
        'page[after]': CASE,
      }).success,
    ).toBe(true);
  });

  it('refuses a filter or a category it does not know', () => {
    expect(listCasesQuerySchema.safeParse({ 'filter[name]': 'KYC-6' }).success).toBe(false);
    expect(listCasesQuerySchema.safeParse({ 'filter[status-category]': 'done' }).success).toBe(
      false,
    );
  });
});

describe('writing a case (C129.5)', () => {
  const create = (attributes: Record<string, unknown>, meta?: Record<string, unknown>) =>
    createCaseBodySchema.safeParse({
      data: { attributes: { 'case-template-id': TEMPLATE, ...attributes } },
      ...(meta === undefined ? {} : { meta }),
    }).success;

  it('takes the public body', () => {
    expect(
      create(
        {
          'creator-email-address': 'reviewer@example.com',
          'case-queue-id': QUEUE,
          fields: { summary: 'Synthetic' },
          tags: ['manual-review'],
        },
        { 'object-ids': [INQUIRY, REPORT], 'sla-expires-in-seconds': 3600 },
      ),
    ).toBe(true);
    expect(create({})).toBe(true);
  });

  it('needs a template, and refuses what the body does not hold', () => {
    expect(createCaseBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(false);
    expect(create({ status: 'open' })).toBe(false);
    expect(create({}, { unknown: true })).toBe(false);
    expect(create({ 'creator-email-address': 'not-an-address' })).toBe(false);
  });

  it('leaves an SLA out of range to the service, so it answers sla_out_of_range (C133.1)', () => {
    expect(create({}, { 'sla-expires-in-seconds': 7_776_001 })).toBe(true);
    expect(create({}, { 'sla-expires-in-seconds': 1.5 })).toBe(false);
  });

  it('takes any id as an object, and the service refuses what a case cannot hold', () => {
    expect(create({}, { 'object-ids': ['wfr_01M5CM00000000000000000003'] })).toBe(true);
    expect(create({}, { 'object-ids': ['sar_123'] })).toBe(false);
    expect(create({}, { 'object-ids': [INQUIRY, INQUIRY] })).toBe(false);
    expect(create({}, { 'object-ids': [] })).toBe(false);
  });

  it('patches the queue, the fields or the SLA, and needs one of them', () => {
    const update = (body: unknown) => updateCaseBodySchema.safeParse(body).success;
    expect(update({ data: { attributes: { 'case-queue-id': null } } })).toBe(true);
    expect(update({ data: { attributes: { fields: { summary: 'x' } } } })).toBe(true);
    expect(update({ meta: { 'sla-expires-in-seconds': null, 'lock-version': 2 } })).toBe(true);
    expect(update({ meta: { 'lock-version': 2 } })).toBe(false);
    expect(update({ data: { attributes: {} } })).toBe(false);
    expect(update({ data: { attributes: { status: 'open' } } })).toBe(false);
  });

  it('needs meta.status in set-status, as the public body does (C131.1)', () => {
    const set = (meta: Record<string, unknown>) =>
      setCaseStatusBodySchema.safeParse({ meta }).success;
    expect(set({ status: 'approved' })).toBe(true);
    expect(
      set({
        status: 'declined',
        resolution: 'Declined',
        comment: 'Synthetic',
        'status-tag': 'fraud',
        'lock-version': 3,
      }),
    ).toBe(true);
    expect(set({ resolution: 'Approved' })).toBe(false);
    expect(set({ status: 'approved', comment: '' })).toBe(false);
    expect(set({ status: 'approved', 'lock-version': -1 })).toBe(false);
  });

  it('takes a comment of 1 to 10,000 characters (C134.1)', () => {
    const add = (message: string) =>
      addCaseCommentBodySchema.safeParse({ meta: { message } }).success;
    expect(add('x')).toBe(true);
    expect(add('x'.repeat(10_000))).toBe(true);
    expect(add('')).toBe(false);
    expect(add('x'.repeat(10_001))).toBe(false);
  });

  it('adds and removes objects by id', () => {
    for (const schema of [addCaseObjectsBodySchema, removeCaseObjectsBodySchema]) {
      expect(schema.safeParse({ meta: { 'object-ids': [ACCOUNT] } }).success).toBe(true);
      expect(schema.safeParse({ meta: {} }).success).toBe(false);
    }
  });

  it('takes a tag by name or by id, one of them (C136.5)', () => {
    for (const schema of [addCaseTagBodySchema, removeCaseTagBodySchema]) {
      expect(schema.safeParse({ meta: { 'tag-name': 'urgent' } }).success).toBe(true);
      expect(schema.safeParse({ meta: { 'tag-id': 'urgent' } }).success).toBe(true);
      expect(schema.safeParse({ meta: { 'tag-name': 'a', 'tag-id': 'b' } }).success).toBe(false);
      expect(schema.safeParse({ meta: {} }).success).toBe(false);
    }
  });

  it('replaces tags by the public arrays or tag-names, and an empty list clears them', () => {
    const set = (meta: Record<string, unknown>) =>
      setCaseTagsBodySchema.safeParse({ meta }).success;
    expect(set({ 'tag-name': ['a'] })).toBe(true);
    expect(set({ 'tag-id': ['a'] })).toBe(true);
    expect(set({ 'tag-names': [] })).toBe(true);
    expect(set({})).toBe(false);
  });

  it('prints with no parameters (C138.3)', () => {
    expect(printCaseBodySchema.safeParse(undefined).success).toBe(true);
    expect(printCaseBodySchema.safeParse({ meta: { 'include-fields': true } }).success).toBe(false);
  });

  it("opens a review request with the person's statement (C128.7)", () => {
    const open = (meta: Record<string, unknown>) =>
      createInquiryReviewRequestBodySchema.safeParse({ meta }).success;
    expect(open({ statement: 'Synthetic statement' })).toBe(true);
    expect(open({})).toBe(false);
    expect(open({ statement: 'x'.repeat(10_001) })).toBe(false);
  });
});

describe('searching cases (C137.2)', () => {
  const leaf = { attribute: 'status', operator: 'eq', value: 'open' };
  const search = (query: unknown) => caseSearchBodySchema.safeParse({ query }).success;

  it('takes a leaf, and a tree of depth 2', () => {
    expect(search(leaf)).toBe(true);
    expect(search({ and: [leaf, { or: [leaf, leaf] }] })).toBe(true);
    expect(search({ not: { and: [leaf] } })).toBe(true);
  });

  it('refuses a tree of depth 3', () => {
    expect(search({ and: [{ or: [{ not: leaf }] }] })).toBe(false);
  });

  it('caps clauses at 20 per and or or', () => {
    expect(search({ and: Array.from({ length: 20 }, () => leaf) })).toBe(true);
    expect(search({ and: Array.from({ length: 21 }, () => leaf) })).toBe(false);
    expect(search({ or: [] })).toBe(false);
  });

  it('takes the public attributes and a searchable field, and refuses the rest', () => {
    const on = (attribute: string) => search({ ...leaf, attribute });
    expect(on('case_queue_id')).toBe(true);
    expect(on('fields.contact')).toBe(true);
    expect(on('fields.')).toBe(false);
    expect(on('fields.Contact Name')).toBe(false);
    expect(on('redacted_at')).toBe(false);
  });

  it('takes the five operators only', () => {
    expect(search({ ...leaf, operator: 'gte' })).toBe(true);
    expect(search({ ...leaf, operator: 'like' })).toBe(false);
  });

  it('takes the public sort and page, with one direction of page', () => {
    const body = (rest: Record<string, unknown>) => caseSearchBodySchema.safeParse(rest).success;
    expect(
      body({
        query: leaf,
        sort: { attribute: 'sla_expires_at', direction: 'asc' },
        page: { after: CASE, size: 100 },
      }),
    ).toBe(true);
    expect(body({ page: { after: CASE, before: OTHER_CASE } })).toBe(false);
    expect(body({ page: { size: 101 } })).toBe(false);
    expect(body({ sort: { attribute: 'name', direction: 'asc' } })).toBe(false);
    expect(body({})).toBe(true);
  });

  it('answers both directions of the page', () => {
    expect(caseSearchDocumentSchema.safeParse(readFixture('api/case-search.json')).success).toBe(
      true,
    );
  });
});

describe('the timeline and held objects (Stage 1a amendments 6 and 19)', () => {
  it('builds a timeline entry, numbered by its row', () => {
    const page = caseHistoryListDocumentSchema.parse(readFixture('api/case-history.json'));
    expect(
      buildCaseHistoryEntryResource({
        sequence: 1,
        kind: 'created',
        actorType: 'workflow-run',
        actorId: RUN,
        from: null,
        to: { status: 'open' },
        requestId: null,
        createdAt: AT,
      }),
    ).toEqual(page.data[1]);
  });

  it('pages a timeline by its row number', () => {
    expect(listCaseHistoryQuerySchema.safeParse({ 'page[after]': '12' }).success).toBe(true);
    expect(listCaseHistoryQuerySchema.safeParse({ 'page[after]': '0' }).success).toBe(false);
  });

  it('keys a held object by the case and the object, each of a kind a case can hold', () => {
    expect(caseHeldObjectIdSchema.safeParse(`${CASE}:${INQUIRY}`).success).toBe(true);
    expect(caseHeldObjectIdSchema.safeParse(`${CASE}:${RUN}`).success).toBe(false);
    expect(
      caseHeldObjectListDocumentSchema.safeParse(readFixture('api/case-held-objects.json')).success,
    ).toBe(true);
  });

  it('holds the state as attached to scalars and ids, so no object fits in it (C136.3)', () => {
    const page = caseHeldObjectListDocumentSchema.parse(readFixture('api/case-held-objects.json'));
    const [first] = page.data;
    const withState = (state: unknown) =>
      caseHeldObjectListDocumentSchema.safeParse({
        ...page,
        data: [{ ...first, attributes: { ...first?.attributes, 'attached-state': state } }],
      }).success;
    expect(withState({ status: 'needs_review', 'verification-ids': [] })).toBe(true);
    expect(withState({ fields: { name: 'Synthetic' } })).toBe(false);
  });

  it('filters held objects by type', () => {
    expect(
      listCaseHeldObjectsQuerySchema.safeParse({ 'filter[object-type]': 'inquiry,report' }).success,
    ).toBe(true);
    expect(listCaseHeldObjectsQuerySchema.safeParse({ 'filter[object-type]': 'sar' }).success).toBe(
      false,
    );
  });
});

describe('bulk actions (C137.4)', () => {
  const body = (
    action: string,
    meta: Record<string, unknown>,
    selection: Record<string, unknown> = { 'case-ids': [CASE] },
  ) =>
    createCaseBulkActionBodySchema.safeParse({
      data: { attributes: { action, ...selection } },
      meta,
    }).success;

  it('takes each public action with its own meta', () => {
    expect(body('assign', { 'user-id': REVIEWER })).toBe(true);
    expect(body('assign', { 'user-id': null })).toBe(true);
    expect(body('set-status', { status: 'approved', resolution: 'Approved' })).toBe(true);
    expect(body('set-queue', { 'case-queue-id': null })).toBe(true);
    expect(body('add-tags', { 'tag-names': ['urgent'] })).toBe(true);
    expect(body('remove-tags', { 'tag-names': ['urgent'] })).toBe(true);
  });

  it("refuses an action it does not know, and another action's meta", () => {
    expect(body('redact', {})).toBe(false);
    expect(body('assign', { status: 'open' })).toBe(false);
  });

  it('selects by ids or a search, never both and never neither', () => {
    const search = { query: { attribute: 'status', operator: 'eq', value: 'open' } };
    expect(body('add-tags', { 'tag-names': ['a'] }, { search })).toBe(true);
    expect(body('add-tags', { 'tag-names': ['a'] }, { 'case-ids': [CASE], search })).toBe(false);
    expect(body('add-tags', { 'tag-names': ['a'] }, {})).toBe(false);
  });

  it('caps the ids at 500', () => {
    const ids = (count: number) => Array.from({ length: count }, () => newId('case'));
    expect(body('add-tags', { 'tag-names': ['a'] }, { 'case-ids': ids(500) })).toBe(true);
    expect(body('add-tags', { 'tag-names': ['a'] }, { 'case-ids': ids(501) })).toBe(false);
  });

  it('counts the outcomes it was given, and reads the golden answer', () => {
    const golden = caseBulkActionDocumentSchema.parse(readFixture('api/case-bulk-action.json'));
    expect(
      buildCaseBulkActionResource({
        id: 'cblk_01M5CN00000000000000000015',
        action: 'set-status',
        status: 'completed',
        requestedCount: 2,
        outcomes: [
          { caseId: CASE, outcome: 'applied', code: null },
          { caseId: OTHER_CASE, outcome: 'refused', code: 'case_transition_refused' },
        ],
        createdAt: AT,
        completedAt: LATER,
      }),
    ).toEqual(golden.data);
  });

  it('holds a code to a refusal, and a refusal to a code', () => {
    const parse = (outcome: Record<string, unknown>) =>
      caseBulkActionDocumentSchema.safeParse({
        data: {
          type: 'case-bulk-action',
          id: 'cblk_01M5CN00000000000000000015',
          attributes: {
            action: 'assign',
            status: 'running',
            'requested-count': 1,
            'applied-count': 0,
            'no-change-count': 0,
            'refused-count': 0,
            outcomes: [{ 'case-id': CASE, ...outcome }],
            'created-at': AT.toISOString(),
            'completed-at': null,
          },
        },
      }).success;
    expect(parse({ outcome: 'applied', code: null })).toBe(true);
    expect(parse({ outcome: 'refused', code: null })).toBe(false);
    expect(parse({ outcome: 'applied', code: 'case_redacted' })).toBe(false);
    expect(parse({ outcome: 'refused', code: 'A free text with a value' })).toBe(false);
  });
});

describe('the (Q) family on a case (C132, C133)', () => {
  it('serves the SLA state, with a deadline unless none is set or it is paused (C133.4)', () => {
    expect(golden.data.attributes).toMatchObject({ 'sla-state': 'running' });
    expect(fits({ 'sla-state': 'paused', 'sla-expires-at': null })).toBe(true);
    expect(fits({ 'sla-state': 'none', 'sla-expires-at': null })).toBe(true);
    expect(fits({ 'sla-state': 'met' })).toBe(true);
    expect(fits({ 'sla-state': 'expired' })).toBe(true);
    expect(fits({ 'sla-state': 'paused' })).toBe(false);
    expect(fits({ 'sla-state': 'running', 'sla-expires-at': null })).toBe(false);
    expect(fits({ 'sla-state': 'breached' })).toBe(false);
    expect(
      buildCaseResource({ ...record, slaState: 'paused', slaExpiresAt: null }).attributes,
    ).toMatchObject({
      'sla-state': 'paused',
      'sla-expires-at': null,
    });
  });

  it('filters cases by SLA state and includes the queue (C129.5, C143.6)', () => {
    expect(listCasesQuerySchema.safeParse({ 'filter[sla-state]': 'running,expired' }).success).toBe(
      true,
    );
    expect(listCasesQuerySchema.safeParse({ 'filter[sla-state]': 'late' }).success).toBe(false);
    expect(CASE_INCLUDES).toContain('case-queue');
    expect(getCaseQuerySchema.safeParse({ include: 'case-queue' }).success).toBe(true);
    const included = caseIncludeDocumentSchema.parse(readFixture('api/case-included.json'));
    expect(included.included?.map(({ type }) => type)).toEqual([
      'case-template',
      'case-queue',
      'case-comment',
    ]);
  });

  it('assigns by user id or the public email address, one of them, and null unassigns (C132.3)', () => {
    const assign = (meta: Record<string, unknown>) =>
      assignCaseBodySchema.safeParse({ meta }).success;
    expect(assign({ 'user-id': REVIEWER })).toBe(true);
    expect(assign({ 'user-id': null, 'lock-version': 2 })).toBe(true);
    expect(assign({ 'user-email-address': 'reviewer@example.com' })).toBe(true);
    expect(assign({ 'user-id': REVIEWER, 'user-email-address': 'reviewer@example.com' })).toBe(
      false,
    );
    expect(assign({})).toBe(false);
    expect(assign({ 'user-id': 'reviewer@example.com' })).toBe(false);
    expect(assign({ 'user-email-address': 'not an address' })).toBe(false);
  });

  it("pulls the next case from the caller's queues, and answers null when none waits (C132.3)", () => {
    expect(nextCaseBodySchema.safeParse(undefined).success).toBe(true);
    expect(nextCaseBodySchema.safeParse({ meta: { 'case-queue-ids': [QUEUE] } }).success).toBe(
      true,
    );
    expect(nextCaseBodySchema.safeParse({ meta: { 'case-queue-ids': [] } }).success).toBe(false);
    expect(
      nextCaseBodySchema.safeParse({ meta: { 'case-queue-ids': [QUEUE, QUEUE] } }).success,
    ).toBe(false);
    expect(nextCaseDocumentSchema.parse(readFixture('api/case-next.json')).data?.id).toBe(CASE);
    expect(nextCaseDocumentSchema.safeParse({ data: null }).success).toBe(true);
  });
});

describe('the (F) family on a case (C135)', () => {
  it('serves its attachments, none when the record holds none', () => {
    const { attachments, ...rest } = record;
    expect(attachments).toHaveLength(1);
    expect(golden.data.attributes).toMatchObject({
      attachments: [
        { 'scan-status': 'clean', 'scan-provider': 'sandbox', 'rendition-status': 'ready' },
      ],
    });
    expect(buildCaseResource(rest).attributes).toMatchObject({ attachments: [] });
  });

  it('holds at most 20 attachments (C135.2)', () => {
    const [one] = (
      readFixture('api/case.json') as { data: { attributes: { attachments: [unknown] } } }
    ).data.attributes.attachments;
    const many = (count: number) => Array.from({ length: count }, () => one);
    expect(fits({ attachments: many(20) })).toBe(true);
    expect(fits({ attachments: many(21) })).toBe(false);
  });

  it('patches attachments by the public body, and needs one of them (C135.1)', () => {
    const attachment = { data: Buffer.from('synthetic').toString('base64'), filename: 'a.png' };
    expect(
      updateCaseBodySchema.safeParse({ data: { attributes: { attachments: [attachment] } } })
        .success,
    ).toBe(true);
    expect(
      updateCaseBodySchema.safeParse({
        data: { attributes: { attachments: [{ ...attachment, url: 'x' }] } },
      }).success,
    ).toBe(false);
  });
});
