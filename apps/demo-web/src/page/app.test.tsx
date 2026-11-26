/**
 * The sample page: it asks its own server for an inquiry, embeds the flow with
 * `<OpenVerifyFlow>`, treats the flow's completion as a hint, and shows the result its server
 * reports (from a verified webhook or the API), asking again until the inquiry is decided.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app.tsx';

const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const SESSION_TOKEN = `ovs_${'c'.repeat(43)}`;

interface FlowProps {
  readonly flowUrl: string;
  readonly inquiryId: string;
  readonly sessionToken?: string;
  readonly onComplete?: (result: { inquiryId: string; status: string }) => void;
  readonly onError?: (error: { code: string; message: string }) => void;
}

const flows: FlowProps[] = [];
vi.mock('@openverify/react', () => ({
  OpenVerifyFlow: (props: FlowProps) => {
    flows.push(props);
    return (
      <div data-testid="flow">
        <button
          type="button"
          onClick={() => props.onComplete?.({ inquiryId: props.inquiryId, status: 'completed' })}
        >
          finish the flow
        </button>
        <button
          type="button"
          onClick={() => props.onError?.({ code: 'unauthenticated', message: 'The link expired.' })}
        >
          fail the flow
        </button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  flows.length = 0;
  vi.useRealTimers();
});

type Route = (init: RequestInit | undefined) => Response | Promise<Response>;

function fakeServer(routes: Record<string, Route>): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${input.toString()}`;
    calls.push(key);
    const route = routes[key];
    return route === undefined ? new Response('{}', { status: 404 }) : route(init);
  }) as typeof fetch;
  return { fetch: fakeFetch, calls };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const results = (...statuses: string[]): Route => {
  let index = 0;
  return () => {
    const status = statuses[Math.min(index, statuses.length - 1)] ?? 'created';
    index += 1;
    return json(200, {
      inquiryId: INQUIRY_ID,
      status,
      event: status === 'approved' ? 'inquiry.approved' : null,
      source: status === 'approved' ? 'webhook' : 'api',
    });
  };
};

describe('App', () => {
  it('starts a verification, embeds the flow and shows the server-decided result', async () => {
    const server = fakeServer({
      'GET /api/config': () => json(200, { flowUrl: 'https://flow.example.test' }),
      'POST /api/inquiries': () =>
        json(201, { inquiryId: INQUIRY_ID, sessionToken: SESSION_TOKEN }),
      [`GET /api/inquiries/${INQUIRY_ID}/result`]: results('completed', 'approved'),
    });
    render(<App fetch={server.fetch} pollMs={5} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sample customer site');
    expect(screen.getByText(/sample/i, { selector: 'p' })).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Verify your identity' }));
    await screen.findByTestId('flow');
    expect(flows.at(-1)).toMatchObject({
      flowUrl: 'https://flow.example.test',
      inquiryId: INQUIRY_ID,
      sessionToken: SESSION_TOKEN,
    });

    fireEvent.click(screen.getByRole('button', { name: 'finish the flow' }));
    expect(await screen.findByText(/waiting for your server/i)).toBeTruthy();
    const status = await screen.findByText('approved');
    expect(status.closest('[role="status"]')?.textContent).toContain('inquiry.approved');
    expect(screen.queryByTestId('flow')).toBeNull();
    expect(server.calls.filter((call) => call.endsWith('/result'))).toHaveLength(2);
  });

  it('says so when the server cannot start a verification', async () => {
    const server = fakeServer({
      'GET /api/config': () => json(200, { flowUrl: 'https://flow.example.test' }),
      'POST /api/inquiries': () => json(502, { error: 'api_unavailable' }),
    });
    render(<App fetch={server.fetch} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verify your identity' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not start/i);
    expect(screen.queryByTestId('flow')).toBeNull();
  });

  it('shows the flow error and still asks the server, which decides', async () => {
    const server = fakeServer({
      'GET /api/config': () => json(200, { flowUrl: 'https://flow.example.test' }),
      'POST /api/inquiries': () =>
        json(201, { inquiryId: INQUIRY_ID, sessionToken: SESSION_TOKEN }),
      [`GET /api/inquiries/${INQUIRY_ID}/result`]: results('created', 'created', 'declined'),
    });
    render(<App fetch={server.fetch} pollMs={5} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verify your identity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'fail the flow' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The link expired.');
    await act(async () => {
      await Promise.resolve();
    });
    expect(await screen.findByText('declined')).toBeTruthy();
  });

  it('says so when its configuration cannot be read', async () => {
    const server = fakeServer({ 'GET /api/config': () => json(500, {}) });
    render(<App fetch={server.fetch} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load/i);
    expect(screen.queryByRole('button', { name: 'Verify your identity' })).toBeNull();
  });
});
