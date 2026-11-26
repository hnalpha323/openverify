import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { watchlistImportSchema } from '../record/index.js';
import { normalisedImport, normalisedImportText } from './normalised.js';
import { syntheticWatchlist } from './records.js';

describe('normalisedImport', () => {
  const entries = syntheticWatchlist({ seed: 'import' });

  it('builds a file the frozen import schema accepts', () => {
    const file = normalisedImport('openverify-sandbox', '2026-01-01T00:00:00Z', entries);
    expect(watchlistImportSchema.parse(file)).toEqual(file);
    expect(file.source).toBe('openverify-sandbox');
    expect(file.published_at).toBe('2026-01-01T00:00:00Z');
    expect(file.entries).toEqual(entries);
  });

  it('writes a Date as an ISO 8601 UTC time', () => {
    const file = normalisedImport('openverify-sandbox', new Date(Date.UTC(2026, 0, 2)), []);
    expect(file.published_at).toBe('2026-01-02T00:00:00.000Z');
  });

  it('refuses a file the schema would refuse', () => {
    const first = entries[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    expect(() =>
      normalisedImport('openverify-sandbox', '2026-01-01T00:00:00Z', [first, first]),
    ).toThrow(ZodError);
    expect(() => normalisedImport('Not A Source', '2026-01-01T00:00:00Z', [])).toThrow(ZodError);
    expect(() => normalisedImport('openverify-sandbox', 'yesterday', [])).toThrow(ZodError);
  });
});

describe('normalisedImportText', () => {
  it('writes two-space JSON with a final newline that parses back to the file', () => {
    const file = normalisedImport('openverify-sandbox', '2026-01-01T00:00:00Z', []);
    const text = normalisedImportText(file);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "source": "openverify-sandbox"');
    expect(JSON.parse(text)).toEqual(file);
  });
});
