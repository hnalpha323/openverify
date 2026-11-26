/**
 * `dashboard-themes-copy`'s mock routes and documents (Workflow 9C, C160, C162): theme sets, their
 * revisions and assets, the settings' `default-theme-set-id`, and a template's translations,
 * registered on a `routeApi()` the test made. Paths are after `/api/v1`; every value is synthetic.
 */
import { DASHBOARD_SETTINGS_DEFAULTS } from '@openverify/contracts';
import type {
  DashboardSettings,
  InquiryTemplateResource,
  InquiryTemplateTranslationsDocument,
  InquiryTemplateVersionResource,
  ThemeAssetResource,
  ThemeSetResource,
  ThemeSetRevisionResource,
  ThemeStyles,
  TranslationRow,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { CREATED_AT, UPDATED_AT } from '../api-fixtures';
import type { RouteApi } from '../api-routes';
import { problemDocument } from '../api-mock';

export const THEME_SETS_PATH = '/theme-sets';
export const THEME_ASSETS_PATH = '/theme-sets/assets';

export const THEME_IDS = {
  set: 'theset_01J9ZK3M5Q7R8S9T0V1W2X3T01',
  otherSet: 'theset_01J9ZK3M5Q7R8S9T0V1W2X3T02',
  archivedSet: 'theset_01J9ZK3M5Q7R8S9T0V1W2X3T03',
  logo: 'tsa_01J9ZK3M5Q7R8S9T0V1W2X3T04',
  font: 'tsa_01J9ZK3M5Q7R8S9T0V1W2X3T05',
  template: 'itmpl_01J9ZK3M5Q7R8S9T0V1W2X3T06',
  version: 'itmplv_01J9ZK3M5Q7R8S9T0V1W2X3T07',
  draft: 'itmplv_01J9ZK3M5Q7R8S9T0V1W2X3T08',
  user: 'usr_01J9ZK3M5Q7R8S9T0V1W2X3T09',
} as const;

/** A theme editor: the theme scopes and the settings write the default set needs. */
export const THEME_EDITOR: readonly Permission[] = [
  'theme-sets:read',
  'theme-sets:write',
  'settings:read',
  'settings:write',
];
/** A viewer: the read only. */
export const THEME_VIEWER: readonly Permission[] = ['theme-sets:read'];
/** A template translator: the template scopes. */
export const COPY_EDITOR: readonly Permission[] = [
  'inquiry-templates:read',
  'inquiry-templates:write',
  'theme-sets:read',
];

export interface ThemeSetOptions {
  readonly id?: string;
  readonly name?: string;
  readonly status?: 'active' | 'archived';
  readonly styles?: ThemeStyles;
  readonly revision?: number;
  readonly isDefault?: boolean;
}

/** A synthetic theme set; `archived-at` follows its status, as the contract holds it. */
export function themeSetResource(options: ThemeSetOptions = {}): ThemeSetResource {
  const status = options.status ?? 'active';
  return {
    type: 'theme-set',
    id: options.id ?? THEME_IDS.set,
    attributes: {
      name: options.name ?? 'Synthetic Brand',
      status,
      styles: options.styles ?? {},
      revision: options.revision ?? 1,
      'is-default': status === 'active' && (options.isDefault ?? false),
      'created-at': CREATED_AT,
      'updated-at': UPDATED_AT,
      'archived-at': status === 'archived' ? UPDATED_AT : null,
    },
  };
}

/** A revision of `setId`; `restoredFrom` names the revision a restore copied. */
export function themeSetRevisionResource(
  revision: number,
  options: { setId?: string; styles?: ThemeStyles; restoredFrom?: number | null } = {},
): ThemeSetRevisionResource {
  const setId = options.setId ?? THEME_IDS.set;
  return {
    type: 'theme-set-revision',
    id: `${setId}:${String(revision)}`,
    attributes: {
      revision,
      name: 'Synthetic Brand',
      styles: options.styles ?? {},
      creator: { type: 'user', id: THEME_IDS.user },
      'restored-from': options.restoredFrom ?? null,
      'created-at': CREATED_AT,
    },
  };
}

/** A stored logo (its PNG rendition) or a font with its attestation. */
export function themeAssetResource(kind: 'logo' | 'font' = 'logo'): ThemeAssetResource {
  return kind === 'logo'
    ? {
        type: 'theme-asset',
        id: THEME_IDS.logo,
        attributes: {
          kind: 'logo',
          'media-type': 'image/png',
          'byte-size': 2048,
          width: 120,
          height: 40,
          'licence-attestation': null,
          'unicode-range': null,
          'created-at': CREATED_AT,
        },
      }
    : {
        type: 'theme-asset',
        id: THEME_IDS.font,
        attributes: {
          kind: 'font',
          'media-type': 'font/woff2',
          'byte-size': 4096,
          width: null,
          height: null,
          'licence-attestation': { by: { type: 'user', id: THEME_IDS.user }, at: CREATED_AT },
          'unicode-range': null,
          'created-at': CREATED_AT,
        },
      };
}

export function serveThemeSets(
  api: RouteApi,
  sets: readonly ThemeSetResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', THEME_SETS_PATH, 200, { data: sets, links: { next } });
}

export function serveThemeSet(api: RouteApi, set: ThemeSetResource): RouteApi {
  return api.on('GET', `${THEME_SETS_PATH}/${set.id}`, 200, { data: set });
}

export function serveThemeSetRevisions(
  api: RouteApi,
  setId: string,
  revisions: readonly ThemeSetRevisionResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', `${THEME_SETS_PATH}/${setId}/revisions`, 200, {
    data: revisions,
    links: { next },
  });
}

