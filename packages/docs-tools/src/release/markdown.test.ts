import { describe, expect, it } from 'vitest';
import { backticked, sectionOf, splitRow, tablesOf } from './markdown.js';

describe('splitRow', () => {
  it('splits a table row into trimmed cells', () => {
    expect(splitRow('| a | b c |  d |')).toEqual(['a', 'b c', 'd']);
  });

  it('keeps an escaped pipe and a pipe inside backticks in its cell', () => {
    expect(splitRow('| a \\| b | `x|y` | z |')).toEqual(['a | b', '`x|y`', 'z']);
  });

  it('answers null for a line that is not a row', () => {
    expect(splitRow('text | with a pipe')).toBeNull();
    expect(splitRow('')).toBeNull();
  });
});

describe('tablesOf', () => {
  const text = [
    '# Title',
    '',
    '## First',
    '',
    '| Id | Name |',
    '|---|---|',
    '| 1 | one |',
    '| 2 | two |',
    '',
    '## Second',
    '',
    '| A |',
    '| :-- |',
    '| x |',
    '| not a table without a separator |',
  ].join('\n');

  it('reads each table with its heading, header and rows', () => {
    const tables = tablesOf(text);
    expect(tables).toHaveLength(2);
    expect(tables[0]).toEqual({
      line: 5,
      section: 'First',
      header: ['Id', 'Name'],
      rows: [
        { line: 7, cells: ['1', 'one'] },
        { line: 8, cells: ['2', 'two'] },
      ],
    });
    expect(tables[1]?.section).toBe('Second');
    expect(tables[1]?.rows.map((row) => row.cells)).toEqual([
      ['x'],
      ['not a table without a separator'],
    ]);
  });

  it('ignores a table inside a fenced block', () => {
    expect(tablesOf(['```', '| a |', '|---|', '| b |', '```'].join('\n'))).toEqual([]);
  });
});

describe('sectionOf', () => {
  const text = ['# T', '## A', 'a1', '### A.1', 'a2', '## B', 'b1'].join('\n');

  it('returns the lines under a heading down to the next heading of its level', () => {
    expect(sectionOf(text, '## A')).toEqual({ line: 2, lines: ['a1', '### A.1', 'a2'] });
    expect(sectionOf(text, '## B')).toEqual({ line: 6, lines: ['b1'] });
  });

  it('answers null for a heading that is not there', () => {
    expect(sectionOf(text, '## C')).toBeNull();
  });
});

describe('backticked', () => {
  it('returns every backticked span', () => {
    expect(backticked('see `a/b.md` and `c` but not d')).toEqual(['a/b.md', 'c']);
    expect(backticked('none')).toEqual([]);
  });
});
