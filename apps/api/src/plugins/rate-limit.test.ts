import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RateLimitPolicy } from '@openverify/contracts';
import { UnauthorizedError } from '../errors.js';
import type { RateLimiter, RateLimitRule } from '../ports.js';
import { registerProblemDetails } from '../problem-details.js';
import {
  createAllowAllRateLimiter,
  createDenyRateLimiter,
  fixedClock,
  type RecordingRateLimiter,
} from '../test-support/fakes.js';
import { userPrincipal } from '../test-support/principals.js';
import principalAuth, { type ApiKeyRecord } from './principal-auth.js';
import rateLimit, { rateLimitRules, ONE_TIME_LINK_REDEEM_ROUTE } from './rate-limit.js';

// Synthetic tokens; real ones come from generateApiKey() and newSessionToken().
const KEY_TOKEN = 'ov_sbx_SyntheticRateLimitTokenAAAAAAAAAAAAAAAAAAAA';
const USER_TOKEN = 'ovu_SyntheticRateLimitUserTokenAAAAAAAAAAAAAAAAAA';
const SESSION_TOKEN = 'ovs_good';
const PROBLEM_JSON = 'application/problem+json; charset=utf-8';

const KEY: ApiKeyRecord = {
  id: 'key_01M5CJXHG0RVK7X4H9941FSM5K',
  organizationId: 'org_1',
  environmentId: 'env_1',
  environmentKind: 'sandbox',
  scopes: ['inquiries:read'],
  expiresAt: null,
  revokedAt: null,
};
const USER = userPrincipal({
  organizationId: 'org_1',
  environmentId: 'env_1',
  userSessionId: 'uss_01M5CJXHG0RVK7X4H9941FSM5K',
});

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

interface Built {
  app: FastifyInstance;
  handler: ReturnType<typeof vi.fn>;
  flowAuth: ReturnType<typeof vi.fn>;
  logs: Record<string, unknown>[];
}

