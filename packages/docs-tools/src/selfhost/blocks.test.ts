/** The generated blocks inside the guide's hand-written pages. */
import { describe, expect, it } from 'vitest';
import { blockEnd, blockStart, spliceBlock } from './blocks.js';

const page = [
  '# Sizing',
  '',
  'Prose.',
  '',
  blockStart('figures'),
  'old body',
  blockEnd('figures'),
  '',
  'More prose.',
  '',
].join('\n');

describe('a generated block in a hand-written page', () => {
  it('replaces only what lies between the markers, keeping them', () => {
    expect(spliceBlock(page, 'figures', '| a |\n| b |')).toBe(
      [
        '# Sizing',
        '',
        'Prose.',
        '',
        blockStart('figures'),
        '| a |',
        '| b |',
        blockEnd('figures'),
        '',
        'More prose.',
        '',
      ].join('\n'),
    );
  });

  it('is idempotent', () => {
    const once = spliceBlock(page, 'figures', 'new');
    expect(once).not.toBeNull();
    expect(spliceBlock(once ?? '', 'figures', 'new')).toBe(once);
  });

  it('answers null when a marker is missing, doubled or out of order', () => {
    expect(spliceBlock('# Sizing\n', 'figures', 'x')).toBeNull();
    expect(spliceBlock(`${blockStart('figures')}\n`, 'figures', 'x')).toBeNull();
    expect(
      spliceBlock(`${blockEnd('figures')}\n${blockStart('figures')}\n`, 'figures', 'x'),
    ).toBeNull();
    expect(spliceBlock(`${page}${page}`, 'figures', 'x')).toBeNull();
    expect(spliceBlock(page, 'other', 'x')).toBeNull();
  });
});