/** The 422 `theme_contrast_insufficient` of `PATCH` or `POST`, with its pairs (synthetic ratios). */
export function contrastProblem(
  pairs: readonly {
    pointer: string;
    foreground: string;
    background: string;
    ratio: number;
    required: number;
  }[],
): Record<string, unknown> {
  return problemDocument(422, undefined, {
    title: 'Unprocessable Content',
    detail: 'A palette pair is below its contrast minimum.',
    code: 'theme_contrast_insufficient',
    pairs,
  });
}

/** A translation row of a built-in key (no step) or of a screen component. */
export function translationRow(
  attribute: string,
  values: Readonly<Record<string, string>>,
  where: { step: string; component: string; stepName?: string } | null = null,
): TranslationRow {
  return {
    step: where?.step ?? null,
    'step-display-name': where === null ? null : (where.stepName ?? null),
    component: where?.component ?? null,
    'attribute-name': attribute,
    'locale-values': Object.entries(values).map(([locale, value]) => ({
      locale: locale as TranslationRow['locale-values'][number]['locale'],
      value,
    })),
  };
}

export function translationsDocument(
  rows: readonly TranslationRow[],
  versionId: string = THEME_IDS.draft,
  templateId: string = THEME_IDS.template,
): InquiryTemplateTranslationsDocument {
  return {
    data: {
      type: 'inquiry-template-translations',
      id: templateId,
      attributes: { 'inquiry-template-version-id': versionId, translations: [...rows] },
    },
  };
}

export const translationsPath = (templateId: string = THEME_IDS.template) =>
  `/inquiry-templates/${templateId}/translations`;

export function serveTranslations(
  api: RouteApi,
  rows: readonly TranslationRow[],
  templateId: string = THEME_IDS.template,
): RouteApi {
  return api.on('GET', translationsPath(templateId), 200, translationsDocument(rows));
}

/**
 * A template and its versions as the theme and translations tabs read them: `GET
 * /inquiry-templates/:id`, the version list (filtered by `filter[status]` when sent) and each
 * version, with a synthetic strong ETag on every version read.
 */
export function serveTemplateWithVersions(
  api: RouteApi,
  template: InquiryTemplateResource,
  versions: readonly InquiryTemplateVersionResource[],
): RouteApi {
  api.on('GET', `/inquiry-templates/${template.id}`, 200, { data: template });
  api.handle('GET', '/inquiry-template-versions', (request) => {
    const status = request.query.get('filter[status]');
    return {
      status: 200,
      body: {
        data: versions.filter((each) => status === null || each.attributes.status === status),
        links: { next: null },
      },
    };
  });
  for (const each of versions) {
    api.on(
      'GET',
      `/inquiry-template-versions/${each.id}`,
      200,
      { data: each },
      { etag: VERSION_ETAG },
    );
  }
  return api;
}

/** A synthetic strong ETag (C154.3). */
export const VERSION_ETAG = `"${'a'.repeat(64)}"`;

/** `GET /dashboard/settings`: the defaults, with the organisation's display name. */
export function serveSettings(api: RouteApi, overrides: Partial<DashboardSettings> = {}): RouteApi {
  return api.on('GET', '/dashboard/settings', 200, {
    ...DASHBOARD_SETTINGS_DEFAULTS,
    'organization-display-name': 'Synthetic Org',
    ...overrides,
  });
}
