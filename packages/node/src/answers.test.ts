/**
 * The answer helpers the client uses, exported for callers that reach an endpoint the client
 * has no method for (the dashboard BFF's dashboard API calls): the same contract parsing and the
 * same errors as every client method.
 */
import { problemSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiErrorOf, parseApiAnswer } from './answers.js';
import { OpenVerifyApiError, OpenVerifyResponseValidationError } from './errors.js';

const schema = z.strictObject({
  data: z.strictObject({ id: z.string(), attributes: z.strictObject({ name: z.string() }) }),
});

describe('parseApiAnswer', () => {
  it('parses a success with the contract schema', () => {
    const text = JSON.stringify({ data: { id: 'x', attributes: { name: 'Synthetic' } } });

    expect(parseApiAnswer(schema, 200, text)).toEqual({
      data: { id: 'x', attributes: { name: 'Synthetic' } },
    });
  });

  it('drops members a later server adds, at any depth (2B F028)', () => {
    const text = JSON.stringify({
      data: { id: 'x', attributes: { name: 'Synthetic', added: 1 }, links: {} },
      meta: { added: true },
    });

    expect(parseApiAnswer(schema, 200, text)).toEqual({
      data: { id: 'x', attributes: { name: 'Synthetic' } },
    });
  });

  it('parses an empty body as undefined, for 204 answers', () => {
    const answer = parseApiAnswer(z.null().optional(), 204, '');

    expect(answer).toBeUndefined();
  });

  it('refuses an answer that breaks the contract, with the issues', () => {
    const failure = (() => {
      try {
        parseApiAnswer(schema, 201, JSON.stringify({ data: { id: 1 } }));
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(failure).toBeInstanceOf(OpenVerifyResponseValidationError);
    expect(failure).toMatchObject({ status: 201 });
    expect((failure as OpenVerifyResponseValidationError).issues.length).toBeGreaterThan(0);
  });

  it('refuses a body that is not JSON', () => {
    expect(() => parseApiAnswer(schema, 200, '<html>')).toThrow(
      new OpenVerifyResponseValidationError('The API answer is not JSON', 200),
    );
  });
});

describe('apiErrorOf', () => {
  const problem = problemSchema.parse({
    type: 'https://openverify.dev/problems/forbidden',
    title: 'Forbidden',
    status: 403,
    detail: 'The user is missing the required permission: api-keys:write.',
    instance: '/api/v1/api-keys',
    requestId: 'req-synthetic-1',
  });

  it('carries the problem document, its type and the request id', () => {
    const response = new Response(JSON.stringify(problem), {
      status: 403,
      headers: { 'x-request-id': 'req-synthetic-1' },
    });

    const error = apiErrorOf(response, JSON.stringify(problem));

    expect(error).toBeInstanceOf(OpenVerifyApiError);
    expect(error).toMatchObject({
      status: 403,
      type: 'https://openverify.dev/problems/forbidden',
      requestId: 'req-synthetic-1',
      problem,
    });
  });

  it('makes a problem from the status when the body is not one', () => {
    const response = new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' });

    expect(apiErrorOf(response, 'Bad gateway')).toMatchObject({
      status: 502,
      requestId: null,
      problem: { type: 'about:blank', title: 'Bad Gateway', status: 502 },
    });
  });
});
