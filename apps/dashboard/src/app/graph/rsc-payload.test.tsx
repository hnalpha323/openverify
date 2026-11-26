import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  EMAIL_CONFIG,
  GRAPH_IDS as IDS,
  NODE_IDS,
  SHARED_EMAIL,
  graphQuery,
  graphTemplate,
  graphTemplateVersion,
} from '../../testing/graph-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import {
  GRAPH_DEVELOPER,
  GRAPH_REVIEWER,
  serveGraphQuery,
  serveGraphTemplate,
  serveGraphTemplateVersion,
} from '../../testing/routes/graph';
import GraphQueryPage from './[id]/page';
import TemplatePage from './templates/[id]/page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/** The value a reviewer searched for: a synthetic address at `.test`. */
const SEARCHED = 'searched-person@example.test';

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveGraphTemplateVersion(api, graphTemplateVersion({ config: EMAIL_CONFIG }));
  serveGraphTemplate(api, graphTemplate());
  api.on('GET', '/lists', 200, { data: [], links: { next: null } });
});

afterEach(() => {
  api.restore();
});

const explorer = () => GraphQueryPage({ params: Promise.resolve({ id: IDS.query }) });

describe('the graph pages’ RSC payload (C108, C107.5, P17)', () => {
  it('carries, for a principal without pii:view, each parameter’s name but no parameter value and no node value', async () => {
    api.me({ permissions: GRAPH_DEVELOPER });
    // As the API serves it to this principal: params masked member-wise (C102.4).
    serveGraphQuery(api, graphQuery({ params: { email: null } }));
    const payload = await rscPayloadOf(await explorer());
    expect(payload).toContain('email');
    expect(payload).toContain(NODE_IDS.email);
    expect(payload).not.toContain(SEARCHED);
    expect(payload).not.toContain(SHARED_EMAIL);
    expect(payload).not.toMatch(/example\.test/);
    expect(api.requests.some((request) => request.path.endsWith('/value'))).toBe(false);
  });

  it('never carries a node value, even for a principal with pii:view: only an explicit unmask asks for one', async () => {
    api.me({ permissions: GRAPH_REVIEWER });
    serveGraphQuery(api, graphQuery({ params: { email: SEARCHED } }));
    const payload = await rscPayloadOf(await explorer());
    // The parameter this principal may see is shown as the API answered it.
    expect(payload).toContain(SEARCHED);
    expect(payload).not.toContain(SHARED_EMAIL);
    expect(api.requests.some((request) => request.path.endsWith('/value'))).toBe(false);
  });

  it('carries no value on a template page, whose configuration holds only placeholders', async () => {
    api.me({ permissions: GRAPH_DEVELOPER });
    const payload = await rscPayloadOf(
      await TemplatePage({
        params: Promise.resolve({ id: IDS.template }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(payload).toContain('{{email}}');
    expect(payload).not.toMatch(/example\.test/);
  });
});
