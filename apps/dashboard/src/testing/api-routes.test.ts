import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_URL } from './api-mock';
import { routeApi, type RouteApi } from './api-routes';

let api: RouteApi;

beforeEach(() => {
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('routeApi answers with headers (Workflow 9C)', () => {
  it('serves the headers a route registers, such as a version’s ETag', async () => {
    api.on('GET', '/inquiry-template-versions/x', 200, { data: {} }, { etag: '"synthetic"' });
    api.handle('PATCH', '/inquiry-template-versions/x', () => ({
      status: 200,
      body: { data: {} },
      headers: { etag: '"synthetic-next"' },
    }));

    const read = await fetch(`${API_URL}/api/v1/inquiry-template-versions/x`);
    const saved = await fetch(`${API_URL}/api/v1/inquiry-template-versions/x`, { method: 'PATCH' });

    expect(read.headers.get('etag')).toBe('"synthetic"');
    expect(saved.headers.get('etag')).toBe('"synthetic-next"');
  });
});
