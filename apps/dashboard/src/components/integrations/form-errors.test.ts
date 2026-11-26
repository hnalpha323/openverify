import { describe, expect, it } from 'vitest';
import { errorsUnder } from './form-errors';

describe('errorsUnder', () => {
  const problem = {
    title: 'Check the values you entered',
    errors: [
      { pointer: '/data/attributes/filters/inquiry-template-ids/0', detail: 'Invalid ID' },
      { pointer: '/data/attributes/filters', detail: 'Too many' },
      { pointer: '/data/attributes/filters-extra', detail: 'Not this one' },
      { pointer: '/data/attributes/url', detail: 'Invalid URL' },
    ],
  };

  it('joins the errors at a pointer and below it', () => {
    expect(errorsUnder(problem, '/data/attributes/filters')).toBe('Invalid ID. Too many');
  });

  it('is undefined without errors there', () => {
    expect(errorsUnder(problem, '/data/attributes/name')).toBeUndefined();
    expect(errorsUnder(undefined, '/data/attributes/url')).toBeUndefined();
  });
});
