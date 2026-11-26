/**
 * The document feature table (C60.6, V13): per class, what the expiry and recency checks judge.
 *
 * | Class | Expiry | Recency |
 * |---|---|---|
 * | `utility_bill` | none (`feature_absent`) | issue date within `max-age-days` |
 * | `bank_statement` | none (`feature_absent`) | issue date within `max-age-days` |
 * | `pay_stub` | none (`feature_absent`) | issue date within `max-age-days` |
 * | `tax_document` | none (`feature_absent`) | issued within 18 months (the latest tax year; ours) |
 * | `lease` | its end date (`feature_absent` without one: a periodic tenancy) | its term or end date covers today |
 */
import type { DocumentClass } from './inputs.js';

export interface DocumentFeatureRow {
  /** What the expiry check reads: nothing, or the lease's end. */
  readonly expiry: 'none' | 'lease-end';
  /** What recency reads: the issue date's age, the lease's term, or the tax document's issue. */
  readonly recency: 'issue-date' | 'lease-term' | 'tax-document';
}

/** A tax document is recent when issued within this many months (ours, provisional; V13). */
export const TAX_DOCUMENT_MAX_AGE_MONTHS = 18;

export const DOCUMENT_FEATURE_TABLE: Readonly<Record<DocumentClass, DocumentFeatureRow>> =
  Object.freeze({
    utility_bill: { expiry: 'none', recency: 'issue-date' },
    bank_statement: { expiry: 'none', recency: 'issue-date' },
    lease: { expiry: 'lease-end', recency: 'lease-term' },
    pay_stub: { expiry: 'none', recency: 'issue-date' },
    tax_document: { expiry: 'none', recency: 'tax-document' },
  });
