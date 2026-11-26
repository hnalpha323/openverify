/**
 * C160.6 (`api-themes`, Workflow 9B; decisions 27, 28; review F27): theme assets, environment-scoped.
 *
 * - A **logo** is PNG, JPEG or WebP by its bytes (never its declared type), at most 256 KiB and
 *   2,048 px a side, re-encoded **synchronously** through Phase 8's vision rendition endpoint (C135.3:
 *   a JPEG stays JPEG at quality 90, a PNG or WebP becomes PNG, the ICC profile and every metadata
 *   chunk dropped, an animation's first frame), so no metadata reaches a browser and no asset is
 *   ever pending: a busy or failed rendition answers 503 with `Retry-After`, a source vision cannot
 *   decode 415 `asset_type_refused`.
 * - A **font** is WOFF2 (`wOF2`, its header's length the file's), at most 512 KiB, uploaded by a user
 *   with `meta[licence-attested]=true`, recorded with the user and the time (OpenVerify ships none).
 * - SVG, and anything else, answers 415 `asset_type_refused`.
 *
 * Every asset is stored through `FileStorage` envelope-encrypted under its own id
 * (`theme_assets.wrapped_dek`, rewrap-listed by Workflow 9A). Operators read the stored bytes as an
 * attachment that is never cached; flows read them with their session token, cached for an hour.
 */
import { createHash } from 'node:crypto';
import {
  buildThemeAssetResource,
  detectImageMimeType,
  THEME_ASSET_FILE_FIELD,
  THEME_ASSET_LIMITS,
  uploadThemeAssetFieldsSchema,
  type LastUpdater,
  type ThemeAssetResource,
} from '@openverify/contracts';
import { encryptBytes, getInquiry, getInquiryTemplateVersion, type Db } from '@openverify/db';
import { isFlowV2, safeParseAnyFlow, type Component } from '@openverify/flow-spec';
import {
  AppError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnprocessableContentError,
} from '../../errors.js';
import type { VisionClient, VisionRendition } from '../../ports.js';
import { newStorageKey } from '../../storage/index.js';
import { VisionError } from '../../vision/index.js';
import { openSealedObject } from '../cases/attachments/objects.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import type { ThemeActing, ThemeAssetDocument } from './acting.js';
import { themeAudit } from './audit.js';
import { imageSizeOf } from './image-size.js';
import { ThemeProblemError } from './problems.js';
import { resolveThemeForSession } from './resolve.js';
import { getThemeAsset, insertThemeAssetInTx, type ThemeAssetRow } from './store.js';

/** What an upload reads: the request's dependencies, and the vision client when one is bound. */
export type ThemeAssetDeps = ApiDependencies & {
  vision?: Pick<VisionClient, 'createRendition'> | undefined;
};

/** The upload's buffered multipart body and its content type. */
export interface ThemeAssetUpload {
  body: Uint8Array;
  contentType: string;
}

/**
 * How long a client waits before asking again when the rendition lane is busy or vision is away
 * (provisional; basis: the lane runs one rendition and queues four, each a few seconds).
 */
export const THEME_RENDITION_RETRY_AFTER_SECONDS = 10;

const WOFF2_SIGNATURE = [0x77, 0x4f, 0x46, 0x32] as const;
/** The WOFF2 header: signature, flavor, then the whole file's length (big-endian). */
const WOFF2_HEADER_BYTES = 48;

/** A WOFF2 file by its header: the `wOF2` signature and the length it states. */
export function isWoff2(bytes: Uint8Array): boolean {
  if (bytes.byteLength < WOFF2_HEADER_BYTES) {
    return false;
  }
  if (!WOFF2_SIGNATURE.every((byte, at) => bytes[at] === byte)) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(8) === bytes.byteLength && view.getUint16(12) > 0;
}

const refused = () =>
  new ThemeProblemError(
    'asset_type_refused',
    'A theme asset is a PNG, JPEG or WebP logo or a WOFF2 font.',
  );

const fieldPointer = (path: readonly PropertyKey[]): string =>
  `/${path.map((segment) => String(segment)).join('/')}`;

