/** The selfhost area's entry points (C277): what `docs:selfhost` writes and what the area checks. */
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { CONFIGURATION_PAGE, renderConfigurationReference } from './configuration.js';
import { ASVS_CSV, HARDENING_PAGE, MASVS_CSV } from './hardening.js';
import { checkSelfhost, renderSelfhost } from './index.js';

describe('the selfhost area', () => {
  it('renders the configuration reference', () => {
    const result = renderSelfhost(createMemoryRepository({}));

    expect(result.area).toBe('selfhost');
    expect(result.status).toBe('built');
    expect(result.files).toContainEqual({
      path: CONFIGURATION_PAGE,
      content: renderConfigurationReference(),
    });
  });

  it('finds a generated page that is missing or stale', () => {
    const findings = checkSelfhost(createMemoryRepository({ [CONFIGURATION_PAGE]: 'old\n' }))
      .filter((result) => result.name === 'selfhost-fresh-render')
      .flatMap((result) => result.findings);

    expect(findings).toContainEqual(
      expect.objectContaining({
        rule: 'fresh-render',
        path: CONFIGURATION_PAGE,
        severity: 'error',
      }),
    );
  });

  it('renders the hardening checklist from both checklists, and reports one it cannot read', () => {
    const header = 'id,level,status,evidence,notes,threats,reviewed_at,reviewed_commit';
    const repo = createMemoryRepository({
      [ASVS_CSV]: `${header}\nv5.0.0-12.3.1,2,operator,docs/a.md,TLS between hosts,,2026-11-20,abc1234\n`,
      [MASVS_CSV]: `${header}\n`,
    });
    const page = renderSelfhost(repo).files.find((file) => file.path === HARDENING_PAGE);

    expect(page?.content).toContain('| `v5.0.0-12.3.1` | 2 | TLS between hosts |');

    const stub = createMemoryRepository({ [ASVS_CSV]: 'Draft\n', [HARDENING_PAGE]: '# Old\n' });
    expect(renderSelfhost(stub).files.map((file) => file.path)).not.toContain(HARDENING_PAGE);
    expect(
      checkSelfhost(stub)
        .flatMap((result) => result.findings)
        .filter((finding) => finding.path === ASVS_CSV || finding.path === MASVS_CSV)
        .map((finding) => finding.rule),
    ).toEqual(['generated-page', 'generated-page']);
  });

  it('holds over the repository', () => {
    const results = checkSelfhost(createRepository(REPOSITORY_ROOT));

    expect(results.every((result) => result.status === 'built')).toBe(true);
    expect(results.flatMap((result) => result.findings)).toEqual([]);
  });
});
