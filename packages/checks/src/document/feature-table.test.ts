/** C60.6, V13: what the expiry and recency checks judge per class. */
import { DOCUMENT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_FEATURE_TABLE, TAX_DOCUMENT_MAX_AGE_MONTHS } from './feature-table.js';

describe('DOCUMENT_FEATURE_TABLE', () => {
  it('has a row for every class', () => {
    expect(Object.keys(DOCUMENT_FEATURE_TABLE).sort()).toEqual([...DOCUMENT_TYPES].sort());
  });

  it.each(['utility_bill', 'bank_statement', 'pay_stub'] as const)(
    '%s has no expiry and is recent by its issue date',
    (documentClass) => {
      expect(DOCUMENT_FEATURE_TABLE[documentClass]).toEqual({
        expiry: 'none',
        recency: 'issue-date',
      });
    },
  );

  it('a tax document has no expiry and is recent when issued within 18 months', () => {
    expect(DOCUMENT_FEATURE_TABLE.tax_document).toEqual({
      expiry: 'none',
      recency: 'tax-document',
    });
    expect(TAX_DOCUMENT_MAX_AGE_MONTHS).toBe(18);
  });

  it('a lease expires at its end and is recent while its term covers today', () => {
    expect(DOCUMENT_FEATURE_TABLE.lease).toEqual({ expiry: 'lease-end', recency: 'lease-term' });
  });
});
