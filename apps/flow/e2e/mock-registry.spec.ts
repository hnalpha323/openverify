import { expect, test } from '@playwright/test';
import {
  API_ORIGIN,
  MockFlowApi,
  SESSION_TOKEN,
  flowLink,
  registerMockFlowExtension,
} from './support/mock-flow-api';

// Workflow 9A Stage 1b (F; review F11): an area's mock answers live in its own
// e2e/support/mock-<area>.ts and reach the shared mock through registerMockFlowExtension.

/** `path` below the flow API, fetched from the flow's page with the session token. */
const fetchFlow = (path: string) =>
  ({ url: `${API_ORIGIN}/api/v1/flow${path}`, token: SESSION_TOKEN }) as const;

test('serves a registered area’s route and session members beside the mock’s own', async ({
  page,
}) => {
  const remove = registerMockFlowExtension('registry-probe', {
    route: async ({ method, path, reply }) => {
      if (method !== 'GET' || path !== '/registry-probe') {
        return false;
      }
      await reply(200, { probed: true });
      return true;
    },
    session: (session) => ({ ...session, 'registry-probe': 'synthetic' }),
  });
  try {
    const api = new MockFlowApi();
    await api.install(page);
    await page.goto(flowLink());
    await expect(page.locator('#root')).not.toBeEmpty();

    const answers = await page.evaluate(
      async ([probe, session]) => {
        const read = async ({ url, token }: { url: string; token: string }) =>
          (await fetch(url, { headers: { authorization: `Bearer ${token}` } })).json() as Promise<
            Record<string, unknown>
          >;
        return { probe: await read(probe), session: await read(session) };
      },
      [fetchFlow('/registry-probe'), fetchFlow('/session')] as const,
    );

    expect(answers.probe).toEqual({ probed: true });
    expect(answers.session).toMatchObject({ 'registry-probe': 'synthetic' });
    expect(answers.session).toHaveProperty('inquiry');
  } finally {
    remove();
  }
});
