import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MATCHING_DATA_DIRECTORY, readMatchingData } from './data-files.js';

describe('the committed matching tables', () => {
  it('live in packages/checks/data, beside src and dist', () => {
    expect(MATCHING_DATA_DIRECTORY.replaceAll('\\', '/')).toMatch(/\/packages\/checks\/data$/);
    expect(existsSync(join(MATCHING_DATA_DIRECTORY, 'nicknames.json'))).toBe(true);
  });

  it('are read as JSON', () => {
    const table = readMatchingData('nicknames.json') as { pairs?: unknown };

    expect(Array.isArray(table.pairs)).toBe(true);
  });

  it('refuses a missing table and a path outside the folder', () => {
    expect(() => readMatchingData('absent.json')).toThrow(/absent\.json/);
    expect(() => readMatchingData('../package.json')).toThrow(/plain file name/);
  });
});
