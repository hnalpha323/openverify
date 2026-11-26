import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { guideOpeningFindings, openingFindings } from './opening.js';
import { COUNSEL_LINE } from './pages.js';

const GOOD = [
  '# A page',
  '',
  'This is not legal advice.',
  '',
  COUNSEL_LINE,
  '',
  '## Next',
  '',
].join('\n');

describe('the opening of a compliance page', () => {
  it('passes a page that says both in its opening', () => {
    expect(openingFindings('docs/compliance/a.md', GOOD)).toEqual([]);
  });

  it('fails a page without "not legal advice" in its opening', () => {
    const text = GOOD.replace('This is not legal advice.', 'Read this.');
    expect(openingFindings('docs/compliance/a.md', text).map((item) => item.rule)).toEqual([
      'compliance-not-legal-advice',
    ]);
  });

  it('fails a page whose counsel line is missing or only after the first section', () => {
    const late = ['# A', '', 'This is not legal advice.', '', '## One', '', COUNSEL_LINE].join(
      '\n',
    );
    expect(openingFindings('docs/compliance/a.md', late)).toEqual([
      {
        rule: 'compliance-not-reviewed',
        path: 'docs/compliance/a.md',
        message: `must carry the line "${COUNSEL_LINE}" before its first section (Q7, C278.1)`,
        severity: 'error',
      },
    ]);
  });

  it('reads every Markdown page of the guide, and only those', () => {
    const repo = createMemoryRepository({
      'docs/compliance/a.md': GOOD,
      'docs/compliance/b.md': '# B\n\nNothing.\n',
      'docs/compliance/c.csv': 'x\n',
      'docs/other.md': '# Other\n',
    });
    expect(guideOpeningFindings(repo).map((item) => [item.path, item.rule])).toEqual([
      ['docs/compliance/b.md', 'compliance-not-legal-advice'],
      ['docs/compliance/b.md', 'compliance-not-reviewed'],
    ]);
  });

  it('holds every page of the committed guide, the Phase 8 and Phase 10 pages among them', () => {
    expect(guideOpeningFindings(createRepository(REPOSITORY_ROOT))).toEqual([]);
  });
});
