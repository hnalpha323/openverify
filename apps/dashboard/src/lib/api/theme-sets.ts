/**
 * Theme sets in the console (C160; Workflow 9C, `dashboard-themes-copy`): the environment's sets,
 * newest first, their revisions, the asset uploads (a logo, or a font under the operator's licence
 * attestation, decision 27), the default set (`default-theme-set-id`), and the refusal of the
 * contrast gate read from the API's problem. The API is the judge of every save: the editor's live
 * contrast is the same function (`checkPaletteContrast`), never a replacement for the 422.
 */
import 'server-only';
import {
  THEME_ASSET_LIMITS,
  themeAssetKindSchema,
  themeContrastProblemSchema,
  themeStylesSchema,
  type ThemeAssetKind,
  type ThemeSetStatus,
  type ThemeStyles,
} from '@openverify/contracts';
import { OpenVerifyApiError, type OpenVerifyClient, type ThemeAssetFile } from '@openverify/node';
import { ActionInputError, formString, parseInput } from './action';
import { updateSettings } from './settings';

export const THEME_SETS_PAGE_SIZE = 25;
export const THEME_REVISIONS_PAGE_SIZE = 20;

export interface ThemeSetFilters {
  readonly status?: ThemeSetStatus | undefined;
}

/** One pair the gate refused: token names, never colours; the ratio unrounded. */
export interface ContrastRefusalPair {
  readonly pointer: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly required: number;
}

export interface ThemeAssetUpload {
  readonly kind: ThemeAssetKind;
  readonly file: ThemeAssetFile;
  readonly licenceAttested: boolean;
  readonly unicodeRange?: string;
}

/** `GET /theme-sets`: one page, newest first, with `filter[status]`. */
export function listThemeSets(
  api: OpenVerifyClient,
  filters: ThemeSetFilters,
  after?: string,
): ReturnType<OpenVerifyClient['themeSets']['list']> {
  return api.themeSets.list({
    ...(filters.status === undefined ? {} : { filter: { status: [filters.status] } }),
    page: { size: THEME_SETS_PAGE_SIZE, ...(after === undefined ? {} : { after }) },
  });
}

/** `GET /theme-sets/:id/revisions`: newest first; `before` is a revision number. */
export function listThemeSetRevisions(
  api: OpenVerifyClient,
  id: string,
  before?: number,
): ReturnType<OpenVerifyClient['themeSets']['revisions']> {
  return api.themeSets.revisions(id, {
    page: { size: THEME_REVISIONS_PAGE_SIZE, ...(before === undefined ? {} : { before }) },
  });
}

/**
 * The editor's `styles` tree, sent as JSON in one hidden field, parsed by the contract's schema, so
 * a malformed cell is refused at its pointer before the API is called. The schema's messages name
 * the rule, never the value refused.
 * @throws {ActionInputError} for text that is not JSON or a tree the schema refuses.
 */
export function stylesFromForm(formData: FormData): ThemeStyles {
  let tree: unknown;
  try {
    tree = JSON.parse(formString(formData, 'styles', { trim: false }) ?? '{}');
  } catch {
    throw new ActionInputError({
      title: 'Check the values you entered',
      detail: 'The styles could not be read.',
      errors: [{ pointer: '/data/attributes/styles', detail: 'The styles could not be read.' }],
    });
  }
  return parseInput(themeStylesSchema, tree);
}

/**
 * The pairs of a 422 `theme_contrast_insufficient` (C160.4), or `null` for any other failure.
 * Each names its tokens and pointer, never a colour.
 */
export function contrastRefusalOf(error: unknown): readonly ContrastRefusalPair[] | null {
  if (!(error instanceof OpenVerifyApiError) || error.code !== 'theme_contrast_insufficient') {
    return null;
  }
  const parsed = themeContrastProblemSchema.safeParse(error.problem);
  return parsed.success ? parsed.data.pairs : null;
}

const ASSET_LIMITS: Readonly<Record<ThemeAssetKind, { bytes: number; words: string }>> = {
  logo: { bytes: THEME_ASSET_LIMITS['logo-bytes'], words: 'A logo is at most 256 KiB.' },
  font: { bytes: THEME_ASSET_LIMITS['font-bytes'], words: 'A font is at most 512 KiB.' },
};

function refuse(pointer: string, detail: string): never {
  throw new ActionInputError({
    title: 'Check the file you chose',
    detail,
    errors: [{ pointer, detail }],
  });
}

/**
 * An asset upload form: `kind` (`logo` or `font`), the `file`, and for a font the
 * `licence-attested` checkbox (decision 27: the operator confirms a licence that allows web
 * embedding; OpenVerify ships no font) with an optional `unicode-range`. The size is checked here,
 * the type by the API from the bytes (SVG answers 415 `asset_type_refused`).
 * @throws {ActionInputError} naming the field to correct.
 */
export async function assetUploadFromForm(formData: FormData): Promise<ThemeAssetUpload> {
  const kind = themeAssetKindSchema.safeParse(formString(formData, 'kind'));
  if (!kind.success) {
    refuse('/kind', 'Choose whether the file is a logo or a font.');
  }
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    refuse('/file', 'Choose a file to upload.');
  }
  const limit = ASSET_LIMITS[kind.data];
  if (file.size > limit.bytes) {
    refuse('/file', limit.words);
  }
  const licenceAttested = formString(formData, 'licence-attested') === 'on';
  if (kind.data === 'font' && !licenceAttested) {
    refuse(
      '/meta/licence-attested',
      'Confirm that your licence for this font allows embedding it in web pages.',
    );
  }
  const unicodeRange = formString(formData, 'unicode-range');
  return {
    kind: kind.data,
    file: {
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name === '' ? `${kind.data}.bin` : file.name,
      ...(file.type === '' ? {} : { mimeType: file.type }),
    },
    licenceAttested,
    ...(kind.data === 'font' && unicodeRange !== undefined && unicodeRange !== ''
      ? { unicodeRange }
      : {}),
  };
}

/** `POST /theme-sets/assets`: answers once a logo's rendition is stored (never a pending asset). */
export function uploadThemeAsset(
  api: OpenVerifyClient,
  upload: ThemeAssetUpload,
): ReturnType<OpenVerifyClient['themeSets']['uploadAsset']> {
  return api.themeSets.uploadAsset(upload.kind, upload.file, {
    ...(upload.kind === 'font' ? { licenceAttested: upload.licenceAttested } : {}),
    ...(upload.unicodeRange === undefined ? {} : { unicodeRange: upload.unicodeRange }),
  });
}

/** `PATCH /dashboard/settings` `default-theme-set-id`: a set, or `null` for the built-in theme. */
export function setDefaultThemeSet(id: string | null): Promise<unknown> {
  return updateSettings({ 'default-theme-set-id': id });
}