/** The form's fields and its one file part. */
async function formOf(upload: ThemeAssetUpload) {
  let form: FormData;
  try {
    const response = new Response(new Uint8Array(upload.body), {
      headers: { 'content-type': upload.contentType },
    });
    // The body is buffered and bounded by the route's body limit (C160.6's 512 KiB and framing).
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    form = await response.formData();
  } catch {
    throw new BadRequestError('The request body is not a multipart form.');
  }
  const fields: Record<string, string> = {};
  let file: Uint8Array | null = null;
  for (const [name, value] of form.entries()) {
    if (name === THEME_ASSET_FILE_FIELD) {
      if (typeof value === 'string' || file !== null) {
        throw new BadRequestError(
          `The form takes one file part named "${THEME_ASSET_FILE_FIELD}".`,
        );
      }
      file = new Uint8Array(await value.arrayBuffer());
    } else if (typeof value === 'string' && !(name in fields)) {
      fields[name] = value;
    } else {
      throw new BadRequestError(`The form part "${name}" is not taken here.`);
    }
  }
  const parsed = uploadThemeAssetFieldsSchema.safeParse(fields);
  if (!parsed.success) {
    throw new AppError({
      status: 400,
      detail: 'The upload’s fields failed validation.',
      errors: parsed.error.issues.map((issue) => ({
        location: 'body',
        pointer: fieldPointer(issue.path),
        detail: issue.message,
      })),
    });
  }
  if (file === null || file.byteLength === 0) {
    throw new BadRequestError(`The form needs a file part named "${THEME_ASSET_FILE_FIELD}".`);
  }
  return { fields: parsed.data, file };
}

/** The stored form of a logo: vision's rendition, checked against the logo limits. */
async function renditionOf(
  deps: ThemeAssetDeps,
  bytes: Uint8Array,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
) {
  if (deps.vision === undefined) {
    throw unavailable();
  }
  let rendition: VisionRendition;
  try {
    rendition = await deps.vision.createRendition({ source: { bytes, mimeType } });
  } catch (error) {
    if (error instanceof VisionError) {
      if (error.retryable) {
        throw unavailable();
      }
      throw refused();
    }
    throw error;
  }
  const [page] = rendition.pages;
  if (rendition.source !== 'image' || page === undefined) {
    throw refused();
  }
  const limit = THEME_ASSET_LIMITS['logo-pixels'];
  if (page.width > limit || page.height > limit) {
    throw tooLargeLogo();
  }
  if (page.bytes.byteLength > THEME_ASSET_LIMITS['logo-bytes']) {
    throw new UnprocessableContentError('The re-encoded logo is larger than 256 KiB.', [
      { location: 'body', pointer: `/${THEME_ASSET_FILE_FIELD}`, detail: 'too large re-encoded' },
    ]);
  }
  return page;
}

function unavailable(): AppError {
  return new AppError({
    status: 503,
    detail: 'The logo could not be re-encoded now; retry later.',
    headers: { 'retry-after': String(THEME_RENDITION_RETRY_AFTER_SECONDS) },
  });
}

function tooLargeLogo(): UnprocessableContentError {
  return new UnprocessableContentError('A logo is at most 2,048 × 2,048 px.', [
    { location: 'body', pointer: `/${THEME_ASSET_FILE_FIELD}`, detail: 'at most 2,048 px a side' },
  ]);
}

/** What is stored: the bytes, their type and size, and a logo's size in pixels. */
interface Prepared {
  kind: 'logo' | 'font';
  mediaType: 'image/png' | 'image/jpeg' | 'font/woff2';
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
}

async function prepare(
  deps: ThemeAssetDeps,
  kind: 'logo' | 'font',
  file: Uint8Array,
): Promise<Prepared> {
  if (kind === 'font') {
    if (file.byteLength > THEME_ASSET_LIMITS['font-bytes']) {
      throw new PayloadTooLargeError('A font is at most 512 KiB.');
    }
    if (!isWoff2(file)) {
      throw refused();
    }
    return { kind, mediaType: 'font/woff2', bytes: file, width: null, height: null };
  }
  if (file.byteLength > THEME_ASSET_LIMITS['logo-bytes']) {
    throw new PayloadTooLargeError('A logo is at most 256 KiB.');
  }
  const sniffed = detectImageMimeType(file);
  if (sniffed !== 'image/png' && sniffed !== 'image/jpeg' && sniffed !== 'image/webp') {
    throw refused();
  }
  const size = imageSizeOf(file, sniffed);
  if (size === null) {
    throw refused();
  }
  const limit = THEME_ASSET_LIMITS['logo-pixels'];
  if (size.width > limit || size.height > limit) {
    throw tooLargeLogo();
  }
  const page = await renditionOf(deps, file, sniffed);
  return {
    kind,
    mediaType: page.mediaType,
    bytes: page.bytes,
    width: page.width,
    height: page.height,
  };
}

