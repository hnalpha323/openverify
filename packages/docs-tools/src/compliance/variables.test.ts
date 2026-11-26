import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createRepository } from '../repository.js';
import { compliancePages } from './pages.js';
import { isRegisteredVariable, variableFindings } from './variables.js';

describe('the configuration variables a compliance page names', () => {
  it('knows exact entries, pattern prefixes and a secret file form', () => {
    expect(isRegisteredVariable('OPENVERIFY_CONNECT_ENABLED')).toBe(true);
    expect(isRegisteredVariable('OPENVERIFY_PROVIDER_SMS_PRODUCTION')).toBe(true);
    expect(isRegisteredVariable('OPENVERIFY_SMTP_URL_FILE')).toBe(true);
    expect(isRegisteredVariable('OPENVERIFY_CONNECT_ENABLED_FILE')).toBe(false);
    expect(isRegisteredVariable('OPENVERIFY_NOT_A_VARIABLE')).toBe(false);
  });

  it('reports each unregistered name once', () => {
    const text =
      'Set `OPENVERIFY_NOT_A_VARIABLE` and OPENVERIFY_NOT_A_VARIABLE, and OPENVERIFY_KEK.';
    expect(variableFindings('docs/compliance/a.md', text)).toEqual([
      {
        rule: 'compliance-variable',
        path: 'docs/compliance/a.md',
        message:
          'names OPENVERIFY_NOT_A_VARIABLE, which apps/api/src/config-registry.ts does not hold (rule 22)',
        severity: 'error',
      },
    ]);
  });

  it('finds no unregistered variable in the committed guide', () => {
    const repo = createRepository(REPOSITORY_ROOT);
    const findings = compliancePages((dir) => repo.listFiles(dir)).flatMap((path) =>
      variableFindings(path, repo.readText(path)),
    );
    expect(findings).toEqual([]);
  });
});
