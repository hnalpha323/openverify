/**
 * C135.1, C135.4, C135.5 (Workflow 8B (F)): the attachment routes' services. Owner `api-case-files`.
 *
 * - {@link uploadCaseAttachment}: `POST /cases/:id/attachments`, one multipart file part named `file`
 *   of at most 10 MiB, typed by its magic bytes and held to the pinned version's policy
 *   (`store.ts`), under `case-attachments` (60 a minute per principal, C143.3, following C12: 429 past
 *   it, through when the limiter cannot answer). The object is sealed and put before the case's
 *   transaction and deleted again if that transaction fails. The transaction locks the case (404 for a
 *   case the caller may not see, 410 `case_redacted`), writes the row and its history, moves
 *   `lock-version`, stages `case.updated` (an attribute change with no event of its own, C131.5) and
 *   records an audit entry that names no file. After the commit it asks for the scan (with a scanner
 *   bound) and the rendition.
 * - {@link getCaseAttachmentContent}: the rendition alone (a PDF's page `page`), needing `pii:view`
 *   beside the route's `cases:read`, served only as the scan allows (`scanning.ts`), audited per view
 *   before any byte is sent; 202 with Retry-After while it is made (asking for it again, so a request
 *   lost after an upload or a PATCH is made good), 422 `rendition_unavailable` when vision could not
 *   make it, 404 for a redacted attachment or case, an attachment of another case, or a page past the
 *   rendered ones.
 * - {@link getCaseAttachmentOriginal}: the sealed original, `cases:redact` and `pii:view`, under the
 *   same scan rule, audited (P23).
 *
 * A downloaded file is named by the server, `case-attachment-<id>.<ext>`; no client name reaches a
 * header.
 */
import type { CaseDocument, RenditionPendingDocument } from '@openverify/contracts';
import { CASE_LIMITS } from '@openverify/core';
import {
  getCaseAttachmentRow,
  listRenditionPages,
  updateCaseRow,
  type CaseAttachment,
} from '@openverify/db';
import {
  BadRequestError,
  NotFoundError,
  PayloadTooLargeError,
  PermissionDeniedError,
  RateLimitedError,
} from '../../../errors.js';
import { rateLimitRules } from '../../../plugins/rate-limit.js';
import { auditEntryOf, type ApiDependencies } from '../../context.js';
import { CaseProblemError } from '../problems.js';
import type { CaseActing } from '../service.js';
import { caseChange, lockWritableCase, requireVisibleCase } from '../shared.js';
import { emitCaseEvent } from '../writes.js';
import { caseFileAudit } from './audit.js';
import { ObjectUnreadableError, openSealedObject } from './objects.js';
import { requestAttachmentWork } from './patch.js';
import { caseDocumentWithAttachments } from './resources.js';
import { assertServable } from './scanning.js';
import { attachmentPolicyOf, sealAttachment, typedBytes, writeAttachmentInTx } from './store.js';

/**
 * The upload: the buffered multipart body (at most `CASE_ATTACHMENT_BODY_LIMIT_BYTES`, so
 * `Idempotency-Key` is honoured as for any buffered body) and its content type, whose boundary the
 * service reads. The service takes one file part and refuses anything else.
 */
export interface CaseAttachmentUpload {
  body: Uint8Array;
  contentType: string;
}

/** What a content route serves: the bytes with their type, or the pending answer. */
export type CaseAttachmentContent =
  | { kind: 'bytes'; bytes: Uint8Array; mediaType: string; filename: string }
  | { kind: 'pending'; document: RenditionPendingDocument; retryAfterSeconds: number };

const FILE_PART = 'file';

/** C135.3: how long a client waits before asking for a rendition again. */
export const RENDITION_RETRY_SECONDS = CASE_LIMITS['rendition-retry-seconds'].value;

/** The answer while a rendition is made. */
export const RENDITION_PENDING: Extract<CaseAttachmentContent, { kind: 'pending' }> = {
  kind: 'pending',
  document: {
    meta: { 'rendition-status': 'pending', 'retry-after-seconds': RENDITION_RETRY_SECONDS },
  },
  retryAfterSeconds: RENDITION_RETRY_SECONDS,
};

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** The name a downloaded file is saved under, made by the server. */
export const downloadName = (id: string, mediaType: string): string =>
  `case-attachment-${id}.${EXTENSIONS[mediaType] ?? 'bin'}`;

