import { z } from 'zod';
import { describe, expect, it } from 'vitest';

describe('csp-safe-zod', () => {
  it('turns off zod’s JIT, so it never probes eval under the CSP', async () => {
    await import('./csp-safe-zod');

    expect(z.config().jitless).toBe(true);
  });

  it('still parses with the contract schemas', async () => {
    await import('./csp-safe-zod');
    const schema = z.strictObject({ id: z.string() });

    expect(schema.parse({ id: 'x' })).toEqual({ id: 'x' });
  });
});
