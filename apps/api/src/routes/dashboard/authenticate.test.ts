import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { requireOperator } from './authenticate.js';

describe('requireOperator', () => {
  it('refuses a request that never went through operator authentication', () => {
    const request = { operator: null } as unknown as FastifyRequest;

    expect(() => requireOperator(request)).toThrow(
      'This route is not behind dashboard operator authentication',
    );
  });
});
