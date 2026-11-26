/**
 * C52.8, C54.1: the `document` verification's attributes, from its extraction (C53.3), which the
 * job writes in its decision transaction: the class the checks established (`document-type`, one
 * of the five classes, `other` or `unknown`), its uncalibrated confidence, the page count and the
 * media type, and the extracted `fields` (PII: every C52.8 member, `null` when not read). Before
 * the job read the document, only the media type of the upload is known. Only what the contract
 * schema takes is served: an unknown stored member is left out and an invalid value is `null`.
 *
 * `fields` is masked member-wise for a principal without `pii:view` (C53.7) and is `null` once the
 * inquiry is redacted (C53.6); the class, confidence, pages and media type are not personal data
 * and stay.
 */
import { DOCUMENT_MIME_TYPES, documentFieldsSchema } from '@openverify/contracts';
import {
  getDocumentExtraction,
  listVerificationFiles,
  openDocumentExtractionFields,
  type Db,
  type VerificationWithChecks,
} from '@openverify/db';
import type { VerificationAttributeHook } from './index.js';

const MEDIA_TYPES: ReadonlySet<string> = new Set(DOCUMENT_MIME_TYPES);

/**
 * The stored `fields` as the contract takes them: every C52.8 member, `null` when not read or
 * when the stored value does not fit the member's schema; members the contract does not name are
 * left out.
 */
export function servedDocumentFields(
  stored: Readonly<Record<string, unknown>>,
): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(documentFieldsSchema.shape).map(([name, schema]) => {
      const parsed = schema.safeParse(Object.hasOwn(stored, name) ? stored[name] : null);
      return [name, parsed.success ? (parsed.data ?? null) : null];
    }),
  );
}

/** The media type of the verification's latest upload, before the job read it. */
async function uploadedMediaType(db: Db, verification: VerificationWithChecks) {
  const files = await listVerificationFiles(db, verification.environmentId, [verification.id]);
  const upload = files.filter((file) => file.kind === 'document').at(-1);
  return upload !== undefined && MEDIA_TYPES.has(upload.mimeType) ? upload.mimeType : null;
}

export const documentAttributes: VerificationAttributeHook = {
  async load(db, verification) {
    const { environmentId, id } = verification;
    const extraction = await getDocumentExtraction(db, environmentId, id);
    const fields =
      extraction === null ? null : await openDocumentExtractionFields(db, environmentId, id);
    return {
      'document-type': extraction?.documentType ?? null,
      'document-type-confidence': extraction?.typeConfidence ?? null,
      'page-count': extraction?.pageCount ?? null,
      'mime-type': extraction?.mimeType ?? (await uploadedMediaType(db, verification)),
      fields: fields === null ? null : servedDocumentFields(fields),
    };
  },
  mask: (attributes, mask) => mask.attributes(attributes),
};
