import { describe, expect, it } from 'vitest';
import { CASE_IDS } from '../../testing/cases-fixtures';
import { caseFilterQuery, hasCaseFilters, parseCaseQuery } from './case-query';

describe('the case list filters (C23, C129.5)', () => {
  it('reads every C129.5 filter from the URL, trimmed, and the cursor', () => {
    const query = parseCaseQuery({
      status: ' pending ',
      template: CASE_IDS.template,
      queue: CASE_IDS.queue,
      assignee: CASE_IDS.member,
      category: 'end',
      sla: 'expired',
      account: CASE_IDS.account,
      inquiry: CASE_IDS.inquiry,
      report: 'rep_01JE0000000000000000000001',
      reference: 'synthetic-ref-1',
      after: CASE_IDS.otherCase,
    });

    expect(query.errors).toEqual({});
    expect(query.filters).toEqual({
      status: 'pending',
      templateId: CASE_IDS.template,
      queueId: CASE_IDS.queue,
      assigneeId: CASE_IDS.member,
      category: 'end',
      slaState: 'expired',
      accountId: CASE_IDS.account,
      inquiryId: CASE_IDS.inquiry,
      reportId: 'rep_01JE0000000000000000000001',
      referenceId: 'synthetic-ref-1',
    });
    expect(query.after).toBe(CASE_IDS.otherCase);
    expect(hasCaseFilters(query.filters)).toBe(true);
    expect(caseFilterQuery(query.values)).toMatchObject({ status: 'pending', sla: 'expired' });
  });

  it('says what is wrong with a value it cannot use, and filters nothing for an empty URL', () => {
    const wrong = parseCaseQuery({
      status: 'Not A Key',
      template: 'acc_01JE0000000000000000000001',
      category: 'closed',
      sla: 'late',
      assignee: 'someone@example.test',
      after: 'not-a-cursor',
    });

    expect(wrong.errors).toEqual({
      status: 'A status key is lower-case letters, digits, _ or -.',
      template: 'Choose a template from the list.',
      category: 'Choose a category from the list.',
      sla: 'Choose an SLA state from the list.',
      assignee: 'Enter an operator’s user ID (usr_…).',
    });
    expect(wrong.after).toBeUndefined();
    const empty = parseCaseQuery({});
    expect(empty.filters).toEqual({});
    expect(hasCaseFilters(empty.filters)).toBe(false);
  });
});
