/**
 * C147.1, C147.10 (Workflow 9A, api-flow-engine): the flow the engine walks. Stored versions are
 * never rewritten, so a version pinned to flow-spec 1 is migrated on read (`migrateFlow`, lossless,
 * golden-tested by `flow-spec-logic`) and walked as v2; `specVersion` keeps what was stored.
 */
import type { FlowRecordSpecVersion } from '@openverify/core';
import { getInquiryTemplateVersion, type Db, type InquiryTemplateVersion } from '@openverify/db';
import { isFlowV2, migrateFlow, safeParseAnyFlow, type FlowV2 } from '@openverify/flow-spec';

export interface PinnedFlow {
  /** The flow as v2: as stored, or migrated from v1. */
  flow: FlowV2;
  /** The flow-spec version the pinned version stores. */
  specVersion: FlowRecordSpecVersion;
  version: InquiryTemplateVersion;
}

/**
 * The pinned version's flow, as the engine walks it; `null` when the version is gone or its stored
 * flow is no valid flow of either version (nothing can be walked, so nothing moves; the verification
 * jobs still fail such an attempt on their own, `invalid_template`).
 */
export async function pinnedFlowOf(
  db: Db,
  inquiry: { environmentId: string; inquiryTemplateVersionId: string },
): Promise<PinnedFlow | null> {
  const version = await getInquiryTemplateVersion(
    db,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  if (version === null) {
    return null;
  }
  const parsed = safeParseAnyFlow(version.flow);
  if (!parsed.success) {
    return null;
  }
  const stored = parsed.data;
  return isFlowV2(stored)
    ? { flow: stored, specVersion: 2, version }
    : { flow: migrateFlow(stored), specVersion: 1, version };
}
