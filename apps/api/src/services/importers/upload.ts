/**
 * C100.1: an importer's upload, from either form of the create body: JSON with a base64 `file`, or
 * the raw multipart buffer, whose parts take the JSON names under `data[attributes][...]`. Owner:
 * `api-importers`.
 *
 * A multipart file must be a file part. A text field is decoded by the platform on the way here, so
 * a byte that is not UTF-8 would already be a replacement character and the strict decoder of
 * C100.2 would pass what it exists to refuse.
 */
import {
  createImporterBodySchema,
  IMPORT_LIMITS,
  type CreateImporterBody,
  type ImporterMode,
} from '@openverify/contracts';
import { BadRequestError, PayloadTooLargeError } from '../../errors.js';

/** A create body: the JSON document, or the buffered multipart body (`parseAs: 'buffer'`). */
export type ImporterBody = CreateImporterBody | Uint8Array;

export interface ImporterUpload {
  listId: string;
  mode: ImporterMode;
  /** The label as sent; the service reads its WHATWG name. */
  encoding: string;
  bytes: Uint8Array;
}

const PART_PREFIX = 'data[attributes][';
const FILE_PART = `${PART_PREFIX}file]`;
const DEFAULT_MODE: ImporterMode = 'all-or-nothing';
const DEFAULT_ENCODING = 'utf-8';

/** The form's text members, checked as the JSON body's are. */
const formAttributesSchema = createImporterBodySchema.shape.data.shape.attributes.omit({
  file: true,
});

async function readForm(body: Uint8Array, contentType: string): Promise<FormData> {
  try {
    const response = new Response(new Uint8Array(body), {
      headers: { 'content-type': contentType },
    });
    // The body is buffered and bounded by the route's body limit, so the platform parser's
    // buffering, the reason it is deprecated for servers, costs nothing here.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return await response.formData();
  } catch {
    throw new BadRequestError('The request body is not a multipart form.');
  }
}

async function uploadOfForm(body: Uint8Array, contentType: string): Promise<ImporterUpload> {
  const form = await readForm(body, contentType);
  const attributes: Record<string, string> = {};
  let file: File | null = null;
  for (const [name, value] of form.entries()) {
    if (name === FILE_PART && file === null && typeof value !== 'string') {
      file = value;
      continue;
    }
    const member = name.startsWith(PART_PREFIX) ? name.slice(PART_PREFIX.length, -1) : null;
    if (member === null || !name.endsWith(']') || typeof value !== 'string' || member in attributes) {
      throw new BadRequestError('The form holds a part this route does not take, or repeats one.');
    }
    attributes[member] = value;
  }
  if (file === null) {
    throw new BadRequestError(`The form needs a file part named ${FILE_PART}.`);
  }
  const parsed = formAttributesSchema.safeParse(attributes);
  if (!parsed.success) {
    throw new BadRequestError('The form’s list id, mode or encoding is not valid.');
  }
  return {
    listId: parsed.data['list-id'],
    mode: parsed.data.mode ?? DEFAULT_MODE,
    encoding: parsed.data.encoding ?? DEFAULT_ENCODING,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

function uploadOfJson({ data: { attributes } }: CreateImporterBody): ImporterUpload {
  return {
    listId: attributes['list-id'],
    mode: attributes.mode ?? DEFAULT_MODE,
    encoding: attributes.encoding ?? DEFAULT_ENCODING,
    bytes: Buffer.from(attributes.file, 'base64'),
  };
}

/**
 * The upload of a create body, either form.
 * @throws {BadRequestError} for a form this route does not take.
 * @throws {PayloadTooLargeError} past 20 MB: base64 rounds up, and a form's framing is not the file.
 */
export async function readImporterUpload(
  body: ImporterBody,
  contentType: string,
): Promise<ImporterUpload> {
  const upload =
    body instanceof Uint8Array ? await uploadOfForm(body, contentType) : uploadOfJson(body);
  if (upload.bytes.byteLength > IMPORT_LIMITS.fileBytes) {
    throw new PayloadTooLargeError('An imported file holds at most 20 MB.');
  }
  return upload;
}
