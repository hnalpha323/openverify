import { describe, expect, it } from 'vitest';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import { placeProblem } from './preview-problems';

describe('placing a preview or simulate problem (C156.1, C156.4)', () => {
  it('puts each 422 pointer beside the control it names', () => {
    const placed = placeProblem({
      title: 'Unprocessable',
      status: 422,
      errors: [
        { pointer: '/meta/locale', detail: 'Synthetic: not enabled.' },
        { pointer: '/data/attributes/theme-set-id', detail: 'Synthetic: archived.' },
        {
          pointer: '/data/attributes/styles/light/palette/ink',
          detail: 'Synthetic: contradiction.',
        },
        { pointer: '/data/attributes/flow', detail: 'Synthetic: unreadable.' },
        { pointer: '/meta/scope/verifications/id_card', detail: 'Synthetic: no such step.' },
        { pointer: '/meta/preset-id', detail: 'Synthetic: not yours.' },
        { pointer: '/meta', detail: 'Synthetic: both.' },
      ],
    });

    expect(placed.byTarget).toEqual({
      locale: ['Synthetic: not enabled.'],
      'theme-set': ['Synthetic: archived.'],
      styles: ['Synthetic: contradiction. (/data/attributes/styles/light/palette/ink)'],
      flow: ['Synthetic: unreadable.'],
      scope: ['Synthetic: no such step. (/meta/scope/verifications/id_card)'],
      preset: ['Synthetic: not yours.'],
      other: ['Synthetic: both.'],
    });
    expect(placed.rateLimited).toBe(false);
  });

  it('names a rate limit, so the page can wait and try again', () => {
    expect(placeProblem({ title: 'Too many requests', status: 429 }).rateLimited).toBe(true);
  });

  it('keeps a problem without pointers as its title and detail', () => {
    expect(
      placeProblem({ title: 'Synthetic title', detail: 'Synthetic detail.', status: 403 }).byTarget,
    ).toEqual({ other: ['Synthetic title: Synthetic detail.'] });
  });

  it('labels every target in words', () => {
    expect(PREVIEW_COPY.problems.locale).toBe('Language');
    expect(PREVIEW_COPY.problems.scope).toBe('Simulated values');
  });
});
