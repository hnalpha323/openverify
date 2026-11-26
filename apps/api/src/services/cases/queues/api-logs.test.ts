/**
 * C143.5 (P21; Workflow 8B Stage 3, `api-queues-sla`): the stored API log of the (Q) routes that take
 * personal data. An assignment's `meta.user-email-address` and a holiday import's CSV are nulled for a
 * reader without `pii:view`, and kept for one with it. The other (Q) routes take ids, names of
 * configuration and counts only.
 *
 * Every value is a synthetic canary.
 */
import { apiLogDocumentSchema } from '@openverify/contracts';
import { createApiLog } from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApi,
  expectStatus,
  type TestApi,
} from '../../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 120_000);

afterAll(async () => {
  await api.close();
});

const ADDRESS = 'synthetic-canary-assignee@example.com';
const CSV_LABEL = 'Synthetic canary closure';

async function stored(path: string, route: string, requestBody: Record<string, unknown>) {
  const id = testId('alog');
  await createApiLog(api.database.db, api.environmentId, {
    id,
    method: 'POST',
    path,
    route,
    status: 200,
    durationMs: 3,
    requestId: `req-${id}`,
    idempotencyKey: null,
    apiKeyId: testId('key'),
    ip: '203.0.113.7',
    userAgent: 'SeedClient/1.0',
    query: {},
    requestBody,
    responseBody: null,
  });
  return id;
}

const read = async (id: string, permissions: string[]) =>
  JSON.stringify(
    apiLogDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          method: 'GET',
          url: `/api/v1/api-logs/${id}`,
          headers: bearer(
            api.newUserToken(api.environmentId, { permissions: permissions as never }),
          ),
        }),
        200,
      ),
    ),
  );

describe('the stored API log of the (Q) routes (C143.5)', () => {
  it.each([
    [
      'POST /cases/:id/assign',
      `/api/v1/cases/${testId('case')}/assign`,
      '/api/v1/cases/:id/assign',
      { meta: { 'user-email-address': ADDRESS } },
      ADDRESS,
    ],
    [
      'POST /case-calendars/:id/holidays/import',
      `/api/v1/case-calendars/${testId('ccal')}/holidays/import`,
      '/api/v1/case-calendars/:id/holidays/import',
      {
        data: {
          type: 'case-calendar',
          attributes: { csv: `date,label\r\n2026-12-25,${CSV_LABEL}` },
        },
      },
      CSV_LABEL,
    ],
  ])(
    '%s keeps its personal data from a reader without pii:view',
    async (_name, path, route, body, canary) => {
      const id = await stored(path, route, body);

      expect(await read(id, ['api-logs:read'])).not.toContain(canary);
      expect(await read(id, ['api-logs:read', 'pii:view'])).toContain(canary);
    },
  );
});
