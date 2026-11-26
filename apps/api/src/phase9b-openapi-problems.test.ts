/**
 * Workflow 9B Stage 4 (integration-9b): the problems the 9A and 9B routes declare once built. A
 * route frozen at 501 by a foundation call keeps 501 among its declared problems until its owner
 * builds it; every route below is built, so the document no longer offers 501 for it. Two routes
 * gain a problem they answer: `POST /inquiry-templates` answers 422 (a flow-spec 2 version's
 * rules, as a v1 version's coherence always did), and `POST /theme-sets/assets` answers 503 with
 * `Retry-After` when the vision service cannot re-encode a logo.
 */
import { setDefaultKeyring } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { createRecordingQueue } from './test-support/fakes.js';
import { syntheticEnv } from './test-support/env.js';

const container = createContainer(loadConfig(syntheticEnv({})), {
  verificationQueue: { ...createRecordingQueue(), close: () => Promise.resolve() },
  webhookDeliveries: { scheduleDelivery: () => Promise.resolve(), close: () => Promise.resolve() },
});

afterAll(async () => {
  await container.close();
  setDefaultKeyring(undefined);
});

interface Operation {
  responses?: Record<string, unknown>;
}
let paths: Record<string, Record<string, Operation>>;

beforeAll(async () => {
  const app = container.buildApp();
  paths = (await app.inject({ url: '/openapi.json' })).json<{
    paths: Record<string, Record<string, Operation>>;
  }>().paths;
});

const codes = (method: string, path: string) => Object.keys(paths[path]?.[method]?.responses ?? {});

/** Every 9A and 9B route a foundation call froze at 501, now built (method, path). */
const BUILT: readonly (readonly [string, string])[] = [
  ['get', '/api/v1/analytics/inquiries'],
  ['get', '/api/v1/analytics/funnel'],
  ['get', '/api/v1/analytics/verifications'],
  ['get', '/api/v1/analytics/checks'],
  ['get', '/api/v1/analytics/cases'],
  ['get', '/api/v1/analytics/signals'],
  ['post', '/api/v1/exports'],
  ['get', '/api/v1/exports'],
  ['get', '/api/v1/exports/{id}'],
  ['get', '/api/v1/exports/{id}/download'],
  ['post', '/api/v1/reports/bulk'],
  ['get', '/api/v1/reports/bulk/{id}'],
  ['post', '/api/v1/webhook-deliveries/search'],
  ['get', '/api/v1/inquiries'],
  ['get', '/api/v1/transactions'],
  ['post', '/api/v1/api-keys'],
  ['patch', '/api/v1/api-keys/{id}'],
  ['post', '/api/v1/api-keys/{id}/rotate'],
  ['post', '/api/v1/webhooks'],
  ['patch', '/api/v1/webhooks/{id}'],
  ['post', '/api/v1/case-templates'],
  ['post', '/api/v1/case-template-versions'],
  ['patch', '/api/v1/case-template-versions/{id}'],
  ['post', '/api/v1/case-actions'],
  ['patch', '/api/v1/case-actions/{id}'],
  ['post', '/api/v1/cases/{id}/checklist'],
  ['get', '/api/v1/verifications/{id}'],
  ['post', '/api/v1/graph-queries/{id}/nodes/{nodeId}/expand'],
  ['post', '/api/v1/inquiry-template-versions/{id}/preview'],
  ['post', '/api/v1/inquiry-template-versions/{id}/simulate'],
  ['post', '/api/v1/theme-sets'],
  ['post', '/api/v1/theme-sets/assets'],
  ['get', '/api/v1/dashboard/saved-views'],
  ['post', '/api/v1/dashboard/saved-views'],
  ['patch', '/api/v1/dashboard/saved-views/{id}'],
  ['delete', '/api/v1/dashboard/saved-views/{id}'],
  ['get', '/api/v1/dashboard/simulation-presets'],
  ['post', '/api/v1/dashboard/simulation-presets'],
  ['delete', '/api/v1/dashboard/simulation-presets/{id}'],
  ['get', '/api/v1/dashboard/notification-preferences'],
  ['put', '/api/v1/dashboard/notification-preferences'],
  ['post', '/api/v1/dashboard/print-audits'],
  ['put', '/api/v1/dashboard/users/{id}/roles'],
  ['post', '/api/v1/dashboard/users/{id}/reactivate'],
  ['post', '/api/v1/dashboard/users/{id}/reset-mfa'],
  ['get', '/api/v1/dashboard/roles/grantable'],
  ['post', '/api/v1/dashboard/invitations/{id}/resend'],
  ['get', '/api/v1/dashboard/sessions'],
  ['post', '/api/v1/dashboard/sessions/revoke-others'],
  ['post', '/api/v1/dashboard/sessions/{id}/revoke'],
  ['post', '/api/v1/dashboard/sessions/current/step-up'],
  ['get', '/api/v1/dashboard/audit-logs'],
];

describe('the built 9A and 9B routes in the OpenAPI document (integration-9b)', () => {
  it.each(BUILT)('%s %s is listed and no longer declares 501', (method, path) => {
    expect(codes(method, path), `${method} ${path}`).not.toEqual([]);
    expect(codes(method, path), `${method} ${path}`).not.toContain('501');
  });

  it('declares 422 on POST /inquiry-templates and 503 on POST /theme-sets/assets', () => {
    expect(codes('post', '/api/v1/inquiry-templates')).toContain('422');
    expect(codes('post', '/api/v1/theme-sets/assets')).toContain('503');
  });
});
