/**
 * C278.2's retention topic (record test): `docs/compliance/retention.md`'s table names every
 * retention setting of `DASHBOARD_SETTINGS_DEFAULTS` (each key ending `-retention-days` or
 * `-ttl-days`) with its default, and no other.
 */
import { DASHBOARD_SETTINGS_DEFAULTS } from '@openverify/contracts';
import type { CheckFinding, Repository } from '../types.js';
import { RETENTION_PAGE } from './pages.js';

const RETENTION_KEY = /-(?:retention|ttl)-days$/;

/** Each retention setting with its default as the page writes it (`unset` or `<n> days`). */
export function retentionDefaults(): ReadonlyMap<string, string> {
  const entries = Object.entries(DASHBOARD_SETTINGS_DEFAULTS)
    .filter(([key]) => RETENTION_KEY.test(key))
    .map(([key, value]): [string, string] => [
      key,
      typeof value === 'number' ? `${String(value)} days` : 'unset',
    ]);
  return new Map(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The table rows `text` holds, as setting to default cell. */
export function retentionRows(text: string): ReadonlyMap<string, string> {
  const rows = new Map<string, string>();
  for (const match of text.matchAll(/^\| `([a-z0-9-]+)` \| ([^|]+?) \|/gm)) {
    const key = match[1] ?? '';
    if (RETENTION_KEY.test(key)) {
      rows.set(key, (match[2] ?? '').trim());
    }
  }
  return rows;
}

/** Rows missing, extra or with another default. */
export function retentionFindings(repo: Repository): readonly CheckFinding[] {
  const finding = (message: string): CheckFinding => ({
    rule: 'compliance-retention',
    path: RETENTION_PAGE,
    message,
    severity: 'error',
  });
  if (!repo.exists(RETENTION_PAGE)) {
    return [finding('is missing (C278.2)')];
  }
  const rows = retentionRows(repo.readText(RETENTION_PAGE));
  const defaults = retentionDefaults();
  const findings: CheckFinding[] = [];
  for (const [key, cell] of rows) {
    const expected = defaults.get(key);
    if (expected === undefined) {
      findings.push(finding(`lists ${key}, which is not a retention setting`));
    } else if (cell !== expected) {
      findings.push(finding(`gives ${key} the default ${cell}; the contracts say ${expected}`));
    }
  }
  for (const [key, expected] of defaults) {
    if (!rows.has(key)) {
      findings.push(finding(`lacks a row for ${key} (${expected})`));
    }
  }
  return findings;
}
