import { describe, expect, it } from 'vitest';
import { fillPlaceholders } from './fill-placeholders';

describe('fillPlaceholders', () => {
  it('fills each placeholder with its value', () => {
    expect(fillPlaceholders('Kept for {{days}} days.', { days: 365 })).toBe('Kept for 365 days.');
    expect(fillPlaceholders('{{a}} and {{b}}, then {{a}}', { a: 'x', b: 2 })).toBe(
      'x and 2, then x',
    );
  });

  it('leaves a message without placeholders unchanged', () => {
    expect(fillPlaceholders('No placeholder here.', {})).toBe('No placeholder here.');
  });

  it('refuses a message with a placeholder that has no value', () => {
    expect(fillPlaceholders('Kept for {{days}} days.', {})).toBeNull();
    expect(fillPlaceholders('{{days}} and {{other}}', { days: 1 })).toBeNull();
  });

  it('never reads inherited properties as values', () => {
    expect(fillPlaceholders('{{constructor}}', {})).toBeNull();
  });
});
