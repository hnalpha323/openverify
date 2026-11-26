/** Maps database rows to the C1-C4 and C15 resources the dashboard API returns. */
import { withInquiryProvenance } from '../../services/connect/cloned-results.js';
import {
  acceptedUploadMimeTypeSchema,
  buildFileResource,
  buildInquiryResource,
  buildVerificationResource,
  inquiryFieldsSchema,
  type FileResource,
  type InquiryResource,
  type SelfieVerificationDetails,
  type VerificationResource,
} from '@openverify/contracts';
import {
  verifications,
  type Db,
  type GovernmentIdExtraction,
  type Inquiry,
  type ListScreening,
  type StoredFile,
  type VerificationType,
  type VerificationWithChecks,
} from '@openverify/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { UNMASKED, type PiiMask } from '../../auth/pii.js';
import { checkRecordOf } from '../../jobs/records.js';
import { maskedTypeAttributes, maskVerificationResource } from '../../services/resources.js';
import { CONSOLE_SIGNAL_VIEW, servedInquirySignals } from '../../services/signals/served.js';

/** A verification as an inquiry's relationships name it. */
export interface VerificationRef {
  id: string;
  type: VerificationType;
}

/**
 * The inquiry with its Phase 2 attributes; `fields` values and the note are masked as `mask`
 * says (C15: a user without `pii:view` sees `null`).
 */
export function toInquiryResource(
  row: Inquiry,
  verificationRefs: readonly VerificationRef[],
  mask: PiiMask = UNMASKED,
  selfieCaptureIds?: readonly string[],
  listScreening: ListScreening | null = null,
  transactionId?: string | null,
): InquiryResource {
  // C90.8 (Workflow 7A): the console shows the signals whatever `expose-signals` says.
  const { signals, signalDetails } = servedInquirySignals(
    { inquiry: row, listScreening },
    CONSOLE_SIGNAL_VIEW,
  );
  // C235.7(a), C242.4 (integration-11a): a copy's provenance, as the server API serves it, so the
  // console can mark the clone.
  return withInquiryProvenance(
    buildInquiryResource({
      ...(selfieCaptureIds === undefined ? {} : { selfieCaptureIds }),
      // C105.7 (Workflow 7B): left out until `resolveTransactionRelationships` answers.
      ...(transactionId === undefined ? {} : { transactionId }),
      signals,
      signalDetails,
      id: row.id,
      status: row.status,
      referenceId: row.referenceId,
      fields: mask.fields(inquiryFieldsSchema.parse(row.fields)),
      inquiryTemplateId: row.inquiryTemplateId,
      inquiryTemplateVersionId: row.inquiryTemplateVersionId,
      verifications: verificationRefs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tags: row.tags,
      note: mask.note(row.note),
      expiresAt: row.expiresAt,
      redactedAt: row.redactedAt,
      decisionedAt: row.decisionedAt,
      accountId: row.accountId,
    }),
    row,
  );
}

/**
 * The verification with its checks and, for a government ID, its C31.5 extraction attributes,
 * for a Phase 5 type the C52.8 attributes its hook loaded, masked as `mask` says (C31.6, C53.7:
 * "Hidden" in the console without `pii:view`).
 */
export function toVerificationResource(
  row: VerificationWithChecks,
  fileIds: readonly string[],
  extraction: GovernmentIdExtraction | null = null,
  mask: PiiMask = UNMASKED,
  selfie?: SelfieVerificationDetails,
  attributes?: Readonly<Record<string, unknown>>,
  transactionId?: string | null,
): VerificationResource {
  return maskVerificationResource(
    buildVerificationResource({
      ...(selfie === undefined ? {} : { selfie }),
      // C105.7 (Workflow 7B): left out until `resolveTransactionRelationships` answers.
      ...(transactionId === undefined ? {} : { transactionId }),
      // C52.8, C53.7: a Phase 5 type's attributes, masked by its hook.
      ...(attributes === undefined
        ? {}
        : { attributes: maskedTypeAttributes(row.type, attributes, mask) }),
      id: row.id,
      type: row.type,
      status: row.status,
      inquiryId: row.inquiryId,
      fileIds,
      checks: row.checks.map(checkRecordOf),
      country: row.country,
      idClass: row.idClass,
      extraction:
        extraction === null
          ? null
          : { fields: extraction.fields, sources: extraction.fieldSources },
      fromRejectedHandoff: row.fromRejectedHandoff,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
    mask,
  );
}

/** File metadata only: the storage key, wrapped key and digest never leave the API. */
export function toFileResource(row: StoredFile, verification: VerificationRef): FileResource {
  return buildFileResource({
    id: row.id,
    kind: row.kind,
    mimeType: acceptedUploadMimeTypeSchema.parse(row.mimeType),
    byteSize: row.byteSize,
    createdAt: row.createdAt,
    // C153.2, C206.1, C206.2: client-reported (C206.3).
    captureMethod: row.captureMethod,
    captureTrigger: row.captureTrigger,
    verification,
  });
}

/**
 * The verifications of several inquiries, oldest first per inquiry, in one query (the list's
 * `relationships.verifications`), of every type (C50.6).
 */
export async function verificationRefsByInquiry(
  db: Db,
  environmentId: string,
  inquiryIds: readonly string[],
): Promise<Map<string, VerificationRef[]>> {
  const refs = new Map<string, VerificationRef[]>(inquiryIds.map((id) => [id, []]));
  if (inquiryIds.length === 0) {
    return refs;
  }
  const rows = await db
    .select({ id: verifications.id, type: verifications.type, inquiryId: verifications.inquiryId })
    .from(verifications)
    .where(
      and(
        eq(verifications.environmentId, environmentId),
        inArray(verifications.inquiryId, [...inquiryIds]),
      ),
    )
    .orderBy(asc(verifications.createdAt), asc(verifications.id));
  for (const { id, type, inquiryId } of rows) {
    refs.get(inquiryId)?.push({ id, type });
  }
  return refs;
}
