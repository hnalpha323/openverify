import { describe, expect, it } from 'vitest';
import {
  applyAttributeBlocklist,
  matchesWebhookFilters,
  webhookFilterSubject,
  type WebhookFilters,
} from './webhook-payload.js';

const TEMPLATE = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6';
const OTHER_TEMPLATE = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X7';
const ACCOUNT_TYPE = 'acctp_01M5A0GTG0RSTVX9PHA0V7P3X6';
const OTHER_ACCOUNT_TYPE = 'acctp_01M5A0GTG0RSTVX9PHA0V7P3X7';

const inquiryPayload = () => ({
  data: {
    type: 'inquiry',
    id: 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
    attributes: {
      status: 'approved',
      'reference-id': 'ref-test-001',
      fields: { name_first: 'Jane', name_last: 'Sample' },
      note: 'synthetic note',
      tags: ['vip'],
    },
    relationships: {
      'inquiry-template': { data: { type: 'inquiry-template', id: TEMPLATE } },
      account: { data: { type: 'account', id: 'acc_01M5CJXHG07XPHF3HRM6NREDH7' } },
    },
  },
  included: [
    {
      type: 'verification/selfie',
      id: 'ver_01M5CK3190XEVBM5ZXA76E1JSM',
      attributes: {
        status: 'passed',
        checks: [
          { name: 'selfie_id_comparison', status: 'passed', metadata: { similarity: 0.71 } },
          { name: 'selfie_image_quality_detection', status: 'passed', metadata: {} },
        ],
      },
      relationships: {
        inquiry: { data: { type: 'inquiry', id: 'inq_01M5CJXHG07XPHF3HRM6NREDH7' } },
      },
    },
  ],
});

const accountPayload = (accountTypeId: string) => ({
  data: {
    type: 'account',
    id: 'acc_01M5CJXHG07XPHF3HRM6NREDH7',
    attributes: { status: 'active', fields: {} },
    relationships: { 'account-type': { data: { type: 'account-type', id: accountTypeId } } },
  },
});

const verificationPayload = {
  data: {
    type: 'verification/selfie',
    id: 'ver_01M5CK3190XEVBM5ZXA76E1JSM',
    attributes: { status: 'passed' },
    relationships: { inquiry: { data: { type: 'inquiry', id: 'inq_01M5CJXHG07XPHF3HRM6NREDH7' } } },
  },
};

