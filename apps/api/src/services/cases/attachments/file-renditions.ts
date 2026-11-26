/**
 * C135.3 (Workflow 8B (F); decision 63, P38): an inquiry file's rendition for the console,
 * `GET /api/v1/dashboard/files/:id/rendition`, under the source file route's scopes (`inquiries:read`
 * and `pii:view`, which the route holds), cached sealed in `file_renditions` and `rendition_pages`.
 * Owner `api-case-files`.
 *
 * - A deleted or redacted source answers 404, and so does a kind no rendition is made of (the raw chip
 *   files) and a page past the rendered ones.
 * - A first request writes the rendition `pending` and enqueues it; while it is pending each request
 *   asks again and answers 202 with Retry-After, so a lost job is made good by the console's retry.
 * - One vision could not make answers 422 `rendition_unavailable`.
 * - Each view is audited as `file.viewed` before any byte is sent, naming the page; if the audit write
 *   fails, nothing is sent.
 */
import { FILE_VIEWED_AUDIT_ACTION, type AuditActor } from '@openverify/contracts';
import {
  getFile,
  getFileRendition,
  getInquiry,
  getVerification,
  listRenditionPages,
  requestFileRendition,
} from '@openverify/db';
import { NotFoundError } from '../../../errors.js';
import type { DashboardContext } from '../../../routes/dashboard/context.js';
import type { ServiceContext } from '../../../ports.js';
import { createAuditLogger } from '../../audit-log.js';
import { auditEntryOf } from '../../context.js';
import { CaseProblemError } from '../problems.js';
import { caseFileAudit } from './audit.js';
import { ObjectUnreadableError, openSealedObject } from './objects.js';
import { RENDERABLE_MEDIA_TYPES } from './renditions.js';
import { RENDITION_PENDING, type CaseAttachmentContent } from './service.js';

export interface FileRenditionRequest {
  /** The operator's tenant and request metadata, for the `file.viewed` entry. */
  ctx: ServiceContext;
  actor: AuditActor;
  fileId: string;
  page: number;
}

/** The DB-backed audit logger: the dashboard routes run with the dashboard context only. */
const audit = createAuditLogger();

const notFound = () => new NotFoundError('No rendition of this file can be served.');

export async function getFileRenditionContent(
  context: DashboardContext,
  request: FileRenditionRequest,
): Promise<CaseAttachmentContent> {
  const { db } = context;
  const { environmentId } = request.ctx;
  const file = await getFile(db, environmentId, request.fileId);
  if (file?.deletedAt !== null || !RENDERABLE_MEDIA_TYPES.has(file.mimeType)) {
    throw notFound();
  }
  const verification = await getVerification(db, environmentId, file.verificationId);
  const inquiry =
    verification === null ? null : await getInquiry(db, environmentId, verification.inquiryId);
  if (inquiry?.redactedAt !== null) {
    throw notFound();
  }
  const state =
    (await getFileRendition(db, environmentId, file.id)) ??
    (await requestFileRendition(db, environmentId, file.id));
  switch (state.status) {
    case 'pending':
      await context.caseRenditions
        ?.enqueueCaseRendition({ environmentId, sourceId: file.id })
        .catch(() => undefined);
      return RENDITION_PENDING;
    case 'failed':
      throw new CaseProblemError(
        'rendition_unavailable',
        'A rendition of this file could not be made.',
      );
    case 'deleted':
      throw notFound();
    case 'ready':
      break;
  }
  const page = (await listRenditionPages(db, environmentId, file.id)).find(
    (candidate) => candidate.page === request.page,
  );
  if (page === undefined) {
    throw notFound();
  }
  let bytes: Buffer;
  try {
    bytes = await openSealedObject(
      { storage: context.storage, keyring: context.keyring() },
      { storageKey: page.storageKey, wrappedDek: page.wrappedDek, context: page.id },
    );
  } catch (error) {
    if (error instanceof ObjectUnreadableError) {
      throw notFound();
    }
    throw error;
  }
  const viewed = caseFileAudit('file.viewed', file.id, {
    kind: file.kind,
    verificationId: file.verificationId,
    page: request.page,
    rendition: true,
  });
  await audit.record(
    db,
    auditEntryOf(request.ctx, request.actor, { ...viewed, action: FILE_VIEWED_AUDIT_ACTION }),
  );
  return {
    kind: 'bytes',
    bytes,
    mediaType: page.mediaType,
    filename: `${file.kind}-${file.id}.${page.mediaType === 'image/png' ? 'png' : 'jpg'}`,
  };
}
