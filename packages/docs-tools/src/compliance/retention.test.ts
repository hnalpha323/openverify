import { DASHBOARD_SETTINGS_DEFAULTS } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { RETENTION_PAGE } from './pages.js';
import { retentionDefaults, retentionFindings, retentionRows } from './retention.js';

describe('the retention page (C278.2)', () => {
  it('reads every retention setting and its default from the contracts', () => {
    const defaults = retentionDefaults();
    const keys = Object.keys(DASHBOARD_SETTINGS_DEFAULTS).filter((key) =>
      /-(retention|ttl)-days$/.test(key),
    );
    expect([...defaults.keys()]).toEqual([...keys].sort());
    expect(defaults.get('inquiry-retention-days')).toBe('unset');
    expect(defaults.get('api-log-retention-days')).toBe('30 days');
    expect(defaults.get('consent-proof-retention-days')).toBe('0 days');
  });

  it('reads the table rows of a page', () => {
    const text = [
      '| Setting | Default | What it removes |',
      '|---|---|---|',
      '| `api-log-retention-days` | 30 days | API logs |',
      '| `inquiry-retention-days` | unset | nothing |',
      '- `ignored-retention-days` in a list',
    ].join('\n');
    expect([...retentionRows(text)]).toEqual([
      ['api-log-retention-days', '30 days'],
      ['inquiry-retention-days', 'unset'],
    ]);
  });

  it('reports a missing row, an extra row and a wrong default', () => {
    const repo = createMemoryRepository({
      [RETENTION_PAGE]: [
        '| `api-log-retention-days` | 31 days | x |',
        '| `made-up-retention-days` | unset | x |',
      ].join('\n'),
    });
    const messages = retentionFindings(repo).map((item) => item.message);
    expect(messages).toContain(
      'gives api-log-retention-days the default 31 days; the contracts say 30 days',
    );
    expect(messages).toContain('lists made-up-retention-days, which is not a retention setting');
    expect(messages).toContain('lacks a row for inquiry-retention-days (unset)');
  });

  it('reports a missing page', () => {
    expect(retentionFindings(createMemoryRepository({})).map((item) => item.message)).toEqual([
      'is missing (C278.2)',
    ]);
  });

  it('holds the committed page', () => {
    expect(retentionFindings(createRepository(REPOSITORY_ROOT))).toEqual([]);
  });
});