describe('applyAttributeBlocklist (C14)', () => {
  it('removes listed attributes from data and every included resource', () => {
    const result = applyAttributeBlocklist(inquiryPayload(), ['note', 'status']);
    expect(result.data).toMatchObject({ attributes: { 'reference-id': 'ref-test-001' } });
    expect(result.data).not.toHaveProperty(['attributes', 'note']);
    expect(result.data).not.toHaveProperty(['attributes', 'status']);
    expect(result.included[0]).not.toHaveProperty(['attributes', 'status']);
  });

  it('removes nested attributes at any depth inside attributes', () => {
    const result = applyAttributeBlocklist(inquiryPayload(), ['metadata']);
    expect(result.included[0]).toMatchObject({
      attributes: {
        checks: [
          { name: 'selfie_id_comparison', status: 'passed' },
          { name: 'selfie_image_quality_detection', status: 'passed' },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('similarity');
  });

  it('blocks the whole fields object with "fields"', () => {
    const result = applyAttributeBlocklist(inquiryPayload(), ['fields']);
    expect(result.data).not.toHaveProperty(['attributes', 'fields']);
    expect(JSON.stringify(result)).not.toContain('Jane');
  });

  it('never touches type, id or relationships', () => {
    const result = applyAttributeBlocklist(inquiryPayload(), ['id', 'type', 'data', 'account']);
    expect(result.data).toMatchObject({
      type: 'inquiry',
      id: 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
      relationships: inquiryPayload().data.relationships,
    });
  });

  it('returns a copy and leaves the input unchanged', () => {
    const payload = inquiryPayload();
    const result = applyAttributeBlocklist(payload, ['note']);
    expect(payload).toEqual(inquiryPayload());
    expect(result).not.toBe(payload);
    expect(applyAttributeBlocklist(payload, [])).toEqual(payload);
  });

  it('handles a list in data, a payload without included and resources without attributes', () => {
    const payload = {
      data: [
        { type: 'account', id: 'acc_01M5CJXHG07XPHF3HRM6NREDH7', attributes: { fields: { a: 1 } } },
        { type: 'account', id: 'acc_01M5CJXHG07XPHF3HRM6NREDH8' },
        'not-a-resource',
        null,
      ],
    };
    expect(applyAttributeBlocklist(payload, ['fields'])).toEqual({
      data: [
        { type: 'account', id: 'acc_01M5CJXHG07XPHF3HRM6NREDH7', attributes: {} },
        { type: 'account', id: 'acc_01M5CJXHG07XPHF3HRM6NREDH8' },
        'not-a-resource',
        null,
      ],
    });
  });

  it('leaves a null data member alone', () => {
    expect(applyAttributeBlocklist({ data: null }, ['note'])).toEqual({ data: null });
  });
});

describe('webhookFilterSubject', () => {
  it('reads the inquiry template of an inquiry event', () => {
    expect(webhookFilterSubject(inquiryPayload())).toEqual({ inquiryTemplateId: TEMPLATE });
  });

  it('reads the account type of an account event', () => {
    expect(webhookFilterSubject(accountPayload(ACCOUNT_TYPE))).toEqual({
      accountTypeId: ACCOUNT_TYPE,
    });
  });

  it.each([
    ['a verification event', verificationPayload],
    ['no payload', undefined],
    ['a scalar payload', 'payload'],
    ['no data', {}],
    ['a list in data', { data: [] }],
    ['no relationships', { data: { type: 'inquiry', id: 'x' } }],
    ['a null linkage', { data: { relationships: { 'inquiry-template': { data: null } } } }],
    ['a non-string id', { data: { relationships: { 'account-type': { data: { id: 5 } } } } }],
  ])('finds nothing in %s', (_name, payload) => {
    expect(webhookFilterSubject(payload)).toEqual({});
  });
});

describe('matchesWebhookFilters: the workflow and list filters (C143.4)', () => {
  const event = { payload: { data: { type: 'workflow-run', id: 'wfr_1' } } };

  it('matches a run by its workflow', () => {
    const subject = { workflowId: 'wfl_1', strict: true };

    expect(matchesWebhookFilters({ ...event, subject }, { 'workflow-ids': ['wfl_1'] })).toBe(true);
    expect(matchesWebhookFilters({ ...event, subject }, { 'workflow-ids': ['wfl_2'] })).toBe(false);
  });

  it('matches a list event by its list', () => {
    const subject = { listId: 'lst_1', strict: true };

    expect(matchesWebhookFilters({ ...event, subject }, { 'list-ids': ['lst_1'] })).toBe(true);
    expect(matchesWebhookFilters({ ...event, subject }, { 'list-ids': ['lst_2'] })).toBe(false);
  });

  it('fails a strict subject without the attribute', () => {
    expect(
      matchesWebhookFilters({ ...event, subject: { strict: true } }, { 'list-ids': ['lst_1'] }),
    ).toBe(false);
  });

  it('leaves a loose subject unfiltered by an attribute it lacks (C14)', () => {
    expect(matchesWebhookFilters(event, { 'workflow-ids': ['wfl_1'] })).toBe(true);
  });
});

describe('matchesWebhookFilters (C14)', () => {
  const both: WebhookFilters = {
    'inquiry-template-ids': [TEMPLATE],
    'account-type-ids': [ACCOUNT_TYPE],
  };

  it('delivers everything when the webhook has no filters', () => {
    expect(matchesWebhookFilters({ payload: inquiryPayload() }, {})).toBe(true);
  });

  it('delivers an event whose subject matches every present filter', () => {
    expect(matchesWebhookFilters({ payload: inquiryPayload() }, both)).toBe(true);
    expect(matchesWebhookFilters({ payload: accountPayload(ACCOUNT_TYPE) }, both)).toBe(true);
  });

  it('drops an event whose subject misses a present filter', () => {
    expect(
      matchesWebhookFilters(
        { payload: inquiryPayload() },
        { 'inquiry-template-ids': [OTHER_TEMPLATE] },
      ),
    ).toBe(false);
    expect(matchesWebhookFilters({ payload: accountPayload(OTHER_ACCOUNT_TYPE) }, both)).toBe(
      false,
    );
  });

  it('does not filter an event that lacks the filtered attribute', () => {
    expect(matchesWebhookFilters({ payload: verificationPayload }, both)).toBe(true);
  });

  it('lets the caller supply a subject the payload does not carry', () => {
    expect(
      matchesWebhookFilters(
        { payload: verificationPayload, subject: { inquiryTemplateId: OTHER_TEMPLATE } },
        both,
      ),
    ).toBe(false);
    expect(
      matchesWebhookFilters(
        { payload: inquiryPayload(), subject: { inquiryTemplateId: null } },
        { 'inquiry-template-ids': [OTHER_TEMPLATE] },
      ),
    ).toBe(true);
  });

  it('treats an empty filter list as matching no subject', () => {
    expect(
      matchesWebhookFilters({ payload: inquiryPayload() }, { 'inquiry-template-ids': [] }),
    ).toBe(false);
  });
});

describe('strict report subjects (C70.4, F10)', () => {
  const filters = { 'inquiry-template-ids': ['itmpl_01JB0000000000000000000001'] };
  const report = { data: { type: 'report/watchlist', id: 'rep_01JB0000000000000000000001' } };

  it('fail a present filter without the attribute', () => {
    expect(matchesWebhookFilters({ payload: report, subject: { strict: true } }, filters)).toBe(
      false,
    );
    expect(matchesWebhookFilters({ payload: report, subject: { strict: true } }, {})).toBe(true);
  });

  it('pass a filter they meet, and other subjects keep the C14 rule', () => {
    expect(
      matchesWebhookFilters(
        {
          payload: report,
          subject: { strict: true, inquiryTemplateId: 'itmpl_01JB0000000000000000000001' },
        },
        filters,
      ),
    ).toBe(true);
    expect(matchesWebhookFilters({ payload: report }, filters)).toBe(true);
  });
});

describe('a subject with several links (C107.4)', () => {
  const event = {
    payload: {},
    subject: {
      strict: true,
      inquiryTemplateIds: ['itmpl_a', 'itmpl_b'],
      accountTypeIds: ['acctp_a', 'acctp_b'],
    },
  };

  it('passes a filter that allows any one of them', () => {
    expect(matchesWebhookFilters(event, { 'inquiry-template-ids': ['itmpl_b'] })).toBe(true);
    expect(matchesWebhookFilters(event, { 'account-type-ids': ['acctp_a', 'acctp_z'] })).toBe(true);
  });

  it('fails a filter that allows none of them', () => {
    expect(matchesWebhookFilters(event, { 'inquiry-template-ids': ['itmpl_z'] })).toBe(false);
    expect(
      matchesWebhookFilters(event, {
        'inquiry-template-ids': ['itmpl_a'],
        'account-type-ids': ['acctp_z'],
      }),
    ).toBe(false);
  });

  it('keeps the strict rule for a subject with none, and counts a single link with the list', () => {
    const none = { payload: {}, subject: { strict: true, inquiryTemplateIds: [] } };
    expect(matchesWebhookFilters(none, { 'inquiry-template-ids': ['itmpl_a'] })).toBe(false);
    expect(matchesWebhookFilters(none, {})).toBe(true);
    const both = { payload: {}, subject: { inquiryTemplateId: 'a', inquiryTemplateIds: ['b'] } };
    expect(matchesWebhookFilters(both, { 'inquiry-template-ids': ['b'] })).toBe(true);
    expect(matchesWebhookFilters(both, { 'inquiry-template-ids': ['a'] })).toBe(true);
  });
});
