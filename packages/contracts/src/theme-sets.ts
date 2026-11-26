/**
 * C160.1-C160.3, C160.6 (Workflow 9A Stage 1a, (H)): theme sets, their revisions and their assets,
 * frozen for `api-themes` (Workflow 9B), which builds them on `foundation-9a`'s plumbing. The styles
 * tree and the session theme are `flow-theme.ts`'s (defined with (T), because the preview carries
 * them). A theme set is environment-scoped (decision 24), so a sandbox key or an operator who holds
 * only sandbox roles never changes how production flows look. Nothing here is a person's data.
 *
 * Routes (public paths; scopes `theme-sets:read` and `theme-sets:write`): `GET /theme-sets` (newest
 * first, `filter[status]`), `POST /theme-sets`, `GET /theme-sets/:id`, `PATCH /theme-sets/:id` (an
 * omitted attribute is unchanged; `styles`, when sent, replaces the whole tree), `DELETE
 * /theme-sets/:id` (archives); ours `GET /theme-sets/:id/revisions`, `POST /theme-sets/:id/restore`
 * (`meta.revision`), `POST /theme-sets/assets` (multipart) and `GET /theme-sets/assets/:id/content`
 * (the operator's read of an asset's rendition, review P17). The flow reads an asset through
 * `GET /api/v1/flow/theme-assets/:id` (`flowThemeAssetParamsSchema`, `flow-embed.ts`).
 */
import { z } from 'zod';
import { themeStylesSchema } from './flow-theme.js';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  pageSizeSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import { lastUpdaterSchema, type LastUpdater } from './template-fields.js';
import type { ThemeStyles } from './flow-theme.js';

// Theme sets (C160.1, C160.5) ----------------------------------------------------------------

export const THEME_SET_STATUSES = ['active', 'archived'] as const;
export const themeSetStatusSchema = z.enum(THEME_SET_STATUSES);
export type ThemeSetStatus = z.infer<typeof themeSetStatusSchema>;

/** C160.1 (public): 1 to 100 characters. */
export const themeSetNameSchema = z.string().trim().min(1).max(100);

/**
 * C160.1: the public members, then ours, `revision` (the saved revision a flow renders, C160.5) and
 * `is-default` (the environment's `default-theme-set-id` names it). An archived set is never the
 * default (`theme_set_default`).
 */
export const themeSetAttributesSchema = z
  .strictObject({
    name: themeSetNameSchema,
    status: themeSetStatusSchema,
    styles: themeStylesSchema,
    revision: z.int().min(1),
    'is-default': z.boolean(),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
    'archived-at': timestampSchema.nullable(),
  })
  .refine((set) => (set.status === 'archived') === (set['archived-at'] !== null), {
    message: 'an archived set, and only an archived set, has archived-at',
    path: ['archived-at'],
  })
  .refine((set) => !(set.status === 'archived' && set['is-default']), {
    message: 'an archived set is never the default',
    path: ['is-default'],
  });
export type ThemeSetAttributes = z.infer<typeof themeSetAttributesSchema>;

export const themeSetResourceSchema = resourceSchema(
  'theme-set',
  'theset',
  themeSetAttributesSchema,
);
export type ThemeSetResource = z.infer<typeof themeSetResourceSchema>;

export const themeSetDocumentSchema = singleDocumentSchema(themeSetResourceSchema);
export const themeSetListDocumentSchema = listDocumentSchema(themeSetResourceSchema);

/** `GET /api/v1/theme-sets`: newest first, the caller's environment only. */
export const listThemeSetsQuerySchema = listQuerySchema('theset', {
  'filter[status]': filterListSchema(themeSetStatusSchema).optional(),
});
export type ListThemeSetsQuery = z.infer<typeof listThemeSetsQuerySchema>;

