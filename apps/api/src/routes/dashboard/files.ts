import { createHash } from 'node:crypto';
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  FILE_CONTENT_CACHE_CONTROL,
  FILE_KINDS_BY_VERIFICATION_TYPE,
  FILE_VIEWED_AUDIT_ACTION,
  SERVER_WRITTEN_FILE_KINDS,
  detectUploadMimeType,
  idSchema,
  type FileKind,
} from '@openverify/contracts';
import {
  decryptBytes,
  getFile,
  getInquiry,
  getVerification,
  type Db,
  type Keyring,
  type StoredFile,
} from '@openverify/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, RedactedError } from '../../errors.js';
import { problemResponses } from '../../plugins/openapi.js';
import { createAuditLogger } from '../../services/audit-log.js';
import { auditEntryOf } from '../../services/context.js';
import { dashboardContextOf, requireOperator, userActor } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/**
 * The raw image bytes. Fastify sends a Buffer unserialized; the dashboard swagger transform
 * documents image content as a binary string.
 */
const binaryImage = z.instanceof(Buffer);

/** C52.4: what the route serves: the images, and a PDF document as an attachment. */
const FILE_CONTENT_MEDIA_TYPES = [...ACCEPTED_IMAGE_MIME_TYPES, 'application/pdf'] as const;
type FileContentMediaType = (typeof FILE_CONTENT_MEDIA_TYPES)[number];

const SERVED_MEDIA_TYPES: ReadonlySet<string> = new Set(FILE_CONTENT_MEDIA_TYPES);

/**
 * C52.4, C66: the chip files a client uploads (the SOD and the data groups). The console shows a
 * chip read through its verification's attributes and the server-written `chip-portrait`, never
 * the raw files, so the route serves no content of these kinds.
 */
const RAW_CHIP_KINDS: ReadonlySet<FileKind> = new Set(
  FILE_KINDS_BY_VERIFICATION_TYPE.government_id_nfc.filter(
    (kind) => !(SERVER_WRITTEN_FILE_KINDS as readonly string[]).includes(kind),
  ),
);

/**
 * The name a downloaded file is saved under: made by the server from the file's kind and id, so
 * nothing a client sent reaches the header.
 */
const attachmentName = (file: StoredFile): string => `${file.kind}-${file.id}.pdf`;

/** Stored content that fails decryption or its integrity checks. Never shown to anyone. */
class FileIntegrityError extends AppError {
  override name = 'FileIntegrityError';

