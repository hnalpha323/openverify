/**
 * Workflow 8B Stage 1b, checkpoint (F) (C135.3; P38): an inquiry file's rendition is frozen on the
 * dashboard API behind the operator's session, `GET /api/v1/dashboard/files/:id/rendition`, with the
 * source file route's scopes (`inquiries:read` and `pii:view`); `api-case-files` built it
 * (`services/cases/attachments/file-renditions.test.ts`). The API's own file route is unchanged.
 *
 * Every value is synthetic.
 */
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';

const FILE = 'file_01M5CK3190XEVBM5ZXA76E1JSN';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function signedIn(roles: ('reviewer' | 'viewer')[]) {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const token = await api.signIn((await api.operator(organization, { roles })).email);
  return { api, token };
}

describe('the file rendition route (C135.3)', () => {
  it('answers 404 to a reviewer for a file this environment does not hold, now built', async () => {
    const { api, token } = await signedIn(['reviewer']);

    const first = await api.call('GET', `/files/${FILE}/rendition`, { token });
    const later = await api.call('GET', `/files/${FILE}/rendition?page=3`, { token });

    expect(first.statusCode, first.body).toBe(404);
    expect(later.statusCode, later.body).toBe(404);
  });

  it('needs pii:view, as the file’s own content does', async () => {
    const { api, token } = await signedIn(['viewer']);

    const response = await api.call('GET', `/files/${FILE}/rendition`, { token });

    expect(response.statusCode, response.body).toBe(403);
  });

  it('refuses a page past 20, another id kind, and a request without a session', async () => {
    const { api, token } = await signedIn(['reviewer']);

    const page = await api.call('GET', `/files/${FILE}/rendition?page=21`, { token });
    const kind = await api.call('GET', '/files/catt_01M5CK3190XEVBM5ZXA76E1JSN/rendition', {
      token,
    });
    const anonymous = await api.call('GET', `/files/${FILE}/rendition`);

    expect(page.statusCode, page.body).toBe(400);
    expect(kind.statusCode, kind.body).toBe(400);
    expect(anonymous.statusCode).toBe(401);
  });
});