/** Principal auth, the plugin under test, a stand-in flow scope and probe routes. */
function build(limiter: RateLimiter, rules = rateLimitRules()): Built {
  const logs: Record<string, unknown>[] = [];
  const app = Fastify({
    logger: {
      level: 'info',
      stream: { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
    },
  });
  apps.push(app);
  registerProblemDetails(app, { exposeInternals: true });
  // A scope created before the decorations, as @fastify/swagger's routes are.
  void app.register((early, _options, next) => {
    early.get('/early', { config: { public: true } }, () => ({ early: true }));
    next();
  });
  void app.register(principalAuth, {
    lookupApiKey: (token) => Promise.resolve(token === KEY_TOKEN ? KEY : null),
    resolveUserSession: (token) => Promise.resolve(token === USER_TOKEN ? USER : null),
  });
  const clock = fixedClock();
  void app.register(rateLimit, { limiter, clock, rules });

  const handler = vi.fn(() => ({ ok: true }));
  app.get('/api/v1/things', { config: { scopes: [] } }, handler);
  app.get('/api/v1/missing', { config: { scopes: [] } }, () => {
    throw Object.assign(new Error('nope'), { statusCode: 404 });
  });
  app.get('/health', { config: { public: true } }, () => ({ status: 'ok' }));
  app.get('/api/v1/dashboard/me', { config: { public: true } }, () => ({ me: true }));

  // The flow API authenticates its own session tokens in its scope, as routes/flow does.
  const flowAuth = vi.fn((authorization: string | undefined) => {
    if (authorization !== `Bearer ${SESSION_TOKEN}`) {
      throw new UnauthorizedError('The session token is not valid or has expired.');
    }
  });
  void app.register(
    async (flow) => {
      flow.addHook('onRoute', (route) => {
        route.config =
          route.method === 'OPTIONS'
            ? { ...route.config, public: true }
            : { ...route.config, auth: 'session-token' };
      });
      await flow.register(
        fp((scope, _options, done) => {
          scope.decorateRequest('flowSession', null);
          scope.addHook('onRequest', (request, _reply, next) => {
            if (request.routeOptions.config.public === true) {
              next();
              return;
            }
            try {
              flowAuth(request.headers.authorization);
            } catch (error) {
              next(error as Error);
              return;
            }
            request.flowSession = { id: 'iqse_1', environmentId: 'env_1', inquiryId: 'inq_1' };
            next();
          });
          done();
        }),
      );
      flow.get('/session', handler);
      flow.options('/session', () => '');
      flow.post('/one-time-links/redeem', { config: { public: true } }, () => ({ redeemed: 1 }));
    },
    { prefix: '/api/v1/flow' },
  );
  return { app, handler, flowAuth, logs };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const API_RULE: RateLimitRule = { name: 'api', limit: 300, windowSeconds: 60 };

describe('rateLimitRules', () => {
  it('uses the C12 defaults, each in its policy window', () => {
    expect(rateLimitRules()).toEqual({
      api: API_RULE,
      'flow-session': { name: 'flow-session', limit: 120, windowSeconds: 60 },
      'flow-ip': { name: 'flow-ip', limit: 600, windowSeconds: 60 },
      'one-time-link-redeem': { name: 'one-time-link-redeem', limit: 30, windowSeconds: 60 },
      // C72.5 (Phase 6): built here, enforced per environment by the report routes.
      reports: { name: 'reports', limit: 600, windowSeconds: 60 },
      // C107.3 (Phase 7, F09): each policy has its own window. Stage 1b of Workflow 7A enforces
      // the flow ones here; Workflow 7B enforces graph-unmask on its route.
      'flow-signals': { name: 'flow-signals', limit: 60, windowSeconds: 60 },
      'flow-handoffs': { name: 'flow-handoffs', limit: 5, windowSeconds: 3600 },
      'flow-handoffs-ip': { name: 'flow-handoffs-ip', limit: 10, windowSeconds: 3600 },
      'graph-unmask': { name: 'graph-unmask', limit: 60, windowSeconds: 60 },
      // C107.3 (Workflow 7B): each route owner enforces its policy, as the report routes do.
      'lists-write': { name: 'lists-write', limit: 600, windowSeconds: 60 },
      'lists-match': { name: 'lists-match', limit: 60, windowSeconds: 60 },
      importers: { name: 'importers', limit: 10, windowSeconds: 3600 },
      'graph-queries': { name: 'graph-queries', limit: 30, windowSeconds: 60 },
      // C143.3 (Workflow 8A): built here, enforced by each route and action owner.
      'workflow-triggers': { name: 'workflow-triggers', limit: 600, windowSeconds: 60 },
      'workflow-triggers-key': { name: 'workflow-triggers-key', limit: 60, windowSeconds: 60 },
      'workflow-runs': { name: 'workflow-runs', limit: 600, windowSeconds: 60 },
      'workflow-subject': { name: 'workflow-subject', limit: 60, windowSeconds: 60 },
      'workflow-http': { name: 'workflow-http', limit: 600, windowSeconds: 60 },
      'workflow-email': { name: 'workflow-email', limit: 1_000, windowSeconds: 3600 },
      'workflow-email-recipient-hour': {
        name: 'workflow-email-recipient-hour',
        limit: 5,
        windowSeconds: 3600,
      },
      'workflow-email-recipient-day': {
        name: 'workflow-email-recipient-day',
        limit: 20,
        windowSeconds: 86_400,
      },
      'workflow-email-install': {
        name: 'workflow-email-install',
        limit: 20,
        windowSeconds: 86_400,
      },
      'workflow-slack': { name: 'workflow-slack', limit: 1, windowSeconds: 1 },
      'workflow-code': { name: 'workflow-code', limit: 600, windowSeconds: 60 },
      // C143.3 (Workflow 8B): built here, enforced by each route and action owner.
      'case-search': { name: 'case-search', limit: 120, windowSeconds: 60 },
      'case-create': { name: 'case-create', limit: 600, windowSeconds: 3600 },
      'case-exports': { name: 'case-exports', limit: 10, windowSeconds: 3600 },
      'case-attachments': { name: 'case-attachments', limit: 60, windowSeconds: 60 },
      // C174.4 (Workflow 9A): built here, enforced by each route owner (`enforceRoutePolicy`).
      'template-preview': { name: 'template-preview', limit: 120, windowSeconds: 60 },
      'translations-import': { name: 'translations-import', limit: 30, windowSeconds: 3600 },
      'internal-embed-policy': { name: 'internal-embed-policy', limit: 6000, windowSeconds: 60 },
      'theme-assets': { name: 'theme-assets', limit: 30, windowSeconds: 3600 },
      // C174.4 (Workflow 9B Stage 1b (A)): enforced by the analytics routes.
      analytics: { name: 'analytics', limit: 60, windowSeconds: 60 },
      // C174.4 (Workflow 9B Stage 1b (U)): enforced by the invitation resend route.
      'invitations-resend': { name: 'invitations-resend', limit: 5, windowSeconds: 3600 },
      // C174.4 (Workflow 9B Stage 1b (X)): enforced by the export and bulk report routes.
      exports: { name: 'exports', limit: 10, windowSeconds: 3600 },
      'report-bulk': { name: 'report-bulk', limit: 5, windowSeconds: 3600 },
      // C221.7 (Workflow 10B Stage 1b (I)): both integrity routes, per inquiry.
      'flow-integrity': { name: 'flow-integrity', limit: 5, windowSeconds: 3600 },
      // C221.7 (Workflow 10C Stage 1a (N)): the sandbox test chip route, per inquiry.
      'flow-sandbox-chip': { name: 'flow-sandbox-chip', limit: 10, windowSeconds: 3600 },
      // C240.3 (Workflow 11A Stage 1a): redemptions and peeks, per principal and environment.
      'connect-redeem': { name: 'connect-redeem', limit: 60, windowSeconds: 60 },
      'connect-peek': { name: 'connect-peek', limit: 60, windowSeconds: 60 },
      // C253.7 (Workflow 11B Stage 1a): enforced by the export's route, failing closed.
      'account-export': { name: 'account-export', limit: 10, windowSeconds: 3600 },
    });
  });

  it('keeps a configured limit within its policy window', () => {
    const handoffs = 'flow-handoffs' as RateLimitPolicy;
    expect(rateLimitRules({ [handoffs]: 2 })[handoffs]).toEqual({
      name: 'flow-handoffs',
      limit: 2,
      windowSeconds: 3600,
    });
  });

  it('takes configured limits per policy', () => {
    expect(rateLimitRules({ api: 5 }).api).toEqual({ name: 'api', limit: 5, windowSeconds: 60 });
  });
});

describe('server API rate limiting (C12)', () => {
  it('counts each request against the api policy of its API key and sends RateLimit headers', async () => {
    const limiter = createAllowAllRateLimiter(fixedClock());
    const { app } = build(limiter);

    const response = await app.inject({ url: '/api/v1/things', headers: bearer(KEY_TOKEN) });

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'ratelimit-limit': '300',
      'ratelimit-remaining': '299',
      'ratelimit-reset': '60',
    });
    expect(limiter.calls).toEqual([{ key: KEY.id, policy: API_RULE }]);
  });

  it('keys a dashboard user session by its session', async () => {
    const limiter = createAllowAllRateLimiter();
    const { app } = build(limiter);

    await app.inject({ url: '/api/v1/things', headers: bearer(USER_TOKEN) });

    expect(limiter.calls).toEqual([{ key: USER.userSessionId, policy: API_RULE }]);
  });

  it('applies the configured api limit', async () => {
    const limiter = createAllowAllRateLimiter();
    const { app } = build(limiter, rateLimitRules({ api: 5 }));

    const response = await app.inject({ url: '/api/v1/things', headers: bearer(KEY_TOKEN) });

    expect(response.headers['ratelimit-limit']).toBe('5');
    expect(response.headers['ratelimit-remaining']).toBe('4');
  });

  it('answers 429 rate-limited with Retry-After, without running the handler', async () => {
    const { app, handler } = build(createDenyRateLimiter(30));

    const response = await app.inject({ url: '/api/v1/things', headers: bearer(KEY_TOKEN) });

    expect(response.statusCode).toBe(429);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.headers).toMatchObject({
      'retry-after': '30',
      'ratelimit-limit': '300',
      'ratelimit-remaining': '0',
      'ratelimit-reset': '30',
    });
    expect(response.json()).toMatchObject({
      type: 'https://openverify.dev/problems/rate-limited',
      status: 429,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('sends the headers on error responses too', async () => {
    const { app } = build(createAllowAllRateLimiter());

    const response = await app.inject({ url: '/api/v1/missing', headers: bearer(KEY_TOKEN) });

    expect(response.statusCode).toBe(404);
    expect(response.headers['ratelimit-limit']).toBe('300');
  });

  it('fails open when the limiter is unavailable: the request runs, no headers, an error log', async () => {
    const limiter: RateLimiter = {
      consume: () => Promise.reject(new Error('Valkey is unavailable')),
    };
    const { app, handler, logs } = build(limiter);

    const response = await app.inject({ url: '/api/v1/things', headers: bearer(KEY_TOKEN) });

    expect(response.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(Object.keys(response.headers).filter((name) => name.startsWith('ratelimit'))).toEqual(
      [],
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 50,
        policy: 'api',
        msg: expect.stringMatching(/fail(ing)? open/) as unknown,
      }),
    );
  });

  it('limits neither unauthenticated requests nor public and dashboard routes', async () => {
    const limiter = createAllowAllRateLimiter();
    const { app } = build(limiter);

    const unauthenticated = await app.inject({ url: '/api/v1/things' });
    const health = await app.inject({ url: '/health' });
    const dashboard = await app.inject({ url: '/api/v1/dashboard/me' });

    expect(unauthenticated.statusCode).toBe(401);
    expect(health.headers['ratelimit-limit']).toBeUndefined();
    expect(dashboard.headers['ratelimit-limit']).toBeUndefined();
    expect(limiter.calls).toEqual([]);
  });
});

describe('routes in scopes created before the plugin', () => {
  it('are served without limits', async () => {
    const limiter = createAllowAllRateLimiter();
    const { app } = build(limiter);

    const response = await app.inject({ url: '/early' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['ratelimit-limit']).toBeUndefined();
    expect(limiter.calls).toEqual([]);
  });
});

describe('flow API rate limiting (C12)', () => {
  const flowCalls = (limiter: RecordingRateLimiter) =>
    limiter.calls.map(({ key, policy }) => [policy.name, key]);

  it('limits each call per client address and per session, reporting the tighter limit', async () => {
    const limiter = createAllowAllRateLimiter();
    const { app } = build(limiter);

    const response = await app.inject({
      url: '/api/v1/flow/session',
      headers: bearer(SESSION_TOKEN),
      remoteAddress: '203.0.113.7',
    });

    expect(response.statusCode).toBe(200);
    expect(flowCalls(limiter)).toEqual([
      ['flow-ip', '203.0.113.7'],
      ['flow-session', 'iqse_1'],
    ]);
    expect(response.headers).toMatchObject({
      'ratelimit-limit': '120',
      'ratelimit-remaining': '119',
    });
  });

  it('refuses a client over its address limit before the session is looked up', async () => {
    const limiter = createDenyRateLimiter(12);
    const { app, flowAuth, handler } = build(limiter);

    const response = await app.inject({
      url: '/api/v1/flow/session',
      headers: bearer(SESSION_TOKEN),
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('12');
    expect(flowAuth).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(flowCalls(limiter)).toEqual([['flow-ip', '127.0.0.1']]);
  });

  it('refuses a session over its own limit', async () => {
    const allow = createAllowAllRateLimiter();
    const deny = createDenyRateLimiter(5);
    const limiter: RateLimiter = {
      consume: (key, policy) =>
        (policy.name === 'flow-session' ? deny : allow).consume(key, policy),
    };
    const { app, handler } = build(limiter);

    const response = await app.inject({
      url: '/api/v1/flow/session',
      headers: bearer(SESSION_TOKEN),
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers).toMatchObject({ 'retry-after': '5', 'ratelimit-limit': '120' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not count calls whose session token is refused against any session', async () => {
    const limiter = createAllowAllRateLimiter();
    const { app } = build(limiter);

    const response = await app.inject({
      url: '/api/v1/flow/session',
      headers: bearer('ovs_wrong'),
    });

    expect(response.statusCode).toBe(401);
    expect(flowCalls(limiter)).toEqual([['flow-ip', '127.0.0.1']]);
  });

  it('limits one-time link redemption per client address', async () => {
    const limiter = createAllowAllRateLimiter();
    const { app } = build(limiter);

    const response = await app.inject({
      method: 'POST',
      url: ONE_TIME_LINK_REDEEM_ROUTE,
      remoteAddress: '198.51.100.4',
    });

    expect(response.statusCode).toBe(200);
    expect(flowCalls(limiter)).toEqual([
      ['flow-ip', '198.51.100.4'],
      ['one-time-link-redeem', '198.51.100.4'],
    ]);
    expect(response.headers['ratelimit-limit']).toBe('30');
  });

  it('does not count CORS preflights', async () => {
    const limiter = createAllowAllRateLimiter();
    const { app } = build(limiter);

    await app.inject({ method: 'OPTIONS', url: '/api/v1/flow/session' });

    expect(limiter.calls).toEqual([]);
  });

  it('fails open on the flow API too', async () => {
    const { app, handler } = build({ consume: () => Promise.reject(new Error('down')) });

    const response = await app.inject({
      url: '/api/v1/flow/session',
      headers: bearer(SESSION_TOKEN),
    });

    expect(response.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(response.headers['ratelimit-limit']).toBeUndefined();
  });
});
