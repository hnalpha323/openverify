/**
 * Workflow 8C review K8-22 (P19, C143.5, plan item 114): every audited case, comment, template,
 * case-action and review-request action holds its metadata to a strict schema with no free-text
 * member, as the queue and file actions already do; and every action the case code audits has one.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CASE_AUDIT_ACTIONS, checkedCaseAuditMetadata } from './audit.js';
import { CASE_FILE_AUDIT_ACTIONS } from './attachments/audit.js';
import { QUEUE_AUDIT_ACTIONS } from './queues/audit.js';

const SOURCE = fileURLToPath(new URL('../../', import.meta.url));

/** Every `.ts` file under `dir`, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sources(path);
    }
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

/** The literal `action: '...'` of every audit entry the case code writes. */
function auditedActions(): Set<string> {
  const found = new Set<string>();
  for (const file of [
    ...sources(join(SOURCE, 'services/cases')),
    ...sources(join(SOURCE, 'workflows/actions/cases')),
  ]) {
    for (const match of readFileSync(file, 'utf8').matchAll(/action: '([a-z-]+\.[a-z-]+)'/g)) {
      const [, action] = match;
      if (action !== undefined) {
        found.add(action);
      }
    }
  }
  return found;
}

describe('the case audit entries (K8-22)', () => {
  it('has a strict schema for every action the case code audits', () => {
    const covered = new Set<string>([
      ...CASE_AUDIT_ACTIONS,
      ...QUEUE_AUDIT_ACTIONS,
      ...CASE_FILE_AUDIT_ACTIONS,
    ]);
    const audited = [...auditedActions()];
    expect(audited.length).toBeGreaterThanOrEqual(15);
    expect(audited.filter((action) => !covered.has(action)).sort()).toEqual([]);
  });

  it('refuses a member beyond its schema, for every action', () => {
    expect(CASE_AUDIT_ACTIONS.length).toBeGreaterThanOrEqual(15);
    for (const action of CASE_AUDIT_ACTIONS) {
      expect(() => checkedCaseAuditMetadata(action, { note: 'free text' })).toThrow();
    }
  });

  it('refuses free text where a key or a status belongs', () => {
    expect(() =>
      checkedCaseAuditMetadata('case.status-changed', { from: 'open', to: 'Approved by Avery' }),
    ).toThrow();
    expect(() =>
      checkedCaseAuditMetadata('case.updated', {
        attributes: ['fields'],
        'field-keys': ['a key with spaces'],
      }),
    ).toThrow();
    expect(
      checkedCaseAuditMetadata('case.redacted', {
        'comment-count': 2,
        retention: 'case-retention-days',
      }),
    ).toEqual({ 'comment-count': 2, retention: 'case-retention-days' });
  });
});
