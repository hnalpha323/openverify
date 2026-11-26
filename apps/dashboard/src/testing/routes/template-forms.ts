/**
 * `dashboard-template-forms`' own mock routes (Workflow 9C, C153): the template, its versions and
 * the lists a list picker offers, registered on a `routeApi()` the test made. Paths are after
 * `/api/v1`; every value is synthetic.
 */
import type {
  InquiryTemplateResource,
  InquiryTemplateVersionResource,
  ListResource,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import type { RouteApi } from '../api-routes';
import { single } from '../lifecycle-fixtures';

export const INQUIRY_TEMPLATES_PATH = '/inquiry-templates';
export const INQUIRY_TEMPLATE_VERSIONS_PATH = '/inquiry-template-versions';
export const LISTS_PATH = '/lists';

/** Reads templates only: every form is read-only. */
export const TEMPLATE_READER: readonly Permission[] = ['inquiry-templates:read'];
/** Edits drafts: the forms save (C153.3). */
export const TEMPLATE_EDITOR: readonly Permission[] = [
  'inquiry-templates:read',
  'inquiry-templates:write',
  'lists:read',
];

const page = <Resource>(data: readonly Resource[]) => ({ data, links: { next: null } });

/** The synthetic strong ETag the mock serves for a version (C154.3): its number, padded. */
export function etagOf(version: InquiryTemplateVersionResource): string {
  return `"${String(version.attributes['version-number']).padStart(64, '0')}"`;
}

/**
 * `GET /inquiry-templates/:id` answers `template`; `GET /inquiry-template-versions` answers the
 * `versions` whose status the request's `filter[status]` names (all of them without one); and
 * `GET /inquiry-template-versions/:id` answers each version.
 */
export function serveTemplateVersions(
  api: RouteApi,
  template: InquiryTemplateResource,
  versions: readonly InquiryTemplateVersionResource[],
): RouteApi {
  api.on('GET', `${INQUIRY_TEMPLATES_PATH}/${template.id}`, 200, single(template));
  api.handle('GET', INQUIRY_TEMPLATE_VERSIONS_PATH, (request) => {
    const status = request.query.get('filter[status]');
    return {
      status: 200,
      body: page(
        versions.filter((version) => status === null || version.attributes.status === status),
      ),
    };
  });
  for (const version of versions) {
    api.on('GET', `${INQUIRY_TEMPLATE_VERSIONS_PATH}/${version.id}`, 200, single(version), {
      etag: etagOf(version),
    });
  }
  return api;
}

/** `GET /lists` answers one page of `lists`, for the list pickers. */
export function serveLists(api: RouteApi, lists: readonly ListResource[]): RouteApi {
  return api.on('GET', LISTS_PATH, 200, page(lists));
}

/**
 * A synthetic v2 flow whose branch reads a check of its government ID step
 * (`id_expired_detection`), for the check panels' "branches that read it" (C153.1, review H07).
 */
export const CHECK_READING_FLOW: FlowV2 = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'synthetic-checks', version: 1, name: 'Synthetic checks' },
  entry: 'id_card',
  steps: [
    {
      id: 'id_card',
      type: 'government_id',
      sides: 'front',
      maxAttempts: 2,
      captureMethods: ['camera'],
    },
    {
      id: 'expiry_route',
      type: 'branch',
      name: 'Expired ID route',
      routes: [
        {
          key: 'expired',
          label: 'Expired ID',
          condition: {
            '===': [{ var: 'verifications.id_card.checks.id_expired_detection.status' }, 'failed'],
          },
          onNull: 'review',
        },
      ],
    },
    { id: 'done', type: 'completion' },
    { id: 'rejected', type: 'failure' },
  ],
  edges: [
    { id: 'e1', from: 'id_card', port: 'next', to: 'expiry_route' },
    { id: 'e2', from: 'expiry_route', port: 'route:expired', to: 'rejected' },
    { id: 'e3', from: 'expiry_route', port: 'else', to: 'done' },
  ],
});
