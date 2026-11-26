/**
 * Workflow 9A (`api-flow-actions`): the flow an inquiry is pinned to (its template version's), when
 * that flow is spec 2; a v1 flow has no action, branch or wait, and an inquiry that is gone or
 * redacted has none to act on.
 */
import { getInquiry, getInquiryTemplateVersion, type Db, type Inquiry } from '@openverify/db';
import { isFlowV2, safeParseAnyFlow, type FlowV2 } from '@openverify/flow-spec';
import type { FlowInquiryRef } from '../flow-engine/advance.js';

export interface PinnedFlow {
  inquiry: Inquiry;
  flow: FlowV2;
}

/** The inquiry and its v2 flow, or `null` (gone, redacted, or a v1 flow). */
export async function pinnedFlowV2(db: Db, ref: FlowInquiryRef): Promise<PinnedFlow | null> {
  const inquiry = await getInquiry(db, ref.environmentId, ref.inquiryId);
  if (inquiry?.redactedAt !== null) {
    return null;
  }
  const version = await getInquiryTemplateVersion(
    db,
    ref.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const parsed = safeParseAnyFlow(version?.flow);
  return parsed.success && isFlowV2(parsed.data) ? { inquiry, flow: parsed.data } : null;
}
