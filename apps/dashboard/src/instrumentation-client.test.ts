import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

describe('instrumentation-client', () => {
  it('turns off zod’s JIT, so it never probes eval under a script CSP', async () => {
    await import('./instrumentation-client');

    expect(z.config().jitless).toBe(true);
  });

  it('still parses with the contract schemas', async () => {
    await import('./instrumentation-client');
    const schema = z.strictObject({ id: z.string() });

    expect(schema.parse({ id: 'x' })).toEqual({ id: 'x' });
  });

  it('imports zod’s config alone: this file runs on every page, and zod’s schemas would too', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'instrumentation-client.ts');
    const imports = readFileSync(file, 'utf8').match(/^import .*$/gmu);

    expect(imports).toEqual(["import { config } from 'zod/v4/core';"]);
  });
});