/** C143.3: `case-attachments`, 60 a minute per principal; 429 past it, through when unanswered. */
async function consumeAttachments(deps: Pick<ApiDependencies, 'rateLimiter'>, acting: CaseActing) {
  let decision;
  try {
    decision = await deps.rateLimiter.consume(
      `case-attachments:${acting.actor.id}`,
      rateLimitRules()['case-attachments'],
    );
  } catch {
    return;
  }
  if (!decision.allowed) {
    throw new RateLimitedError('Too many attachments; retry later.', decision.retryAfterSeconds);
  }
}

/** The one file part of a buffered multipart body. */
async function filePartOf(
  upload: CaseAttachmentUpload,
): Promise<{ bytes: Uint8Array; name: string }> {
  let form: FormData;
  try {
    const response = new Response(new Uint8Array(upload.body), {
      headers: { 'content-type': upload.contentType },
    });
    // The body is buffered and bounded by the route's body limit, so the platform parser's
    // buffering, the reason it is deprecated for servers, costs nothing here.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    form = await response.formData();
  } catch {
    throw new BadRequestError('The request body is not a multipart form.');
  }
  const entries = [...form.entries()];
  const [entry] = entries;
  if (entries.length !== 1 || entry?.[0] !== FILE_PART) {
    throw new BadRequestError(
      `The form takes one file part named "${FILE_PART}" and nothing else.`,
    );
  }
  const value = entry[1];
  if (typeof value === 'string') {
    throw new BadRequestError(`The part "${FILE_PART}" must be a file.`);
  }
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (bytes.byteLength > CASE_LIMITS['attachment-bytes'].value) {
    throw new PayloadTooLargeError('An attachment holds at most 10 MiB.');
  }
  return { bytes, name: value.name };
}

export async function uploadCaseAttachment(
  deps: ApiDependencies,
  acting: CaseActing,
  caseId: string,
  upload: CaseAttachmentUpload,
): Promise<CaseDocument> {
  const { environmentId } = acting.ctx;
  await consumeAttachments(deps, acting);
  const current = await requireVisibleCase(deps.db, acting, caseId);
  if (current.redactedAt !== null) {
    throw new CaseProblemError('case_redacted', `Case ${caseId} was redacted; it takes no file.`);
  }
  const { bytes, name } = await filePartOf(upload);
  const policy = await attachmentPolicyOf(deps.db, environmentId, current.caseTemplateVersionId);
  const { mediaType, type } = typedBytes(bytes, policy);
  const sealed = await sealAttachment(deps, environmentId, bytes);
  try {
    await caseChange(deps, acting, async (unit) => {
      await lockWritableCase(unit, caseId);
      const made = await writeAttachmentInTx(
        unit.tx,
        {
          environmentId,
          environmentKind: acting.environmentKind,
          caseId,
          policy,
          sealed,
          mediaType,
          filename: name,
          uploader: acting.actor,
          requestId: acting.ctx.requestId,
        },
        deps,
      );
      await updateCaseRow(unit.tx, environmentId, caseId, {
        updaterType: acting.actor.type,
        updaterId: acting.actor.id,
      });
      await emitCaseEvent(unit, caseId, 'case.updated');
      await unit.audit(
        caseFileAudit('case-attachment.uploaded', made.id, {
          'case-id': caseId,
          'attachment-type': type,
          'byte-size': made.byteSize,
        }),
      );
    });
  } catch (error) {
    await deps.storage.delete(sealed.storageKey).catch(() => undefined);
    throw error;
  }
  await requestAttachmentWork(deps, environmentId, [sealed.id]);
  return caseDocumentWithAttachments(deps, acting, caseId);
}

