/**
 * The inquiry page's decision records slot (C128.1, C142.4; Workflow 8C, F32): every approve,
 * decline, review and reopen recorded for the inquiry (`GET /decisions?filter[subject-id]=`, read
 * with the inquiry's own scope), and the reopen action of a declined inquiry for users holding
 * `inquiries:write` (C128.6).
 *
 * The inquiry page calls it as a function and awaits it through `loadSection`: a thrown 403 gives
 * the section's forbidden panel, and `null` leaves the section out.
 */
import type { InquiryStatus, Permission } from '@openverify/core';
import type { ReactNode } from 'react';
import { reopenInquiry } from '../../app/inquiries/actions';
import { getApiClient } from '../../lib/api/client';
import { DecisionRecords } from './decision-records';
import { ReopenInquiryButton } from './reopen-inquiry-button';

/** Records shown per inquiry, newest first: an inquiry rarely has more than a few. */
const DECISION_PAGE_SIZE = 100;

export interface InquiryDecisionsSectionProps {
  /** The inquiry, `inq_…`. */
  readonly inquiryId: string;
  /** Its status: reopen is offered only for `declined`. */
  readonly status: InquiryStatus;
  /** Whether it was redacted: the API answers a reopen 410 then. */
  readonly redacted: boolean;
  /** The principal's permissions, as `GET /dashboard/me` answered them. */
  readonly permissions: ReadonlySet<Permission>;
}

/** The section's content, or `null` for none. */
export const InquiryDecisionsSection: (
  props: InquiryDecisionsSectionProps,
) => Promise<ReactNode> = async ({ inquiryId, status, redacted, permissions }) => {
  const api = await getApiClient();
  const page = await api.decisions.list({
    filter: { 'subject-id': inquiryId },
    page: { size: DECISION_PAGE_SIZE },
  });
  const reopen =
    status === 'declined' && !redacted && permissions.has('inquiries:write') ? (
      <ReopenInquiryButton inquiryId={inquiryId} action={reopenInquiry} />
    ) : undefined;
  return (
    <DecisionRecords
      records={page.data}
      piiView={permissions.has('pii:view')}
      redacted={redacted}
      emptyMessage="No decision is recorded for this inquiry."
      actions={reopen}
    />
  );
};
