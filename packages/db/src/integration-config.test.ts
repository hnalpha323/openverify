/**
 * K7B-12 (owner decision 19 after Workflow 7B): the two integration configs turn Vitest's
 * file-system module cache off, as every unit config does. With it on, the two suites `pnpm
 * test:integration` starts together raced on `node_modules/.vitest-cache` and one failed with
 * ENOTEMPTY.
 */
import { describe, expect, it } from 'vitest';
import apiConfig from '../../../apps/api/vitest.integration.config.js';
import dbConfig from '../vitest.integration.config.js';

describe('the integration configs (K7B-12)', () => {
  it.each([
    ['packages/db', dbConfig],
    ['apps/api', apiConfig],
  ] as const)('%s keeps no module cache on disk', (_name, config) => {
    expect((config as { test?: { fsModuleCache?: boolean } }).test?.fsModuleCache).toBe(false);
  });
});
