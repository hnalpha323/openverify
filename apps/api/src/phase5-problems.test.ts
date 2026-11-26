/**
 * C52.7: every Phase 5 problem code, thrown as a `Phase5ProblemError` on a route that documents
 * its status, answers exactly its golden problem in `contracts/fixtures/problems/flow/` (the
 * request id aside), extension members included; and `otp_rate_limited` answers 503 while the
 * limit store is down.
 */
import { readdirSync, readFileSync } from 'node:fs';
import {
  PHASE10_FLOW_PROBLEM_STATUSES,
  PHASE5_PROBLEM_CODES,
  PHASE5_PROBLEM_STATUSES,
  phase5ProblemCodeSchema,
} from '@openverify/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Phase5ProblemError } from './errors.js';
import { problemResponses } from './plugins/openapi.js';

const FIXTURES = new URL('../../../contracts/fixtures/problems/flow/', import.meta.url);

interface GoldenProblem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  code: string;
  [member: string]: unknown;
}

// Workflow 10B (C221.6): integrity_challenge_invalid's golden sits beside them; the integrity routes test it.
// Workflow 10C (C221.6): so do the client-unable and sandbox-chip ones (phase10-flow-problems.test.ts).
const PHASE10_GOLDEN: ReadonlySet<string> = new Set(
  Object.keys(PHASE10_FLOW_PROBLEM_STATUSES).map((code) => `${code.replaceAll('_', '-')}.json`),
);
const golden: GoldenProblem[] = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json') && !PHASE10_GOLDEN.has(name))
  .map((name) => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as GoldenProblem);

const BASE_MEMBERS = new Set([
  'type',
  'title',
  'status',
  'detail',
  'instance',
  'requestId',
  'code',
]);

const app = buildApp({
  lookupApiKey: () => Promise.resolve(null),
  logger: false,
  mode: 'production',
});
for (const [index, problem] of golden.entries()) {
  const code = phase5ProblemCodeSchema.parse(problem.code);
  const members = Object.fromEntries(
    Object.entries(problem).filter(([key]) => !BASE_MEMBERS.has(key)),
  ) as Record<string, string | number>;
  app.post(
    `/golden/${String(index)}/*`,
    {
      config: { public: true },
      schema: { response: problemResponses(PHASE5_PROBLEM_STATUSES[code]) },
    },
    () => {
      throw new Phase5ProblemError(code, problem.detail, { members });
    },
  );
}
app.post(
  '/store-down',
  { config: { public: true }, schema: { response: problemResponses(429, 503) } },
  () => {
    throw new Phase5ProblemError('otp_rate_limited', 'The limit store is unavailable.', {
      storeUnavailable: true,
    });
  },
);

afterAll(() => app.close());

describe('Phase 5 problems (C52.7)', () => {
  it('has one golden problem per code', () => {
    expect(golden.map((problem) => problem.code).sort()).toEqual([...PHASE5_PROBLEM_CODES].sort());
  });

  it.each(golden.map((problem, index) => [problem.code, index, problem] as const))(
    'answers %s exactly as its golden problem',
    async (_code, index, problem) => {
      const path = problem.instance.replace(/^\/api\/v1\/flow\//, '');
      const response = await app.inject({
        method: 'POST',
        url: `/golden/${String(index)}/${path}`,
      });

      expect(response.statusCode).toBe(problem.status);
      expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
      expect(response.json()).toEqual({
        ...problem,
        instance: `/golden/${String(index)}/${path}`,
        requestId: expect.any(String) as unknown,
      });
    },
  );

  it('answers otp_rate_limited with 503 while the limit store is down', async () => {
    const response = await app.inject({ method: 'POST', url: '/store-down' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      code: 'otp_rate_limited',
    });
  });

  it('refuses the store-down status for any other code', () => {
    expect(
      () => new Phase5ProblemError('otp_incorrect', 'Wrong.', { storeUnavailable: true }),
    ).toThrow(RangeError);
  });
});
