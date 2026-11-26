/** The security area's entry points (C273-C275), over fixtures and over the committed documents. */
import { describe, expect, it } from 'vitest';
import { staleFiles } from '../fresh-render.js';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { ASVS_SUMMARY_PATH } from './summary.js';
import { checkSecurity, checkSecurityWith, renderSecurity } from './index.js';

const real = createRepository(REPOSITORY_ROOT);

describe('checkSecurity', () => {
  it('reports a missing threat model and missing checklists as errors', () => {
    const results = checkSecurity(createMemoryRepository({}));
    expect(results.map((result) => result.name)).toEqual(['threat-model', 'asvs', 'masvs']);
    for (const result of results) {
      expect(result.status).toBe('built');
      expect(result.findings.map((finding) => finding.rule)).toEqual(['missing']);
    }
  });

  it('finds nothing wrong with the committed threat model and checklists', () => {
    expect(checkSecurity(real)).toEqual([
      { name: 'threat-model', status: 'built', findings: [] },
      { name: 'asvs', status: 'built', findings: [] },
      { name: 'masvs', status: 'built', findings: [] },
    ]);
  });
});

describe('renderSecurity', () => {
  it('renders the summary, and the committed one equals a fresh render', () => {
    const result = renderSecurity(real);
    expect(result.status).toBe('built');
    expect(result.files.map((file) => file.path)).toEqual([ASVS_SUMMARY_PATH]);
    expect(staleFiles(real, result.files)).toEqual([]);
    expect(renderSecurity(real)).toEqual(result);
  });
});

describe('checkSecurityWith (C274.6)', () => {
  it('adds the staleness of both checklists as owner findings from the injected history', () => {
    const everything = { changedSince: (_commit: string, paths: readonly string[]) => paths };
    const results = checkSecurityWith(real, { history: everything });
    expect(results.map((result) => result.name)).toEqual([
      'threat-model',
      'asvs',
      'masvs',
      'asvs-staleness',
      'masvs-staleness',
    ]);
    const stale = results.slice(3).flatMap((result) => result.findings);
    expect(stale.length).toBeGreaterThan(0);
    expect(new Set(stale.map((finding) => finding.severity))).toEqual(new Set(['owner']));
    const nothing = { changedSince: () => [] };
    expect(checkSecurityWith(real, { history: nothing }).slice(3)).toEqual([
      { name: 'asvs-staleness', status: 'built', findings: [] },
      { name: 'masvs-staleness', status: 'built', findings: [] },
    ]);
  });
});
