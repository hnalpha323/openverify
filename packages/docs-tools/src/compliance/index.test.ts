import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { checkCompliance } from './index.js';

describe('the compliance area', () => {
  it("names each check and reports a fixture tree's problems", () => {
    const results = checkCompliance(
      createMemoryRepository({ 'docs/compliance/a.md': '# A\n\nNothing.\n' }),
    );
    expect(results.map((result) => result.name)).toEqual([
      'compliance-opening',
      'compliance-references',
      'compliance-variables',
      'compliance-access-requests',
      'compliance-retention',
    ]);
    expect(results.every((result) => result.status === 'built')).toBe(true);
    expect(results.flatMap((result) => result.findings).length).toBeGreaterThan(0);
  });

  it('finds no error in the committed guide', () => {
    const errors = checkCompliance(createRepository(REPOSITORY_ROOT))
      .flatMap((result) => result.findings)
      .filter((finding) => finding.severity === 'error');
    expect(errors).toEqual([]);
  });
});