/** The resource of a stored asset. */
export function themeAssetResourceOf(row: ThemeAssetRow): ThemeAssetResource {
  return buildThemeAssetResource({
    id: row.id,
    kind: row.kind,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    licenceAttestation:
      row.licenceAttestedBy === null || row.licenceAttestedAt === null
        ? null
        : {
            by: { type: 'user', id: row.licenceAttestedBy } as LastUpdater,
            at: row.licenceAttestedAt,
          },
    unicodeRange: row.unicodeRange,
    createdAt: row.createdAt,
  });
}

/** Seals `bytes` under the asset id and puts the object; returns where it is. */
async function seal(
  deps: Pick<ApiDependencies, 'storage' | 'keyring'>,
  environmentId: string,
  id: string,
  bytes: Uint8Array,
) {
  const storageKey = newStorageKey(environmentId);
  const sealed = encryptBytes(bytes, deps.keyring, { context: id });
  await deps.storage.put(storageKey, sealed.ciphertext);
  return {
    storageKey,
    wrappedDek: sealed.wrappedDek,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * `POST /theme-sets/assets` (`theme-sets:write`; the route counts the `theme-assets` policy first).
 * @throws {ThemeProblemError} 415 `asset_type_refused` for anything but the accepted types.
 * @throws {ForbiddenError} for a font from an API key: a licence is attested by a user.
 * @throws {AppError} 503 with `Retry-After` while a logo's rendition cannot be made.
 */
export async function uploadThemeAsset(
  deps: ThemeAssetDeps,
  acting: ThemeActing,
  upload: ThemeAssetUpload,
): Promise<ThemeAssetDocument> {
  const { environmentId } = acting.ctx;
  const { fields, file } = await formOf(upload);
  if (fields.kind === 'font' && acting.userId === null) {
    throw new ForbiddenError(
      'A font’s licence is attested by a user (decision 27); an API key cannot upload one.',
    );
  }
  const prepared = await prepare(deps, fields.kind, file);
  const id = deps.ids.newId('tsa');
  const stored = await seal(deps, environmentId, id, prepared.bytes);
  try {
    const row = await deps.db.transaction(async (tx) => {
      const written = await insertThemeAssetInTx(tx, environmentId, {
        id,
        kind: prepared.kind,
        mediaType: prepared.mediaType,
        byteSize: prepared.bytes.byteLength,
        width: prepared.width,
        height: prepared.height,
        ...stored,
        licenceAttestedBy: prepared.kind === 'font' ? acting.userId : null,
        licenceAttestedAt: prepared.kind === 'font' ? deps.clock.now() : null,
        unicodeRange: prepared.kind === 'font' ? (fields['unicode-range'] ?? null) : null,
      });
      await deps.audit.record(
        tx,
        auditEntryOf(
          acting.ctx,
          acting.actor,
          themeAudit('theme-asset.created', id, {
            kind: written.kind,
            'media-type': written.mediaType,
            'byte-size': written.byteSize,
          }),
        ),
      );
      return written;
    });
    return { data: themeAssetResourceOf(row) };
  } catch (error) {
    // The row was never written, so its object is never read: removing it is housekeeping.
    await deps.storage.delete(stored.storageKey).catch(() => undefined);
    throw error;
  }
}

/** An asset's stored bytes and their type. */
export interface ThemeAssetContent {
  mediaType: string;
  bytes: Buffer;
}

async function contentOf(
  deps: Pick<ApiDependencies, 'db' | 'storage' | 'keyring'>,
  environmentId: string,
  id: string,
): Promise<ThemeAssetContent> {
  const row = await getThemeAsset(deps.db, environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Theme asset ${id} was not found.`);
  }
  const bytes = await openSealedObject(deps, {
    storageKey: row.storageKey,
    wrappedDek: row.wrappedDek,
    context: row.id,
    byteSize: row.byteSize,
    sha256: row.sha256,
  });
  return { mediaType: row.mediaType, bytes };
}

/**
 * `GET /theme-sets/assets/:id/content` (`theme-sets:read`, review P17): the stored bytes of an
 * asset of the caller's environment, which the route answers as an attachment never cached.
 * @throws {NotFoundError} outside the caller's environment.
 */
export function readOperatorThemeAsset(
  deps: Pick<ApiDependencies, 'db' | 'storage' | 'keyring'>,
  environmentId: string,
  id: string,
): Promise<ThemeAssetContent> {
  return contentOf(deps, environmentId, id);
}

/**
 * The asset ids of the `image` components of every screen of a pinned flow (C195.1; KP10-11),
 * nested ones included; none for a v1 flow, which has no screens.
 */
function screenImageAssetIds(flow: unknown): string[] {
  const parsed = safeParseAnyFlow(flow);
  if (!parsed.success || !isFlowV2(parsed.data)) {
    return [];
  }
  const ids: string[] = [];
  const walk = (components: readonly Component[]): void => {
    for (const component of components) {
      if (component.kind === 'image') {
        ids.push(component.assetId);
      }
      if ('children' in component) {
        walk(component.children);
      }
    }
  };
  for (const step of parsed.data.steps) {
    if (step.type === 'screen') {
      walk(step.components);
    }
  }
  return ids;
}

/**
 * The asset ids the session renders: those its theme names (C160.7: the inquiry's set, else its
 * version's, else the environment's default), its logo and an uploaded font, none for the built-in
 * theme; and (KP10-11, 10B decisions item 4) the image components' assets of its pinned version's
 * screens, which a screen shows as "a theme asset of the environment" (C160.6). Nothing else.
 */
async function sessionThemeAssetIds(
  db: Db,
  session: { environmentId: string; inquiryId: string },
): Promise<ReadonlySet<string>> {
  const inquiry = await getInquiry(db, session.environmentId, session.inquiryId);
  const version =
    inquiry === null
      ? null
      : await getInquiryTemplateVersion(
          db,
          session.environmentId,
          inquiry.inquiryTemplateVersionId,
        );
  if (inquiry === null || version === null) {
    return new Set();
  }
  const theme = await resolveThemeForSession(db, { inquiry, version });
  const ids = new Set<string>(screenImageAssetIds(version.flow));
  if (theme === null) {
    return ids;
  }
  if (theme.logo !== null) {
    ids.add(theme.logo['asset-id']);
  }
  if (theme.font.kind === 'uploaded') {
    ids.add(theme.font['asset-id']);
  }
  return ids;
}

/**
 * `GET /api/v1/flow/theme-assets/:id`: a logo or font of the theme the session renders (R002,
 * Workflow 10A), which the route answers `private, max-age=3600`. Any other asset, of this
 * environment or another, answers the unknown asset's 404, so nothing tells them apart.
 * @throws {NotFoundError} for an asset the session's theme does not name.
 */
export async function readFlowThemeAsset(
  deps: Pick<ApiDependencies, 'db' | 'storage' | 'keyring'>,
  session: { environmentId: string; inquiryId: string },
  id: string,
): Promise<ThemeAssetContent> {
  if (!(await sessionThemeAssetIds(deps.db, session)).has(id)) {
    throw new NotFoundError(`Theme asset ${id} was not found.`);
  }
  return contentOf(deps, session.environmentId, id);
}

/** Copies an asset into another environment under a new id, for C160.8's promote. */
export async function copyThemeAssetInTx(
  tx: Db,
  deps: Pick<ApiDependencies, 'storage' | 'keyring' | 'ids'>,
  source: ThemeAssetRow,
  targetEnvironmentId: string,
): Promise<ThemeAssetRow> {
  const bytes = await openSealedObject(deps, {
    storageKey: source.storageKey,
    wrappedDek: source.wrappedDek,
    context: source.id,
    byteSize: source.byteSize,
    sha256: source.sha256,
  });
  const id = deps.ids.newId('tsa');
  const stored = await seal(deps, targetEnvironmentId, id, bytes);
  bytes.fill(0);
  return insertThemeAssetInTx(tx, targetEnvironmentId, {
    id,
    kind: source.kind,
    mediaType: source.mediaType,
    byteSize: source.byteSize,
    width: source.width,
    height: source.height,
    ...stored,
    licenceAttestedBy: source.licenceAttestedBy,
    licenceAttestedAt: source.licenceAttestedAt,
    unicodeRange: source.unicodeRange,
  });
}
