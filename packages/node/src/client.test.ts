/** The C18 client transport: auth, versions, idempotency, retries, timeouts, errors and paging. */
import { ULID_PATTERN } from '@openverify/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createClient,
  OpenVerifyApiError,
  OpenVerifyConnectionError,
  OpenVerifyError,
  OpenVerifyResponseValidationError,
  OpenVerifyTimeoutError,
  type ClientOptions,
  type OpenVerifyClient,
} from './client.js';
import { apiFixture, scriptedFetch, type Scripted } from './test-support.js';

const API_KEY = 'ov_sbx_synthetictesttokenaaaaaaaaaaaaaaaaaaaaaaaaaa';
const INQUIRY = apiFixture('inquiry');
const INQUIRY_ID = (INQUIRY.data as { id: string }).id;
const WEBHOOK_ID = 'wbh_01M5CJXJF8RTHTZ2WC4QENGB0C';

function setup(script: Scripted[] = [], options: Partial<ClientOptions> = {}) {
  const fake = scriptedFetch(script);
  const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  const client = createClient({
    apiKey: API_KEY,
    baseUrl: 'https://api.example.test',
    fetch: fake.fetch,
    sleep,
    random: () => 0.5,
    ...options,
  });
  return { client, requests: fake.requests, sleep };
}

const problem = (status: number, extra: Record<string, unknown> = {}) => ({
  type: 'about:blank',
  title: 'Service Unavailable',
  status,
  detail: 'Synthetic failure.',
  ...extra,
});

