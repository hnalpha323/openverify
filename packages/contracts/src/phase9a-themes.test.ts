/**
 * Workflow 9A Stage 1a, (H): the theme-set resource, its routes, revisions and restore, the assets
 * with the operator's content route (C160.1-C160.3, C160.6), the theme problems, the inquiry's
 * `theme-set-id` (C160.7) and the palette the contrast gate of `@openverify/core` reads (C160.4).
 */
import { CONTRAST_PALETTE_TOKENS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { THEME_PALETTE_TOKENS } from './flow-theme.js';
import { createInquiryBodySchema, inquiryDocumentSchema } from './inquiries.js';
import {
  THEME_PROBLEM_CODES,
  THEME_PROBLEM_STATUSES,
  problemSchema,
  themeContrastProblemSchema,
} from './problem.js';
import { RESOURCE_TYPES } from './resource-types.js';
import { readFixture } from './test-support.js';
import {
  THEME_ASSET_FILE_FIELD,
  THEME_ASSET_LIMITS,
  THEME_ASSET_RESPONSE_HEADERS,
  THEME_ASSET_UPLOAD_MEDIA_TYPES,
  THEME_SET_STATUSES,
  buildThemeAssetResource,
  buildThemeSetResource,
  buildThemeSetRevisionResource,
  createThemeSetBodySchema,
  listThemeSetRevisionsQuerySchema,
  listThemeSetsQuerySchema,
  restoreThemeSetBodySchema,
  themeAssetContentParamsSchema,
  themeAssetDocumentSchema,
  themeSetDocumentSchema,
  themeSetListDocumentSchema,
  themeSetRevisionId,
  themeSetRevisionListDocumentSchema,
  updateThemeSetBodySchema,
  uploadThemeAssetFieldsSchema,
} from './theme-sets.js';

type Json = Record<string, unknown>;
const golden = (file: string): Json => structuredClone(readFixture(`api/${file}`)) as Json;
const attributesOf = (doc: Json) => (doc.data as Json).attributes as Json;
/** The `index`th object of a list member, failing the test when there is none. */
function itemOf(list: unknown, index: number): Json {
  const item = (list as Json[])[index];
  if (item === undefined) {
    throw new Error(`no item ${String(index)}`);
  }
  return item;
}
const SET = 'theset_01M5CN00000000000000009A40';
const USER = { type: 'user', id: 'usr_01M5CJXHG03PHEQZPRWAH2RXM5' } as const;

describe('theme sets (C160.1, C160.2)', () => {
  it.each([
    ['theme-set.json', themeSetDocumentSchema],
    ['theme-sets.json', themeSetListDocumentSchema],
    ['theme-set-revisions.json', themeSetRevisionListDocumentSchema],
    ['theme-asset.json', themeAssetDocumentSchema],
    ['theme-asset-font.json', themeAssetDocumentSchema],
  ] as const)('parses the golden %s', (file, schema) => {
    const doc = golden(file);
    expect((schema as z.ZodType).parse(doc)).toEqual(doc);
  });

  it('has an active or archived status, and archived-at exactly when archived', () => {
    expect(THEME_SET_STATUSES).toEqual(['active', 'archived']);
    const doc = golden('theme-set.json');
    attributesOf(doc)['archived-at'] = '2026-10-22T00:00:00.000Z';
    expect(themeSetDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('never makes an archived set the default (theme_set_default)', () => {
    const doc = golden('theme-sets.json');
    const archived = itemOf(doc.data, 1);
    (archived.attributes as Json)['is-default'] = true;
    expect(themeSetListDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('builds the resource from its record', () => {
    const doc = golden('theme-set.json');
    const attributes = attributesOf(doc);
    expect(
      buildThemeSetResource({
        id: SET,
        name: 'Storefront',
        status: 'active',
        styles: attributes.styles as never,
        revision: 3,
        isDefault: true,
        createdAt: new Date('2026-10-20T12:00:00.000Z'),
        updatedAt: new Date('2026-10-21T09:30:00.000Z'),
        archivedAt: null,
      }),
    ).toEqual(doc.data);
  });

  it('takes a name of 1 to 100 characters and sparse styles on create', () => {
    expect(
      createThemeSetBodySchema.safeParse({ data: { type: 'theme-set', attributes: { name: 'A' } } })
        .success,
    ).toBe(true);
    expect(
      createThemeSetBodySchema.safeParse({ data: { attributes: { name: 'x'.repeat(101) } } })
        .success,
    ).toBe(false);
    expect(
      createThemeSetBodySchema.safeParse({
        data: { attributes: { name: 'A', styles: { shape: { radius: 24 } } } },
      }).success,
    ).toBe(true);
  });

  it.each([
    ['a colour name', { light: { palette: { primary: 'red' } } }],
    ['an upper-case colour', { light: { palette: { primary: '#FFFFFF' } } }],
    ['a url()', { light: { palette: { primary: 'url(https://example.com/x)' } } }],
    ['a var()', { light: { palette: { ink: 'var(--x)' } } }],
    ['an unknown token', { light: { palette: { 'on-danger': '#ffffff' } } }],
    ['a radius past 24', { shape: { radius: 25 } }],
    ['an unknown cell', { motion: {} }],
  ])('refuses %s in the styles (400 with pointers)', (_name, styles) => {
    expect(updateThemeSetBodySchema.safeParse({ data: { attributes: { styles } } }).success).toBe(
      false,
    );
  });

  it('refuses an update with nothing to update', () => {
    expect(updateThemeSetBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(false);
    expect(
      updateThemeSetBodySchema.safeParse({ data: { attributes: { name: 'Renamed' } } }).success,
    ).toBe(true);
  });

  it('lists by status, newest first, with the caller environment only', () => {
    expect(listThemeSetsQuerySchema.parse({ 'filter[status]': 'active,archived' })).toEqual({
      'filter[status]': 'active,archived',
    });
    expect(listThemeSetsQuerySchema.safeParse({ 'filter[status]': 'deleted' }).success).toBe(false);
  });
});

describe('revisions and restore (C160.5)', () => {
  it('names a revision by its set and number', () => {
    expect(themeSetRevisionId(SET, 3)).toBe(`${SET}:3`);
    const doc = golden('theme-set-revisions.json');
    itemOf(doc.data, 0).id = `${SET}:4`;
    expect(themeSetRevisionListDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('builds a revision from its record', () => {
    const doc = golden('theme-set-revisions.json');
    const first = itemOf(doc.data, 0);
    expect(
      buildThemeSetRevisionResource({
        themeSetId: SET,
        revision: 3,
        name: 'Storefront',
        styles: (first.attributes as Json).styles as never,
        creator: USER,
        restoredFrom: 1,
        createdAt: new Date('2026-10-21T09:30:00.000Z'),
      }),
    ).toEqual(first);
  });

  it('pages revisions by number and restores one by meta.revision', () => {
    expect(listThemeSetRevisionsQuerySchema.parse({ 'page[before]': '3' })).toEqual({
      'page[before]': 3,
    });
    expect(listThemeSetRevisionsQuerySchema.safeParse({ 'page[after]': 'x' }).success).toBe(false);
    expect(restoreThemeSetBodySchema.safeParse({ meta: { revision: 1 } }).success).toBe(true);
    expect(restoreThemeSetBodySchema.safeParse({ meta: { revision: 0 } }).success).toBe(false);
    expect(restoreThemeSetBodySchema.safeParse({ meta: {} }).success).toBe(false);
  });
});

describe('assets (C160.6)', () => {
  it('limits a logo to 256 KiB and 2,048 px and a font to 512 KiB', () => {
    expect(THEME_ASSET_LIMITS).toEqual({
      'logo-bytes': 262_144,
      'logo-pixels': 2048,
      'font-bytes': 524_288,
    });
    expect(THEME_ASSET_UPLOAD_MEDIA_TYPES).toEqual({
      logo: ['image/png', 'image/jpeg', 'image/webp'],
      font: ['font/woff2'],
    });
  });

  it('builds both kinds from their records', () => {
    expect(
      buildThemeAssetResource({
        id: 'tsa_01M5CN00000000000000009A42',
        kind: 'logo',
        mediaType: 'image/png',
        byteSize: 18_342,
        width: 640,
        height: 160,
        licenceAttestation: null,
        unicodeRange: null,
        createdAt: new Date('2026-10-20T11:55:00.000Z'),
      }),
    ).toEqual(golden('theme-asset.json').data);
    expect(
      buildThemeAssetResource({
        id: 'tsa_01M5CN00000000000000009A43',
        kind: 'font',
        mediaType: 'font/woff2',
        byteSize: 48_210,
        width: null,
        height: null,
        licenceAttestation: { by: USER, at: new Date('2026-10-20T11:56:00.000Z') },
        unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153',
        createdAt: new Date('2026-10-20T11:56:00.000Z'),
      }),
    ).toEqual(golden('theme-asset-font.json').data);
  });

  it.each([
    ['a font without its attestation', 'theme-asset-font.json', { 'licence-attestation': null }],
    ['a font with a size', 'theme-asset-font.json', { width: 10, height: 10 }],
    ['a font stored as an image', 'theme-asset-font.json', { 'media-type': 'image/png' }],
    ['a logo with a unicode-range', 'theme-asset.json', { 'unicode-range': 'U+0000-00FF' }],
    ['a logo past 256 KiB', 'theme-asset.json', { 'byte-size': 262_145 }],
    ['a logo without a size', 'theme-asset.json', { width: null }],
    ['an SVG logo', 'theme-asset.json', { 'media-type': 'image/svg+xml' }],
    ['a WebP rendition (it becomes PNG)', 'theme-asset.json', { 'media-type': 'image/webp' }],
  ])('refuses %s', (_name, file, change) => {
    const doc = golden(file);
    Object.assign(attributesOf(doc), change);
    expect(themeAssetDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('uploads a font only with its licence attested, and a unicode-range only on a font', () => {
    expect(THEME_ASSET_FILE_FIELD).toBe('file');
    expect(uploadThemeAssetFieldsSchema.safeParse({ kind: 'logo' }).success).toBe(true);
    expect(uploadThemeAssetFieldsSchema.safeParse({ kind: 'font' }).success).toBe(false);
    expect(
      uploadThemeAssetFieldsSchema.safeParse({ kind: 'font', 'meta[licence-attested]': 'false' })
        .success,
    ).toBe(false);
    expect(
      uploadThemeAssetFieldsSchema.safeParse({
        kind: 'font',
        'meta[licence-attested]': 'true',
        'unicode-range': 'U+0600-06FF, U+FB50-FDFF',
      }).success,
    ).toBe(true);
    expect(
      uploadThemeAssetFieldsSchema.safeParse({ kind: 'logo', 'unicode-range': 'U+0000-00FF' })
        .success,
    ).toBe(false);
  });

  it.each(['U+0000-00FF; } body { color: red', 'url(x)', 'U+', 'u+0000'])(
    'refuses a unicode-range that is not one (%s)',
    (range) => {
      expect(
        uploadThemeAssetFieldsSchema.safeParse({
          kind: 'font',
          'meta[licence-attested]': 'true',
          'unicode-range': range,
        }).success,
      ).toBe(false);
    },
  );

  it('reads an asset by its id, as a download never cached for operators (review P17)', () => {
    expect(
      themeAssetContentParamsSchema.safeParse({ id: 'tsa_01M5CN00000000000000009A42' }).success,
    ).toBe(true);
    expect(
      themeAssetContentParamsSchema.safeParse({ id: 'file_01M5CN00000000000000009A42' }).success,
    ).toBe(false);
    expect(THEME_ASSET_RESPONSE_HEADERS).toEqual({
      operator: {
        'cache-control': 'private, no-store',
        'content-disposition': 'attachment',
        'x-content-type-options': 'nosniff',
      },
      flow: { 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' },
    });
  });
});

describe('the theme problems (C160.4, C160.6, C160.7)', () => {
  it('freezes the codes with their statuses', () => {
    expect(THEME_PROBLEM_STATUSES).toEqual({
      theme_contrast_insufficient: 422,
      theme_set_default: 409,
      asset_type_refused: 415,
    });
    expect(Object.isFrozen(THEME_PROBLEM_STATUSES)).toBe(true);
    expect(THEME_PROBLEM_CODES).toEqual(Object.keys(THEME_PROBLEM_STATUSES));
  });

  it('names each failing pair by its pointer, tokens, ratio and minimum, never a colour', () => {
    const raw = readFixture('problems/themes/theme-contrast-insufficient.json') as Json;
    expect(themeContrastProblemSchema.parse(raw)).toEqual(raw);
    expect(problemSchema.parse(raw)).toEqual(raw);
    const changed = structuredClone(raw);
    itemOf(changed.pairs, 0).foreground = '#4b5262';
    expect(themeContrastProblemSchema.safeParse(changed).success).toBe(false);
    expect(themeContrastProblemSchema.safeParse({ ...raw, pairs: [] }).success).toBe(false);
    const required = structuredClone(raw);
    itemOf(required.pairs, 0).required = 7;
    expect(themeContrastProblemSchema.safeParse(required).success).toBe(false);
  });
});

describe('the palette the contrast gate reads (C160.4)', () => {
  it('is the same twelve tokens in core and in the contracts', () => {
    expect([...CONTRAST_PALETTE_TOKENS]).toEqual([...THEME_PALETTE_TOKENS]);
  });
});

describe('the inquiry theme (C160.7) and the resource types', () => {
  it('takes theme-set-id on create, a theme set of the environment', () => {
    const body = (themeSetId: string) => ({
      data: {
        attributes: {
          'inquiry-template-id': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
          'theme-set-id': themeSetId,
        },
      },
    });
    expect(createInquiryBodySchema.safeParse(body(SET)).success).toBe(true);
    expect(createInquiryBodySchema.safeParse(body('tsa_01M5CN00000000000000009A42')).success).toBe(
      false,
    );
  });

  it('serves the inquiry theme-set-id, null when it has none', () => {
    const doc = structuredClone(readFixture('api/inquiry.json')) as Json;
    attributesOf(doc)['theme-set-id'] = SET;
    expect(inquiryDocumentSchema.safeParse(doc).success).toBe(true);
    attributesOf(doc)['theme-set-id'] = null;
    expect(inquiryDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('registers the theme resource types', () => {
    for (const type of ['theme-set', 'theme-set-revision', 'theme-asset']) {
      expect(RESOURCE_TYPES).toContain(type);
    }
  });
});
