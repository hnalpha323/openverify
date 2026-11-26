/**
 * Workflow 10A Stage 1a (S): the flow session's `organization-display-name` (C200.2, C221.12; 10A
 * decision 6), optional and nullable, 1 to 100 characters as the environment setting is, served NFC
 * by the session builder (api-android-10a); and the Android request-fixture table (C224.4), whose
 * every entry names a zod schema this package exports.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';
import { flowSessionResponseSchema } from './flow-api.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../contracts/fixtures');
const read = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8')) as unknown;

describe('organization-display-name on the flow session (C200.2, C221.12)', () => {
  const session = read('api/flow-session-organization.json') as Record<string, unknown>;

  it('is in the golden session, NFC', () => {
    const name = session['organization-display-name'];
    expect(typeof name).toBe('string');
    expect((name as string).normalize('NFC')).toBe(name);
    expect(flowSessionResponseSchema.safeParse(session).success).toBe(true);
  });

  it('is optional and nullable, and holds 1 to 100 characters', () => {
    const without = { ...session };
    delete without['organization-display-name'];
    expect(flowSessionResponseSchema.safeParse(without).success).toBe(true);
    expect(
      flowSessionResponseSchema.safeParse({ ...session, 'organization-display-name': null })
        .success,
    ).toBe(true);
    for (const refused of ['', 'x'.repeat(101), 7]) {
      expect(
        flowSessionResponseSchema.safeParse({ ...session, 'organization-display-name': refused })
          .success,
      ).toBe(false);
    }
  });
});

describe('the Android request fixtures table (C224.4)', () => {
  const index = read('flow-requests/android/index.json') as {
    entries: { file: string; schema: string }[];
  };
  const exports = contracts as unknown as Record<string, unknown>;

  it('names a zod schema of @openverify/contracts for every entry', () => {
    const missing = index.entries.filter(({ schema }) => !(exports[schema] instanceof z.ZodType));
    expect(missing).toEqual([]);
  });

  it('lists every request fixture of the directory, and each once', () => {
    const files = readdirSync(path.join(FIXTURES, 'flow-requests/android'))
      .filter(
        (file) =>
          file.endsWith('.json') && !file.startsWith('index.') && !file.endsWith('.schema.json'),
      )
      .sort();
    const listed = index.entries.map(({ file }) => file);
    expect(new Set(listed).size).toBe(listed.length);
    expect(files.filter((file) => !listed.includes(file))).toEqual([]);
  });
});