/** `POST /api/v1/theme-sets`: `styles` absent is the empty tree, so every cell is built in. */
export const createThemeSetBodySchema = requestDocumentSchema(
  'theme-set',
  z.strictObject({ name: themeSetNameSchema, styles: themeStylesSchema.optional() }),
);
export type CreateThemeSetBody = z.infer<typeof createThemeSetBodySchema>;

/**
 * `PATCH /api/v1/theme-sets/:id` (public): an omitted attribute is unchanged; `styles` replaces the
 * whole tree. Each save is a new revision once the contrast gate passes (C160.4, C160.5).
 */
export const updateThemeSetBodySchema = requestDocumentSchema(
  'theme-set',
  z
    .strictObject({ name: themeSetNameSchema.optional(), styles: themeStylesSchema.optional() })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateThemeSetBody = z.infer<typeof updateThemeSetBodySchema>;

/** `POST /api/v1/theme-sets/:id/restore` (ours): a new revision with an earlier one's content. */
export const restoreThemeSetBodySchema = z.strictObject({
  meta: z.strictObject({ revision: z.int().min(1) }),
});
export type RestoreThemeSetBody = z.infer<typeof restoreThemeSetBodySchema>;

// Revisions (C160.5) -------------------------------------------------------------------------

const ULID_BODY = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const REVISION_ID = new RegExp(`^theset_${ULID_BODY}:[1-9][0-9]{0,8}$`);

/** A revision's id: its set's id and its number, `theset_…:<n>`. */
export function themeSetRevisionId(themeSetId: string, revision: number): string {
  return `${themeSetId}:${String(revision)}`;
}

/**
 * C160.5 (ours): each save is an immutable revision, kept for audit and restore. `restored-from`
 * names the revision a restore copied, `null` for an edit.
 */
export const themeSetRevisionAttributesSchema = z.strictObject({
  revision: z.int().min(1),
  name: themeSetNameSchema,
  styles: themeStylesSchema,
  creator: lastUpdaterSchema,
  'restored-from': z.int().min(1).nullable(),
  'created-at': timestampSchema,
});

export const themeSetRevisionResourceSchema = z
  .strictObject({
    type: z.literal('theme-set-revision'),
    id: z.string().regex(REVISION_ID, 'must be <theme set id>:<revision>'),
    attributes: themeSetRevisionAttributesSchema,
  })
  .refine((resource) => resource.id.endsWith(`:${String(resource.attributes.revision)}`), {
    message: 'the id ends with the revision',
    path: ['id'],
  });
export type ThemeSetRevisionResource = z.infer<typeof themeSetRevisionResourceSchema>;

export const themeSetRevisionListDocumentSchema = listDocumentSchema(
  themeSetRevisionResourceSchema,
);

/** `GET /api/v1/theme-sets/:id/revisions`: newest first; `page[before]` is a revision number. */
export const listThemeSetRevisionsQuerySchema = z.strictObject({
  'page[before]': z.coerce.number().int().min(2).optional(),
  'page[size]': pageSizeSchema.optional(),
});
export type ListThemeSetRevisionsQuery = z.infer<typeof listThemeSetRevisionsQuerySchema>;

// Assets (C160.6) ----------------------------------------------------------------------------

export const THEME_ASSET_KINDS = ['logo', 'font'] as const;
export const themeAssetKindSchema = z.enum(THEME_ASSET_KINDS);
export type ThemeAssetKind = z.infer<typeof themeAssetKindSchema>;

/**
 * C160.6: a logo is PNG, JPEG or WebP by its bytes, at most 256 KiB and 2,048 px a side; a font is
 * WOFF2 (`wOF2`), at most 512 KiB. SVG, and anything else, answers 415 `asset_type_refused`.
 */
export const THEME_ASSET_LIMITS = Object.freeze({
  'logo-bytes': 262_144,
  'logo-pixels': 2048,
  'font-bytes': 524_288,
} as const);

/** The upload types accepted by their bytes, per kind. */
export const THEME_ASSET_UPLOAD_MEDIA_TYPES = Object.freeze({
  logo: Object.freeze(['image/png', 'image/jpeg', 'image/webp'] as const),
  font: Object.freeze(['font/woff2'] as const),
});

/**
 * What is stored and served: the rendition of a logo (a JPEG stays JPEG, a PNG or WebP becomes
 * PNG; metadata dropped; Stage 1a amendment 23 of the 8B rendition endpoint) and a font's bytes.
 */
export const THEME_ASSET_MEDIA_TYPES = ['image/png', 'image/jpeg', 'font/woff2'] as const;

/**
 * A CSS `unicode-range` (C160.6), so Arabic never renders in a Latin-only face: comma-separated
 * `U+` code points, ranges or wildcards only, which a `FontFace` descriptor takes as it is.
 */
export const unicodeRangeSchema = z
  .string()
  .max(2000)
  .regex(
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    /^U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?(?:, ?U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)*$/,
    'must be a CSS unicode-range',
  );

/** C160.6, decision 27: who confirmed that the font's licence allows web embedding, and when. */
export const themeAssetLicenceAttestationSchema = z.strictObject({
  by: lastUpdaterSchema,
  at: timestampSchema,
});

export const themeAssetAttributesSchema = z
  .strictObject({
    kind: themeAssetKindSchema,
    'media-type': z.enum(THEME_ASSET_MEDIA_TYPES),
    'byte-size': z.int().min(1).max(THEME_ASSET_LIMITS['font-bytes']),
    /** A logo's rendition in px; `null` for a font. */
    width: z.int().min(1).max(THEME_ASSET_LIMITS['logo-pixels']).nullable(),
    height: z.int().min(1).max(THEME_ASSET_LIMITS['logo-pixels']).nullable(),
    /** A font's attestation; `null` for a logo. */
    'licence-attestation': themeAssetLicenceAttestationSchema.nullable(),
    'unicode-range': unicodeRangeSchema.nullable(),
    'created-at': timestampSchema,
  })
  .superRefine((asset, ctx) => {
    const font = asset.kind === 'font';
    if (font !== (asset['media-type'] === 'font/woff2')) {
      ctx.addIssue({
        code: 'custom',
        message: 'a font is WOFF2, a logo an image',
        path: ['media-type'],
      });
    }
    if (font !== (asset['licence-attestation'] !== null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'a font, and only a font, carries its licence attestation',
        path: ['licence-attestation'],
      });
    }
    if (font === (asset.width !== null) || font === (asset.height !== null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'a logo, and only a logo, has a size',
        path: ['width'],
      });
    }
    if (!font && asset['unicode-range'] !== null) {
      ctx.addIssue({
        code: 'custom',
        message: 'only a font has a unicode-range',
        path: ['unicode-range'],
      });
    }
    if (!font && asset['byte-size'] > THEME_ASSET_LIMITS['logo-bytes']) {
      ctx.addIssue({ code: 'custom', message: 'a logo is at most 256 KiB', path: ['byte-size'] });
    }
  });