  constructor() {
    super({ status: 500, detail: 'The file content could not be verified.' });
  }
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The DB-backed audit logger: these routes run with the dashboard context only. */
const audit = createAuditLogger();

/**
 * Whether redaction took the file (C16): its object was deleted, or its inquiry is redacted
 * (which deletes the object, possibly not yet).
 */
async function isRedacted(db: Db, environmentId: string, file: StoredFile): Promise<boolean> {
  if (file.deletedAt !== null) {
    return true;
  }
  const verification = await getVerification(db, environmentId, file.verificationId);
  const inquiry =
    verification === null ? null : await getInquiry(db, environmentId, verification.inquiryId);
  return inquiry?.redactedAt != null;
}

/**
 * Decrypts a file's ciphertext and checks it against the record: AES-GCM authenticates the
 * whole object before any byte is released, then the plaintext must have the recorded size
 * and SHA-256 and be what its kind holds (C52.4, `detectUploadMimeType`: an image for a photo, an
 * image or a PDF for a document, a PNG for a server-written preview or chip portrait), of the
 * type its record names.
 */
function openFile(
  file: StoredFile,
  ciphertext: Uint8Array,
  keyring: Keyring,
): { bytes: Buffer; mimeType: FileContentMediaType } {
  let bytes: Buffer;
  try {
    bytes = decryptBytes({ wrappedDek: file.wrappedDek, ciphertext }, keyring, {
      context: file.id,
    });
  } catch {
    throw new FileIntegrityError();
  }
  const mimeType = detectUploadMimeType(file.kind, bytes);
  if (
    bytes.length !== file.byteSize ||
    sha256Hex(bytes) !== file.sha256 ||
    mimeType === null ||
    mimeType !== file.mimeType ||
    !SERVED_MEDIA_TYPES.has(mimeType)
  ) {
    bytes.fill(0);
    throw new FileIntegrityError();
  }
  return { bytes, mimeType: mimeType as FileContentMediaType };
}

/**
 * `GET /files/:id/content` (C4): the decrypted file, audited and never cached. It needs
 * `inquiries:read` and `pii:view` (C15), and answers 410 `redacted` after redaction (C16).
 * C52.4, C66: an image is served inline (a photo, a document photographed, the server-written
 * preview and chip portrait PNGs); a document's PDF as an attachment under a name the server makes,
 * so the console's browser downloads it and never renders it; the raw chip files not at all (404).
 * The content must be what its kind holds and its record names, else an opaque 500.
 */
export const fileRoutes: FastifyPluginAsyncZod<DashboardContext> = (
  app,
  { db, storage, keyring, operatorAuth },
) => {
  app.get(
    '/files/:id/content',
    {
      config: { scopes: ['inquiries:read', 'pii:view'] },
      schema: {
        summary: 'Download a file',
        description:
          'Decrypts the stored file and returns it with `Cache-Control: private, no-store`: an ' +
          'image (the server-written previews and chip portraits are PNG), or a PDF document ' +
          'as an attachment (`Content-Disposition: attachment` with a server-generated file ' +
          'name, C52.4). Needs `pii:view`. Every view is written to the audit log as ' +
          '`file.viewed`. A file removed by redaction answers 410. The raw chip files (the SOD ' +
          'and the data groups, C52.4) answer 404: the console shows the chip portrait instead.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: z.strictObject({ id: idSchema('file') }),
        response: {
          200: {
            description: 'The decrypted image, or the PDF document as an attachment.',
            content: Object.fromEntries(
              FILE_CONTENT_MEDIA_TYPES.map((type) => [type, { schema: binaryImage }]),
            ),
          },
          ...problemResponses(400, 401, 403, 404, 410, 500),
        },
      },
    },
    async (request, reply) => {
      // Set first, so error responses about this file are not cached either.
      void reply.header('cache-control', FILE_CONTENT_CACHE_CONTROL);
      const operator = requireOperator(request);
      const file = await getFile(db, operator.environmentId, request.params.id);
      if (file === null) {
        throw new AppError({ status: 404, detail: 'No file with this id exists.' });
      }
      if (await isRedacted(db, operator.environmentId, file)) {
        throw new RedactedError('This file was removed when its inquiry was redacted.');
      }
      if (RAW_CHIP_KINDS.has(file.kind)) {
        throw new AppError({ status: 404, detail: 'The console serves no content of chip files.' });
      }
      const ciphertext = await storage.get(file.storageKey);
      if (ciphertext === null) {
        request.log.error({ fileId: file.id }, 'file object is missing from storage');
        throw new AppError({ status: 404, detail: 'The content of this file is not available.' });
      }
      let content: ReturnType<typeof openFile>;
      try {
        content = openFile(file, ciphertext, keyring());
      } catch (error) {
        request.log.error({ fileId: file.id }, 'file content failed its integrity checks');
        throw error;
      }
      // The view is recorded before any byte is sent; if the audit write fails, nothing is.
      await audit.record(
        db,
        auditEntryOf(
          dashboardContextOf(request, operatorAuth, operator),
          userActor(operator.user.id),
          {
            action: FILE_VIEWED_AUDIT_ACTION,
            resourceType: 'file',
            resourceId: file.id,
            metadata: { kind: file.kind, verificationId: file.verificationId },
          },
        ),
      );
      if (content.mimeType === 'application/pdf') {
        // C52.4: a PDF is downloaded, never rendered in the console (research §1.4).
        void reply.header('content-disposition', `attachment; filename="${attachmentName(file)}"`);
      }
      return reply
        .code(200)
        .header('content-type', content.mimeType)
        .header('x-content-type-options', 'nosniff')
        .send(content.bytes);
    },
  );
  return Promise.resolve();
};
