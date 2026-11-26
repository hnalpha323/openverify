// @vitest-environment node
import { OpenVerifyApiError } from '@openverify/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPH_IDS as IDS } from '../../../../testing/graph-fixtures';
import { POST } from './route';

const mocks = vi.hoisted(() => ({ exportGraphCsv: vi.fn() }));

vi.mock('../../../../lib/api/graph', () => ({ exportGraphCsv: mocks.exportGraphCsv }));

/** A neutralised cell, as the API's writer answers it: passed on byte for byte. */
const CSV = 'account-id,reference-id,status\r\nacc_1,"\'=HYPERLINK(1)",active\r\n';
const ORIGIN = 'http://dashboard.test';

beforeEach(() => {
  mocks.exportGraphCsv.mockReset();
});

function post(id: string, fields: Record<string, string | readonly string[]>, headers = {}) {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of typeof value === 'string' ? [value] : value) {
      body.append(name, each);
    }
  }
  return POST(
    new Request(`${ORIGIN}/graph/${id}/export`, {
      method: 'POST',
      body,
      headers: { origin: ORIGIN, host: 'dashboard.test', ...headers },
    }),
    { params: Promise.resolve({ id }) },
  );
}

const exported = (csv: string, contentType: string) => ({ csv, contentType });

/** What the node client throws for an API refusal. */
const refused = (status: number) =>
  new OpenVerifyApiError(
    { type: 'about:blank', title: 'Refused', status, detail: 'synthetic-detail' },
    null,
  );

describe('POST /graph/:id/export (C103.2, C100)', () => {
  it('streams the API’s CSV as it answers it, as a download that is never stored', async () => {
    mocks.exportGraphCsv.mockResolvedValueOnce(exported(CSV, 'text/csv; charset=utf-8'));
    const response = await post(IDS.query, { 'account-id': [IDS.accountA, IDS.accountB] });
    expect(mocks.exportGraphCsv).toHaveBeenCalledExactlyOnceWith(IDS.query, {
      'account-ids': [IDS.accountA, IDS.accountB],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="graph-query-${IDS.query}.csv"`,
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe(CSV);
  });

  it('exports every account of the result with all', async () => {
    mocks.exportGraphCsv.mockResolvedValueOnce(exported(CSV, 'text/csv'));
    await post(IDS.query, { all: 'true' });
    expect(mocks.exportGraphCsv).toHaveBeenCalledWith(IDS.query, { all: true });
  });

  it.each([
    ['a malformed id', 'grphq_nope', { all: 'true' }, 404],
    ['no selection', IDS.query, {}, 400],
    [
      'an id that is not an account',
      IDS.query,
      { 'account-id': 'lst_01JC0000000000000000000001' },
      400,
    ],
  ] as const)('answers %s without calling the API', async (_case, id, fields, status) => {
    const response = await post(id, fields);
    expect(response.status).toBe(status);
    expect(mocks.exportGraphCsv).not.toHaveBeenCalled();
  });

  it('refuses a post from another origin, calling nothing', async () => {
    const response = await post(IDS.query, { all: 'true' }, { origin: 'http://elsewhere.test' });
    expect(response.status).toBe(403);
    expect(mocks.exportGraphCsv).not.toHaveBeenCalled();
  });

  // The console sends `Referrer-Policy: no-referrer`, so a browser's form post says `Origin: null`
  // from this dashboard as from anywhere else; only `Sec-Fetch-Site` tells them apart.
  it.each([
    ['same-origin', { 'sec-fetch-site': 'same-origin' }],
    ['absent, as on plain HTTP, where the Lax session cookie still guards', {}],
  ])('accepts the console’s own form post with Sec-Fetch-Site %s', async (_case, site) => {
    mocks.exportGraphCsv.mockResolvedValueOnce(exported(CSV, 'text/csv'));
    const response = await post(IDS.query, { all: 'true' }, { origin: 'null', ...site });
    expect(response.status).toBe(200);
    expect(mocks.exportGraphCsv).toHaveBeenCalledWith(IDS.query, { all: true });
  });

  it.each(['cross-site', 'same-site', 'none'])(
    'refuses a post with no origin to read and Sec-Fetch-Site %s, calling nothing',
    async (site) => {
      const response = await post(
        IDS.query,
        { all: 'true' },
        { origin: 'null', 'sec-fetch-site': site },
      );
      expect(response.status).toBe(403);
      expect(mocks.exportGraphCsv).not.toHaveBeenCalled();
    },
  );

  it('answers 401 without a session', async () => {
    mocks.exportGraphCsv.mockResolvedValueOnce(null);
    const response = await post(IDS.query, { all: 'true' });
    expect(response.status).toBe(401);
  });

  it.each([
    [400, 400],
    [403, 403],
    [404, 404],
    [410, 410],
    [422, 422],
    [429, 429],
    [500, 502],
  ])(
    'reduces an API %i to %i, saying it in words and never passing the problem on',
    async (status, expected) => {
      mocks.exportGraphCsv.mockRejectedValueOnce(refused(status));
      const response = await post(IDS.query, { all: 'true' });
      expect(response.status).toBe(expected);
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      const text = await response.text();
      expect(text).not.toContain('synthetic-detail');
      expect(text).toMatch(/\.$/);
    },
  );

  it('answers 502 when the API is unreachable, or answers anything but CSV', async () => {
    mocks.exportGraphCsv.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await post(IDS.query, { all: 'true' })).status).toBe(502);
    mocks.exportGraphCsv.mockResolvedValueOnce(exported('{}', 'application/json'));
    expect((await post(IDS.query, { all: 'true' })).status).toBe(502);
  });
});