describe('createClient', () => {
  it.each([
    ['an empty API key', { apiKey: '' }, TypeError],
    ['a base URL that is not http(s)', { baseUrl: 'ftp://api.example.test' }, TypeError],
    ['a base URL that is not a URL', { baseUrl: 'api.example.test' }, TypeError],
    ['a base URL with credentials', { baseUrl: 'https://u:p@api.example.test' }, TypeError],
    ['negative retries', { maxRetries: -1 }, RangeError],
    ['fractional retries', { maxRetries: 1.5 }, RangeError],
    ['a zero timeout', { timeoutMs: 0 }, RangeError],
  ])('refuses %s', (_label, options, error) => {
    expect(() =>
      createClient({ apiKey: API_KEY, baseUrl: 'https://api.example.test', ...options }),
    ).toThrow(error);
  });

  it('uses the global fetch by default', async () => {
    const fake = scriptedFetch([{ status: 200, body: INQUIRY }]);
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetch);
    try {
      const client = createClient({ apiKey: API_KEY, baseUrl: 'https://api.example.test' });
      await client.inquiries.retrieve(INQUIRY_ID);
      expect(fake.requests).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('requests', () => {
  it('sends the bearer key and JSON headers, and parses the response with the contract', async () => {
    const { client, requests } = setup([{ status: 200, body: INQUIRY }]);

    const document = await client.inquiries.retrieve(INQUIRY_ID);

    expect(document).toEqual(INQUIRY);
    expect(requests).toEqual([
      expect.objectContaining({
        method: 'GET',
        url: `https://api.example.test/api/v1/inquiries/${INQUIRY_ID}`,
        body: undefined,
      }),
    ]);
    const headers = requests[0]?.headers ?? {};
    expect(headers).toMatchObject({
      authorization: `Bearer ${API_KEY}`,
      accept: 'application/json',
      'user-agent': expect.stringMatching(/^openverify-node\//) as unknown,
    });
    expect(headers).not.toHaveProperty('idempotency-key');
    expect(headers).not.toHaveProperty('content-type');
    expect(headers).not.toHaveProperty('openverify-version');
  });

  it('sends OpenVerify-Version when the client names an API version', async () => {
    const { client, requests } = setup([{ status: 200, body: INQUIRY }], {
      apiVersion: '2026-10-01',
    });

    await client.inquiries.retrieve(INQUIRY_ID);

    expect(requests[0]?.headers['openverify-version']).toBe('2026-10-01');
  });

  it('keeps a path prefix of the base URL and ignores a trailing slash', async () => {
    const { client, requests } = setup([{ status: 200, body: INQUIRY }], {
      baseUrl: 'https://gateway.example.test/openverify/',
    });

    await client.inquiries.retrieve(INQUIRY_ID);

    expect(requests[0]?.url).toBe(
      `https://gateway.example.test/openverify/api/v1/inquiries/${INQUIRY_ID}`,
    );
  });

  it('encodes ids in paths', async () => {
    const { client, requests } = setup([{ status: 404, body: problem(404) }]);

    await expect(client.inquiries.retrieve('inq/../../admin')).rejects.toThrow(OpenVerifyApiError);

    expect(requests[0]?.url).toBe(
      'https://api.example.test/api/v1/inquiries/inq%2F..%2F..%2Fadmin',
    );
  });

  it('sends a ULID Idempotency-Key and a JSON body on POST and PATCH', async () => {
    const { client, requests } = setup([
      { status: 201, body: INQUIRY },
      { status: 200, body: INQUIRY },
    ]);

    await client.inquiries.create({ 'inquiry-template-id': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6' });
    await client.inquiries.update(INQUIRY_ID, { 'reference-id': 'ref-synthetic' });

    expect(requests.map((request) => [request.method, request.body])).toEqual([
      [
        'POST',
        {
          data: {
            type: 'inquiry',
            attributes: { 'inquiry-template-id': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6' },
          },
        },
      ],
      ['PATCH', { data: { type: 'inquiry', attributes: { 'reference-id': 'ref-synthetic' } } }],
    ]);
    for (const request of requests) {
      expect(request.headers['content-type']).toBe('application/json');
      expect(request.headers['idempotency-key']).toMatch(ULID_PATTERN);
    }
    expect(requests[0]?.headers['idempotency-key']).not.toBe(
      requests[1]?.headers['idempotency-key'],
    );
  });

  it("uses the caller's Idempotency-Key, and refuses one the API would reject", async () => {
    const { client, requests } = setup([{ status: 200, body: INQUIRY }]);

    await client.inquiries.approve(INQUIRY_ID, undefined, { idempotencyKey: 'order-42-approve' });

    expect(requests[0]?.headers['idempotency-key']).toBe('order-42-approve');
    await expect(
      client.inquiries.approve(INQUIRY_ID, undefined, { idempotencyKey: ' padded ' }),
    ).rejects.toThrow(TypeError);
    await expect(
      client.inquiries.approve(INQUIRY_ID, undefined, { idempotencyKey: 'k'.repeat(256) }),
    ).rejects.toThrow(TypeError);
    expect(requests).toHaveLength(1);
  });

  it('sends an empty JSON body for an action without meta, and { meta } otherwise', async () => {
    const { client, requests } = setup([
      { status: 200, body: INQUIRY },
      { status: 200, body: INQUIRY },
    ]);

    await client.inquiries.approve(INQUIRY_ID);
    await client.inquiries.addTag(INQUIRY_ID, { 'tag-name': 'vip' });

    expect(requests.map((request) => [request.url, request.body])).toEqual([
      [`https://api.example.test/api/v1/inquiries/${INQUIRY_ID}/approve`, {}],
      [
        `https://api.example.test/api/v1/inquiries/${INQUIRY_ID}/add-tag`,
        { meta: { 'tag-name': 'vip' } },
      ],
    ]);
  });
});

describe('errors', () => {
  it('throws OpenVerifyApiError with the parsed problem, without retrying a 4xx', async () => {
    const body = problem(422, {
      type: 'https://openverify.dev/problems/template-archived',
      title: 'Unprocessable Content',
      detail: 'The template is archived.',
      errors: [{ location: 'body', pointer: '/data', detail: 'Synthetic.' }],
    });
    const { client, requests, sleep } = setup([
      { status: 422, body, headers: { 'x-request-id': 'req-synthetic-1' } },
    ]);

    const error = await client.inquiries
      .create({ 'inquiry-template-id': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenVerifyApiError);
    expect(error).toBeInstanceOf(OpenVerifyError);
    expect(error).toMatchObject({
      name: 'OpenVerifyApiError',
      status: 422,
      problem: body,
      type: 'https://openverify.dev/problems/template-archived',
      requestId: 'req-synthetic-1',
      message: 'Unprocessable Content: The template is archived.',
    });
    expect((error as Error).message).not.toContain(API_KEY);
    expect(requests).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('exposes the code and reason of a problem (C25.1, C25.8), or null without them', async () => {
    const canceled = problem(401, {
      title: 'Unauthorized',
      detail: 'The session was canceled.',
      code: 'session_canceled',
      reason: 'inquiry_expired',
    });
    const plain = problem(404, { title: 'Not Found', detail: 'No such webhook.' });
    const { client } = setup([
      { status: 401, body: canceled },
      { status: 404, body: plain },
    ]);

    const first = await client.webhooks.retrieve(WEBHOOK_ID).catch((caught: unknown) => caught);
    const second = await client.webhooks.retrieve(WEBHOOK_ID).catch((caught: unknown) => caught);

    expect(first).toMatchObject({ code: 'session_canceled', reason: 'inquiry_expired' });
    expect(second).toMatchObject({ code: null, reason: null });
  });

  it('describes an error answer that is not a problem document', async () => {
    const { client } = setup([
      () => new Response('<html>Bad Gateway</html>', { status: 404, statusText: 'Not Found' }),
    ]);

    const error = (await client.webhooks
      .retrieve(WEBHOOK_ID)
      .catch((caught: unknown) => caught)) as OpenVerifyApiError;

    expect(error).toBeInstanceOf(OpenVerifyApiError);
    expect(error.problem).toEqual({ type: 'about:blank', title: 'Not Found', status: 404 });
    expect(error.requestId).toBeNull();
  });

  it('accepts members a later server adds and leaves them out, so a write that succeeded is not reported as failed (2B F028)', async () => {
    const data = INQUIRY.data as Record<string, unknown> & { attributes: Record<string, unknown> };
    const added = {
      ...INQUIRY,
      data: {
        ...data,
        attributes: { ...data.attributes, 'added-later': 'synthetic' },
        'added-member': true,
      },
      'added-top-level': { nested: 1 },
    };
    const { client } = setup([{ status: 201, body: added }]);

    const created = await client.inquiries.create({
      'inquiry-template-id': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
    });

    expect(created).toEqual(INQUIRY);
  });

  it('throws OpenVerifyResponseValidationError for a success that breaks the contract', async () => {
    const { client, requests } = setup([
      { status: 200, body: { data: { type: 'inquiry', id: 'not-an-id' } } },
      { status: 200, body: 'not json' },
    ]);

    await expect(client.inquiries.retrieve(INQUIRY_ID)).rejects.toThrow(
      OpenVerifyResponseValidationError,
    );
    await expect(client.inquiries.retrieve(INQUIRY_ID)).rejects.toThrow(
      OpenVerifyResponseValidationError,
    );
    expect(requests).toHaveLength(2);
  });
});

describe('retries', () => {
  it('retries a 5xx with exponential backoff and jitter, keeping the Idempotency-Key', async () => {
    const { client, requests, sleep } = setup(
      [
        { status: 503, body: problem(503) },
        { status: 502, body: problem(502) },
        { status: 201, body: INQUIRY },
      ],
      { random: () => 0.5 },
    );

    const document = await client.inquiries.create({
      'inquiry-template-id': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
    });

    expect(document).toEqual(INQUIRY);
    expect(requests).toHaveLength(3);
    const keys = new Set(requests.map((request) => request.headers['idempotency-key']));
    expect(keys.size).toBe(1);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([375, 750]);
  });

  it('keeps the jitter between half and the full backoff', async () => {
    const low = setup([{ status: 500, body: problem(500) }], { random: () => 0 });
    const high = setup([{ status: 500, body: problem(500) }], { random: () => 0.999 });

    await low.client.webhooks.retrieve(WEBHOOK_ID).catch(() => undefined);
    await high.client.webhooks.retrieve(WEBHOOK_ID).catch(() => undefined);

    expect(low.sleep.mock.calls[0]?.[0]).toBe(250);
    expect(high.sleep.mock.calls[0]?.[0]).toBeGreaterThan(495);
    expect(high.sleep.mock.calls[0]?.[0]).toBeLessThanOrEqual(500);
  });

  it('honours Retry-After in seconds and as an HTTP date on 429', async () => {
    const date = new Date(Date.now() + 3000).toUTCString();
    const { client, sleep } = setup([
      { status: 429, body: problem(429), headers: { 'retry-after': '2' } },
      { status: 429, body: problem(429), headers: { 'retry-after': date } },
      { status: 200, body: INQUIRY },
    ]);

    await client.inquiries.retrieve(INQUIRY_ID);

    expect(sleep.mock.calls[0]?.[0]).toBe(2000);
    expect(sleep.mock.calls[1]?.[0]).toBeGreaterThan(1000);
    expect(sleep.mock.calls[1]?.[0]).toBeLessThanOrEqual(3000);
  });

  it('gives up at once when Retry-After asks for longer than a minute', async () => {
    const { client, requests, sleep } = setup([
      { status: 429, body: problem(429), headers: { 'retry-after': '3600' } },
    ]);

    await expect(client.inquiries.retrieve(INQUIRY_ID)).rejects.toMatchObject({ status: 429 });
    expect(requests).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws the last error once the retries run out', async () => {
    const { client, requests } = setup([
      { status: 500, body: problem(500) },
      { status: 500, body: problem(500) },
      { status: 503, body: problem(503, { detail: 'Last.' }) },
    ]);

    await expect(client.inquiries.retrieve(INQUIRY_ID)).rejects.toMatchObject({
      status: 503,
      problem: { detail: 'Last.' },
    });
    expect(requests).toHaveLength(3);
  });

  it('retries a 409 idempotency-key-in-use, because the first request is still running', async () => {
    const inUse = problem(409, {
      type: 'https://openverify.dev/problems/idempotency-key-in-use',
      title: 'Conflict',
    });
    const transition = problem(409, {
      type: 'https://openverify.dev/problems/invalid-transition',
      title: 'Conflict',
    });
    const { client, requests } = setup([
      { status: 409, body: inUse },
      { status: 200, body: INQUIRY },
      { status: 409, body: transition },
    ]);

    await expect(client.inquiries.approve(INQUIRY_ID)).resolves.toEqual(INQUIRY);
    await expect(client.inquiries.approve(INQUIRY_ID)).rejects.toMatchObject({ status: 409 });
    expect(requests).toHaveLength(3);
  });

  it('retries network errors, then throws OpenVerifyConnectionError with the cause', async () => {
    const cause = new TypeError('fetch failed');
    const { client, requests } = setup([{ error: cause }, { error: cause }, { error: cause }]);

    const error = await client.inquiries.retrieve(INQUIRY_ID).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenVerifyConnectionError);
    expect((error as Error).cause).toBe(cause);
    expect(requests).toHaveLength(3);
  });

  it('recovers from a network error', async () => {
    const { client, requests } = setup([
      { error: new TypeError('fetch failed') },
      { status: 200, body: INQUIRY },
    ]);

    await expect(client.inquiries.retrieve(INQUIRY_ID)).resolves.toEqual(INQUIRY);
    expect(requests).toHaveLength(2);
  });

  it('does not retry when maxRetries is 0', async () => {
    const { client, requests } = setup([{ status: 503, body: problem(503) }], { maxRetries: 0 });

    await expect(client.inquiries.retrieve(INQUIRY_ID)).rejects.toThrow(OpenVerifyApiError);
    expect(requests).toHaveLength(1);
  });
});

describe('timeouts and cancellation', () => {
  it('aborts an attempt after timeoutMs, retries it, then throws OpenVerifyTimeoutError', async () => {
    const { client, requests } = setup([{ hang: true }, { hang: true }], {
      timeoutMs: 5,
      maxRetries: 1,
    });

    const error = await client.inquiries.retrieve(INQUIRY_ID).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenVerifyTimeoutError);
    expect(error).toBeInstanceOf(OpenVerifyConnectionError);
    expect((error as Error).message).toContain('5 ms');
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.signal?.aborted === true)).toBe(true);
  });

  it("stops at once, without retrying, when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    const { client, requests } = setup([
      () => {
        controller.abort(reason);
        return Promise.reject(reason);
      },
    ]);

    await expect(
      client.inquiries.retrieve(INQUIRY_ID, undefined, { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(requests).toHaveLength(1);
  });

  it('refuses a request whose signal already aborted, without sending it', async () => {
    const { client, requests } = setup();
    const controller = new AbortController();
    controller.abort(new Error('already'));

    await expect(
      client.webhooks.retrieve(WEBHOOK_ID, { signal: controller.signal }),
    ).rejects.toThrow('already');
    expect(requests).toHaveLength(0);
  });

  it('waits between retries on timers by default, and the caller can cancel the wait', async () => {
    vi.useFakeTimers();
    try {
      const fake = scriptedFetch([
        { status: 503, body: problem(503) },
        { status: 200, body: INQUIRY },
        { status: 503, body: problem(503) },
      ]);
      const client = createClient({
        apiKey: API_KEY,
        baseUrl: 'https://api.example.test',
        fetch: fake.fetch,
        random: () => 0,
      });

      const retried = client.inquiries.retrieve(INQUIRY_ID);
      await vi.advanceTimersByTimeAsync(249);
      expect(fake.requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(retried).resolves.toEqual(INQUIRY);
      expect(fake.requests).toHaveLength(2);

      const controller = new AbortController();
      const canceled = client.inquiries.retrieve(INQUIRY_ID, undefined, {
        signal: controller.signal,
      });
      const outcome = expect(canceled).rejects.toThrow('stop waiting');
      await vi.advanceTimersByTimeAsync(10);
      expect(fake.requests).toHaveLength(3);
      controller.abort(new Error('stop waiting'));
      await outcome;
      await vi.advanceTimersByTimeAsync(1000);
      expect(fake.requests).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('lists', () => {
  const page = (ids: string[], next: string | null) => ({
    data: ids.map((id) => ({
      ...(apiFixture('webhook-delivery').data as Record<string, unknown>),
      id,
    })),
    links: { next },
  });
  const D1 = 'whd_01M5CK55MG5CV42K2QC9PQH0W1';
  const D2 = 'whd_01M5CK55MG5CV42K2QC9PQH0W2';
  const D3 = 'whd_01M5CK55MG5CV42K2QC9PQH0W3';

  it('encodes filters and the page in the query string', async () => {
    const { client, requests } = setup([{ status: 200, body: page([D1], null) }]);

    await client.webhookDeliveries.list({
      filter: {
        status: ['pending', 'failed'],
        'webhook-id': WEBHOOK_ID,
        'created-at-start': new Date('2026-10-01T00:00:00.000Z'),
      },
      page: { size: 5, after: D3 },
    });

    const url = new URL(requests[0]?.url ?? '');
    expect(url.pathname).toBe('/api/v1/webhook-deliveries');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'filter[status]': 'pending,failed',
      'filter[webhook-id]': WEBHOOK_ID,
      'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
      'page[size]': '5',
      'page[after]': D3,
    });
  });

  it('leaves out undefined filters, and refuses several values for a one-value filter', async () => {
    const { client, requests } = setup([
      { status: 200, body: { data: [], links: { next: null } } },
    ]);

    await client.accounts.list({ filter: { status: undefined, 'reference-id': 'a,b' } });

    expect(new URL(requests[0]?.url ?? '').search).toBe('?filter%5Breference-id%5D=a%2Cb');
    await expect(client.accounts.list({ filter: { 'reference-id': ['a', 'b'] } })).rejects.toThrow(
      TypeError,
    );
    expect(requests).toHaveLength(1);
  });

  // 2B F029: the created-at range (C9) is typed and sent only on lists whose query accepts it.
  describe('the created-at range', () => {
    const range = {
      'created-at-start': new Date('2026-10-01T00:00:00.000Z'),
      'created-at-end': new Date('2026-10-02T00:00:00.000Z'),
    };

    it('is part of the filter type of every list that accepts it, and of no other', () => {
      const { client } = setup([]);
      // Checked by `tsc --noEmit`: each call compiles exactly when its list takes the range.
      const typed = (c: OpenVerifyClient) => [
        c.inquiries.list({ filter: range }),
        c.inquirySessions.list({ filter: range }),
        c.inquiryTemplateVersions.list({ filter: range }),
        c.accounts.list({ filter: range }),
        c.accountTypes.list({ filter: range }),
        c.webhookDeliveries.list({ filter: range }),
        c.events.list({ filter: range }),
        c.apiKeys.list({ filter: range }),
        c.apiLogs.list({ filter: range }),
        c.userAuditLogs.list({ filter: range }),
        // @ts-expect-error GET /inquiry-templates takes no filter at all
        c.inquiryTemplates.list({ filter: range }),
        // @ts-expect-error GET /webhooks takes no filter at all
        c.webhooks.list({ filter: range }),
        // @ts-expect-error neither does listAll()
        c.webhooks.listAll({ filter: range }),
      ];

      expect(typed).toBeTypeOf('function');
      expect(client).toBeDefined();
    });

    it('is sent on a list that accepts it', async () => {
      const { client, requests } = setup([
        { status: 200, body: { data: [], links: { next: null } } },
      ]);

      await client.apiKeys.list({ filter: range });

      expect(Object.fromEntries(new URL(requests[0]?.url ?? '').searchParams)).toEqual({
        'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
        'filter[created-at-end]': '2026-10-02T00:00:00.000Z',
      });
    });

    it.each(['inquiryTemplates', 'webhooks'] as const)(
      'is refused before sending on %s, whose list answers 400 for it',
      async (group) => {
        const { client, requests } = setup([]);
        const filter = { 'created-at-start': range['created-at-start'] } as never;

        await expect(client[group].list({ filter })).rejects.toThrow(
          new TypeError('filter[created-at-start] is not accepted by this list'),
        );
        expect(requests).toHaveLength(0);
      },
    );
  });

  it('encodes boolean filters', async () => {
    const { client, requests } = setup([
      { status: 200, body: { data: [], links: { next: null } } },
    ]);

    await client.events.list({ filter: { simulated: true } });

    expect(new URL(requests[0]?.url ?? '').searchParams.get('filter[simulated]')).toBe('true');
  });

  it('list() returns one page; listAll() follows the next links to the end', async () => {
    const second = `/api/v1/webhook-deliveries?filter[status]=failed&page[after]=${D2}&page[size]=2`;
    const { client, requests } = setup(
      [
        { status: 200, body: page([D1, D2], second) },
        { status: 200, body: page([D1, D2], second) },
        { status: 200, body: page([D3], null) },
      ],
      { baseUrl: 'https://gateway.example.test/openverify' },
    );

    const first = await client.webhookDeliveries.list({
      filter: { status: 'failed' },
      page: { size: 2 },
    });
    const all: string[] = [];
    for await (const delivery of client.webhookDeliveries.listAll({
      filter: { status: 'failed' },
      page: { size: 2 },
    })) {
      all.push(delivery.id);
    }

    expect(first.data.map((delivery) => delivery.id)).toEqual([D1, D2]);
    expect(first.links.next).toBe(second);
    expect(all).toEqual([D1, D2, D3]);
    expect(requests.map((request) => request.url)).toEqual([
      'https://gateway.example.test/openverify/api/v1/webhook-deliveries?filter%5Bstatus%5D=failed&page%5Bsize%5D=2',
      'https://gateway.example.test/openverify/api/v1/webhook-deliveries?filter%5Bstatus%5D=failed&page%5Bsize%5D=2',
      `https://gateway.example.test/openverify${second}`,
    ]);
  });

  it('refuses a next link outside the API', async () => {
    const { client } = setup([
      { status: 200, body: page([D1], 'https://elsewhere.example.test/x') },
    ]);

    const seen: string[] = [];
    const iterate = async () => {
      for await (const delivery of client.webhookDeliveries.listAll()) {
        seen.push(delivery.id);
      }
    };

    await expect(iterate()).rejects.toThrow(OpenVerifyResponseValidationError);
    expect(seen).toEqual([D1]);
  });
});