/** The attachment of a case the reader may see with `pii:view`, unredacted; 404 otherwise. */
async function readableAttachment(
  deps: ApiDependencies,
  acting: CaseActing,
  ids: { caseId: string; attachmentId: string },
): Promise<CaseAttachment> {
  if (!acting.mask.visible) {
    throw new PermissionDeniedError('An attachment is personal data: reading it needs pii:view.', [
      'pii:view',
    ]);
  }
  const found = await requireVisibleCase(deps.db, acting, ids.caseId);
  const attachment = await getCaseAttachmentRow(
    deps.db,
    acting.ctx.environmentId,
    ids.attachmentId,
  );
  if (
    attachment?.caseId !== ids.caseId ||
    found.redactedAt !== null ||
    attachment.redactedAt !== null ||
    attachment.storageKey === null ||
    attachment.wrappedDek === null
  ) {
    throw new NotFoundError('No attachment with this id is held by this case.');
  }
  return attachment;
}

/** Asks again for what an attachment is still waiting on; a failed request is the next one's. */
async function askAgain(
  deps: ApiDependencies,
  environmentId: string,
  attachment: CaseAttachment,
): Promise<void> {
  await requestAttachmentWork(deps, environmentId, [attachment.id]).catch(() => undefined);
}

export async function getCaseAttachmentContent(
  deps: ApiDependencies,
  acting: CaseActing,
  ids: { caseId: string; attachmentId: string },
  page: number,
): Promise<CaseAttachmentContent> {
  const { environmentId } = acting.ctx;
  const attachment = await readableAttachment(deps, acting, ids);
  if (attachment.scanStatus === 'pending') {
    await askAgain(deps, environmentId, attachment);
  }
  assertServable(attachment);
  switch (attachment.renditionStatus) {
    case 'pending':
      await askAgain(deps, environmentId, attachment);
      return RENDITION_PENDING;
    case 'failed':
      throw new CaseProblemError(
        'rendition_unavailable',
        'A rendition of this attachment could not be made.',
      );
    case 'deleted':
      throw new NotFoundError('No attachment with this id is held by this case.');
    case 'ready':
      break;
  }
  const found = (await listRenditionPages(deps.db, environmentId, attachment.id)).find(
    (candidate) => candidate.page === page,
  );
  if (found === undefined) {
    throw new NotFoundError('The rendition has no page of this number.');
  }
  const bytes = await opened(deps, {
    storageKey: found.storageKey,
    wrappedDek: found.wrappedDek,
    context: found.id,
  });
  await deps.audit.record(
    deps.db,
    auditOf(
      acting,
      caseFileAudit('case-attachment.viewed', attachment.id, {
        'case-id': ids.caseId,
        page,
      }),
    ),
  );
  return {
    kind: 'bytes',
    bytes,
    mediaType: found.mediaType,
    filename: downloadName(attachment.id, found.mediaType),
  };
}

export async function getCaseAttachmentOriginal(
  deps: ApiDependencies,
  acting: CaseActing,
  ids: { caseId: string; attachmentId: string },
): Promise<CaseAttachmentContent> {
  const attachment = await readableAttachment(deps, acting, ids);
  assertServable(attachment);
  const bytes = await opened(deps, {
    storageKey: attachment.storageKey ?? '',
    wrappedDek: attachment.wrappedDek ?? '',
    context: attachment.id,
    byteSize: attachment.byteSize,
    sha256: attachment.sha256,
  });
  await deps.audit.record(
    deps.db,
    auditOf(
      acting,
      caseFileAudit('case-attachment.original-viewed', attachment.id, {
        'case-id': ids.caseId,
      }),
    ),
  );
  return {
    kind: 'bytes',
    bytes,
    mediaType: attachment.mimeType,
    filename: downloadName(attachment.id, attachment.mimeType),
  };
}

/** An object's plaintext; one that is gone or altered reads as not available (404). */
async function opened(deps: ApiDependencies, object: Parameters<typeof openSealedObject>[1]) {
  try {
    return await openSealedObject(deps, object);
  } catch (error) {
    if (error instanceof ObjectUnreadableError) {
      throw new NotFoundError('The content of this attachment is not available.');
    }
    throw error;
  }
}

function auditOf(acting: CaseActing, action: ReturnType<typeof caseFileAudit>) {
  return auditEntryOf(acting.ctx, acting.actor, action);
}
