import type { InquiryResource } from '@openverify/contracts';
import type { InquirySummary } from '../inquiries-table';

/** One row of an inquiries table, from the API's inquiry resource. */
export function inquirySummary(inquiry: InquiryResource): InquirySummary {
  return {
    id: inquiry.id,
    referenceId: inquiry.attributes['reference-id'],
    status: inquiry.attributes.status,
    tags: inquiry.attributes.tags ?? [],
    accountId: inquiry.relationships.account?.data?.id ?? null,
    createdAt: inquiry.attributes['created-at'],
  };
}
