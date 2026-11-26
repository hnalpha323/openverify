// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { API_URL, meDocument, mockApi, type MockApi } from './api-mock';

let api: MockApi | undefined;

afterEach(() => {
  try {
    api?.restore();
  } catch {
    // Each test checks what restore() says itself.
  }
  api = undefined;
});

const call = (method: string, path: string) =>
  fetch(`${API_URL}/api/v1${path}`, { method }).then(
    (response) => response.status,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

describe('mockApi (Workflow 2D F021)', () => {
  it('fails the test at restore() when a queued answer was never used', async () => {
    api = mockApi();
    api.reply(200, meDocument()).reply(200, { data: [] });

    await call('GET', '/dashboard/me');

    expect(() => api?.restore()).toThrow(/1 queued API answer was never used/);
  });

  it('answers a route-checked reply only to that method and path', async () => {
    api = mockApi();
    api.replyTo('GET /dashboard/me', 200, meDocument()).replyTo('GET /dashboard/inquiries', 200, {
      data: [],
    });

    expect(await call('GET', '/dashboard/me')).toBe(200);
    // The code under test may swallow the rejection (as a connection error): restore() fails.
    expect(await call('GET', '/dashboard/me')).toMatch(
      /Expected GET \/dashboard\/inquiries, got GET \/dashboard\/me/,
    );
    expect(() => api?.restore()).toThrow(
      /Expected GET \/dashboard\/inquiries, got GET \/dashboard\/me/,
    );
  });

  it('fails the test at restore() on a request nothing answered, even when the code swallowed it', async () => {
    api = mockApi();

    expect(await call('POST', '/dashboard/sessions')).toMatch(/Unexpected API request/);

    expect(() => api?.restore()).toThrow(
      /Unexpected API request: POST \/api\/v1\/dashboard\/sessions/,
    );
  });

  it('restores quietly when every answer was used as queued', async () => {
    api = mockApi();
    api
      .replyTo('GET /dashboard/me', 200, meDocument())
      .replyProblemTo('DELETE /dashboard/sessions/current', 401);

    await call('GET', '/dashboard/me');
    await call('DELETE', '/dashboard/sessions/current');

    expect(() => api?.restore()).not.toThrow();
  });
});