export type ThemeAssetAttributes = z.infer<typeof themeAssetAttributesSchema>;

export const themeAssetResourceSchema = resourceSchema(
  'theme-asset',
  'tsa',
  themeAssetAttributesSchema,
);
export type ThemeAssetResource = z.infer<typeof themeAssetResourceSchema>;
export const themeAssetDocumentSchema = singleDocumentSchema(themeAssetResourceSchema);

/** The multipart part that carries the bytes of `POST /api/v1/theme-sets/assets`. */
export const THEME_ASSET_FILE_FIELD = 'file';

/**
 * The other multipart fields of `POST /api/v1/theme-sets/assets` (`theme-sets:write`). A font needs
 * `meta[licence-attested]` `true` (decision 27; OpenVerify ships no font); the upload answers only
 * once a logo's rendition is stored, so no asset is ever pending (review F27).
 */
export const uploadThemeAssetFieldsSchema = z
  .strictObject({
    kind: themeAssetKindSchema,
    'unicode-range': unicodeRangeSchema.optional(),
    'meta[licence-attested]': z.enum(['true', 'false']).optional(),
  })
  .superRefine((fields, ctx) => {
    if (fields.kind === 'font' && fields['meta[licence-attested]'] !== 'true') {
      ctx.addIssue({
        code: 'custom',
        message: 'a font is uploaded with its licence attested',
        path: ['meta[licence-attested]'],
      });
    }
    if (fields.kind === 'logo' && fields['unicode-range'] !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'only a font has a unicode-range',
        path: ['unicode-range'],
      });
    }
  });
