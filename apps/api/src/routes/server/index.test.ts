import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
  await api.app.ready();
});

afterAll(async () => {
  await api.close();
});

describe('serverRoutes', () => {
  it.each([
    'inquiryTemplateRoutes',
    'inquiryTemplateVersionRoutes',
    'inquiryRoutes',
    'inquirySessionRoutes',
    'verificationRoutes',
    'accountRoutes',
    'accountTypeRoutes',
    'webhookRoutes',
    'webhookDeliveryRoutes',
    'eventRoutes',
    'apiKeyRoutes',
    'apiLogRoutes',
    'rateLimitRoutes',
    'userAuditLogRoutes',
    // C72.1 (Phase 6): the frozen report routes, built by api-reports.
    'reportRoutes',
    'reportTemplateRoutes',
    'reportTemplateVersionRoutes',
  ])('registers %s, so Stage 2 never edits this index', (plugin) => {
    expect(api.app.printPlugins()).toMatch(new RegExp(`\\b${plugin}\\b`));
  });
});
