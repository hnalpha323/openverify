/**
 * Workflow 8B Stage 1b, checkpoint (Q) (C143.5, P21; Stage 1a amendment 38): the (Q) family's PII
 * at the stored API log and the masked lists.
 *
 * - An assignment's `meta.user-email-address` sits outside any `attributes`, so the stored log nulls it
 *   by name at any depth; it is a case PII name in every masked list too.
 * - A holiday import's `data.attributes.csv` is masked whole in a stored log.
 *
 * Every value is synthetic.
 */
import { PII_CASE_ATTRIBUTES } from '@openverify/contracts';
import { MASKED_ATTRIBUTE_NAMES } from '@openverify/workflow-engine';
import { describe, expect, it } from 'vitest';
import { MASKED_ATTRIBUTES } from './auth/pii.js';
import { maskPersonalData } from './services/api-logs.js';

describe('C143.5: the (Q) PII', () => {
  it('names an assignee’s address in every masked list', () => {
    expect(PII_CASE_ATTRIBUTES).toContain('user-email-address');
    expect(MASKED_ATTRIBUTES).toContain('user-email-address');
    expect([...MASKED_ATTRIBUTE_NAMES]).toContain('user-email-address');
  });

  it('nulls an assignment’s address in a stored log, wherever it sits', () => {
    const masked = maskPersonalData({
      meta: { 'user-email-address': 'reviewer@example.com', 'lock-version': 3 },
      data: [{ meta: { 'user-email-address': 'reviewer@example.org' } }],
    });

    expect(masked).toEqual({
      meta: { 'user-email-address': null, 'lock-version': 3 },
      data: [{ meta: { 'user-email-address': null } }],
    });
  });

  it('nulls a holiday import’s CSV in a stored log, and keeps its replace flag', () => {
    const masked = maskPersonalData({
      data: {
        type: 'case-calendar',
        attributes: { csv: 'date,label\r\n2026-12-25,Synthetic closure\r\n', replace: true },
      },
    });

    expect(masked).toEqual({
      data: { type: 'case-calendar', attributes: { csv: null, replace: true } },
    });
  });
});