export type UploadThemeAssetFields = z.infer<typeof uploadThemeAssetFieldsSchema>;

/** `GET /api/v1/theme-sets/assets/:id/content` (`theme-sets:read`, same environment; review P17). */
export const themeAssetContentParamsSchema = z.strictObject({ id: idSchema('tsa') });

/**
 * C160.6: the response headers of the two asset reads. The operator's read is a download that is
 * never cached; the flow's is private and cached for an hour. Both are `nosniff`.
 */
export const THEME_ASSET_RESPONSE_HEADERS = Object.freeze({
  operator: Object.freeze({
    'cache-control': 'private, no-store',
    'content-disposition': 'attachment',
    'x-content-type-options': 'nosniff',
  }),
  flow: Object.freeze({
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
  }),
});

// Builders -----------------------------------------------------------------------------------

export interface ThemeSetRecord {
  id: string;
  name: string;
  status: ThemeSetStatus;
  styles: ThemeStyles;
  revision: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

/**
 * Builds the theme-set resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildThemeSetResource(record: ThemeSetRecord): ThemeSetResource {
  return themeSetResourceSchema.parse({
    type: 'theme-set',
    id: record.id,
    attributes: {
      name: record.name,
      status: record.status,
      styles: record.styles,
      revision: record.revision,
      'is-default': record.isDefault,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'archived-at': toNullableTimestamp(record.archivedAt),
    },
  });
}

export interface ThemeSetRevisionRecord {
  themeSetId: string;
  revision: number;
  name: string;
  styles: ThemeStyles;
  creator: LastUpdater;
  restoredFrom: number | null;
  createdAt: Date;
}

/**
 * Builds a theme-set revision resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildThemeSetRevisionResource(
  record: ThemeSetRevisionRecord,
): ThemeSetRevisionResource {
  return themeSetRevisionResourceSchema.parse({
    type: 'theme-set-revision',
    id: themeSetRevisionId(record.themeSetId, record.revision),
    attributes: {
      revision: record.revision,
      name: record.name,
      styles: record.styles,
      creator: record.creator,
      'restored-from': record.restoredFrom,
      'created-at': toTimestamp(record.createdAt),
    },
  });
}

export interface ThemeAssetRecord {
  id: string;
  kind: ThemeAssetKind;
  mediaType: (typeof THEME_ASSET_MEDIA_TYPES)[number];
  byteSize: number;
  width: number | null;
  height: number | null;
  licenceAttestation: { by: LastUpdater; at: Date } | null;
  unicodeRange: string | null;
  createdAt: Date;
}

/**
 * Builds the theme-asset resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildThemeAssetResource(record: ThemeAssetRecord): ThemeAssetResource {
  return themeAssetResourceSchema.parse({
    type: 'theme-asset',
    id: record.id,
    attributes: {
      kind: record.kind,
      'media-type': record.mediaType,
      'byte-size': record.byteSize,
      width: record.width,
      height: record.height,
      'licence-attestation':
        record.licenceAttestation === null
          ? null
          : { by: record.licenceAttestation.by, at: toTimestamp(record.licenceAttestation.at) },
      'unicode-range': record.unicodeRange,
      'created-at': toTimestamp(record.createdAt),
    },
  });
}
