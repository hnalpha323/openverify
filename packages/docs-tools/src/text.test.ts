import { describe, expect, it } from 'vitest';
import { readAsRows, sentencesOf } from './text.js';

describe('the units the wording rules read', () => {
  it('joins a wrapped paragraph and cuts it into sentences, each with its first line', () => {
    const text = [
      '# Title',
      '',
      'One sentence that wraps',
      'onto a second line. Then another!',
      '',
      'Last; part.',
    ].join('\n');

    expect(sentencesOf(text)).toEqual([
      { line: 1, text: '# Title' },
      { line: 3, text: 'One sentence that wraps onto a second line.' },
      { line: 3, text: 'Then another!' },
      { line: 6, text: 'Last;' },
      { line: 6, text: 'part.' },
    ]);
  });

  it('keeps a list item, a table row, a quote and a fenced line as units of their own', () => {
    const text = [
      '- item one',
      'continued',
      '| a | b |',
      '> quoted',
      '```',
      'code line',
      'more code',
      '```',
      '1. numbered',
    ].join('\n');

    expect(sentencesOf(text).map((sentence) => sentence.line)).toEqual([1, 2, 3, 4, 6, 7, 9]);
  });

  it('reads rows for CSV, text and YAML files, one unit per line', () => {
    expect(sentencesOf('a,b\nc wraps\nd', true)).toEqual([
      { line: 1, text: 'a,b' },
      { line: 2, text: 'c wraps' },
      { line: 3, text: 'd' },
    ]);
    expect(readAsRows('docs/security/asvs-5.0.0-l2.csv')).toBe(true);
    expect(readAsRows('deploy/helm/openverify/Chart.yaml')).toBe(true);
    expect(readAsRows('deploy/helm/openverify/templates/NOTES.txt')).toBe(true);
    expect(readAsRows('docs/security/README.md')).toBe(false);
  });
});
