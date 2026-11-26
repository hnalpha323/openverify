/**
 * C221.6 (Workflow 10C Stage 1a, `contracts-10c`): each 10C problem of the flow API, thrown as a
 * `Phase10FlowProblemError` on a route that documents its status, answers exactly its golden
 * problem in `contracts/fixtures/problems/flow/` (the request id aside).
 */
import { readFileSync } from 'node:fs';
import { PHASE10_FLOW_PROBLEM_STATUSES, type Phase10FlowProblemCode } from '@openverify/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Phase10FlowProblemError } from './errors.js';
import { problemResponses } from './plugins/openapi.js';

const FIXTURES = new URL('../../../contracts/fixtures/problems/flow/', import.meta.url);

interface GoldenProblem {
  status: number;
  detail: string;
  instance: string;
  code: string;
}

const CODES: Phase10FlowProblemCode[] = [
  'client_unable_not_allowed',
  'sandbox_chip_anchor_missing',
  'sandbox_chip_scenario_unavailable',
];
const golden = CODES.map(
  (code) =>
    JSON.parse(
      readFileSync(new URL(`${code.replaceAll('_', '-')}.json`, FIXTURES), 'utf8'),
    ) as GoldenProblem,
);

const app = buildApp({
  lookupApiKey: () => Promise.resolve(null),
  logger: false,
  mode: 'production',
});
for (const [index, code] of CODES.entries()) {
  app.post(
    `/golden/${String(index)}`,
    {
      config: { public: true },
      schema: { response: problemResponses(PHASE10_FLOW_PROBLEM_STATUSES[code]) },
    },
    () => {
      throw new Phase10FlowProblemError(code, golden[index]?.detail ?? '');
    },
  );
}

afterAll(() => app.close());

describe('the 10C problems of the flow API (C221.6)', () => {
  it.each(CODES.map((code, index) => [code, index] as const))(
    'answers %s exactly as its golden problem',
    async (code, index) => {
      const response = await app.inject({ method: 'POST', url: `/golden/${String(index)}` });

      expect(response.statusCode).toBe(PHASE10_FLOW_PROBLEM_STATUSES[code]);
      expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
      expect(response.json()).toEqual({
        ...golden[index],
        instance: `/golden/${String(index)}`,
        requestId: expect.any(String) as unknown,
      });
    },
  );
});
