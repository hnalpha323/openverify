/**
 * C143.4 (Workflow 8B Stage 1b (C)): the case filters of `matchesWebhookFilters`, which the trigger
 * filters read as webhooks do (outcome 29). A case passes `case-template-ids` by its template, and an
 * inquiry-template filter only when the filter allows the template of every inquiry it holds.
 */
import { describe, expect, it } from 'vitest';
import { matchesWebhookFilters, type WebhookFilterSubject } from './webhook-payload.js';

const event = (subject: WebhookFilterSubject) => ({
  payload: { data: { type: 'case', id: 'case_01M6FQZCV622MRCK2ZKC7F4HD9' } },
  subject,
});

describe('the case webhook filters (C143.4)', () => {
  it('pass a case by its template, and fail another or none when strict', () => {
    const filters = { 'case-template-ids': ['ctmpl_a'] };

    expect(matchesWebhookFilters(event({ caseTemplateId: 'ctmpl_a', strict: true }), filters)).toBe(
      true,
    );
    expect(matchesWebhookFilters(event({ caseTemplateId: 'ctmpl_b', strict: true }), filters)).toBe(
      false,
    );
    expect(matchesWebhookFilters(event({ strict: true }), filters)).toBe(false);
  });

  it('pass an inquiry-template filter only when it allows every held inquiry’s template', () => {
    const filters = { 'inquiry-template-ids': ['itmpl_a', 'itmpl_b'] };
    const held = (heldInquiryTemplateIds: string[]) =>
      matchesWebhookFilters(event({ heldInquiryTemplateIds, strict: true }), filters);

    expect(held(['itmpl_a', 'itmpl_b'])).toBe(true);
    expect(held(['itmpl_a', 'itmpl_c'])).toBe(false);
    expect(held([])).toBe(false);
  });
});
