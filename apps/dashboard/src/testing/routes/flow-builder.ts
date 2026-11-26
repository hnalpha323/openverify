/**
 * `dashboard-flow-builder`'s own mock routes (C154, C155; Workflow 9C), registered on a
 * `routeApi()` the test made. Paths are after `/api/v1`; every value is synthetic.
 */
import {
  templateVersionDiffDocumentSchema,
  type InquiryTemplateVersionResource,
} from '@openverify/contracts';
import type { TemplateVersionDiff } from '../../lib/api/inquiry-template-versions';
import type { RouteApi } from '../api-routes';

/** A strong ETag as the API serves one: a quoted SHA-256 (C154.3). */
export function syntheticEtag(seed: string): string {
  const hex = Array.from({ length: seed.length }, (_unused, index) =>
    seed.charCodeAt(index).toString(16),
  ).join('');
  return `"${hex.padEnd(64, '0').slice(0, 64)}"`;
}

export const versionPath = (id: string) => `/inquiry-template-versions/${id}`;
export const templatePath = (id: string) => `/inquiry-templates/${id}`;

/** `GET /inquiry-template-versions/:id` answers `version` with `etag`. */
export function serveTemplateVersion(
  api: RouteApi,
  version: InquiryTemplateVersionResource,
  etag: string = syntheticEtag(version.id),
): RouteApi {
  return api.on('GET', versionPath(version.id), 200, { data: version }, { etag });
}

/**
 * `PATCH /inquiry-template-versions/:id`: answers the draft with the attributes sent merged in
 * and a new ETag while `If-Match` names `etag`, else 412 `precondition_failed`.
 */
export function serveDraftSaves(
  api: RouteApi,
  draft: InquiryTemplateVersionResource,
  etag: string,
): RouteApi {
  let current = { version: draft, etag };
  let saves = 0;
  return api.handle('PATCH', versionPath(draft.id), (request) => {
    if (request.headers.get('if-match') !== current.etag) {
      return {
        status: 412,
        body: {
          type: 'about:blank',
          title: 'Precondition Failed',
          status: 412,
          code: 'precondition_failed',
        },
        headers: { etag: current.etag },
      };
    }
    saves += 1;
    const body = request.body as { data: { attributes: Record<string, unknown> } };
    current = {
      version: {
        ...current.version,
        attributes: { ...current.version.attributes, ...body.data.attributes },
      },
      etag: syntheticEtag(`${draft.id}-${String(saves)}`),
    };
    return { status: 200, body: { data: current.version }, headers: { etag: current.etag } };
  });
}

/** `POST /inquiry-template-versions/:id/validate` answers `problems` and the acknowledgements. */
export function serveValidation(
  api: RouteApi,
  versionId: string,
  problems: readonly {
    pointer: string;
    code: string;
    detail: string;
    severity: 'error' | 'warning';
  }[] = [],
  acknowledgements: readonly string[] = [],
): RouteApi {
  return api.on('POST', `${versionPath(versionId)}/validate`, 200, {
    data: {
      type: 'inquiry-template-version-validation',
      id: versionId,
      attributes: {
        validation: {
          status: problems.some((problem) => problem.severity === 'error') ? 'invalid' : 'valid',
          problems,
        },
        'flow-sha256': null,
        'acknowledgements-required': acknowledgements,
      },
    },
  });
}

/** An empty diff of `from` against `to`, with `overrides` applied, as the contract parses it. */
export function diffAttributes(
  from: string,
  to: string,
  overrides: Record<string, unknown> = {},
): TemplateVersionDiff {
  const attributes = {
    'from-version-id': from,
    'to-version-id': to,
    steps: { added: [], removed: [], changed: [] },
    edges: { added: [], removed: [], retargeted: [] },
    'route-order': [],
    'verification-config': [],
    settings: [],
    'report-config': [],
    'field-schemas': [],
    copy: [],
    'theme-set-id': null,
    locales: [],
    'layout-only': false,
    consequences: [],
    ...overrides,
  };
  return templateVersionDiffDocumentSchema.parse({
    data: { type: 'inquiry-template-version-diff', id: `${from}..${to}`, attributes },
  }).data.attributes;
}

/** `GET /inquiry-template-versions/:from/diff` answers the diff against any version. */
export function serveDiff(
  api: RouteApi,
  from: string,
  to: string,
  overrides: Record<string, unknown> = {},
): RouteApi {
  return api.on('GET', `${versionPath(from)}/diff`, 200, {
    data: {
      type: 'inquiry-template-version-diff',
      id: `${from}..${to}`,
      attributes: diffAttributes(from, to, overrides),
    },
  });
}

/** `GET /deployments` answers no deployment. */
export function serveNoDeployments(api: RouteApi): RouteApi {
  return api.on('GET', '/deployments', 200, { data: [], links: { next: null } });
}

/** `GET /inquiry-templates/:id/used-by` answers nothing named, `hidden` workflows counted. */
export function serveUsage(api: RouteApi, templateId: string, hidden = 0): RouteApi {
  return api.on('GET', `${templatePath(templateId)}/used-by`, 200, {
    data: {
      type: 'inquiry-template-usage',
      id: templateId,
      attributes: {
        workflows: [],
        'workflows-hidden': hidden,
        'report-templates': [],
        'report-templates-hidden': 0,
        'case-templates': [],
        'case-templates-hidden': 0,
        'embed-origins': [],
      },
    },
  });
}
