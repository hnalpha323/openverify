import { describe, expect, it } from 'vitest';
import { carryParameters, readFlowParameters } from './flow-parameters';

describe('readFlowParameters (C161.2, C160.9)', () => {
  it('reads the language, then its lang alias, each in the query first, and the style variant', () => {
    expect(
      readFlowParameters({ search: '?lang=de&style-variant=dark', hash: '#language=fr' }),
    ).toEqual({ languages: ['fr', 'de'], styleVariant: 'dark' });
    expect(readFlowParameters({ search: '?language=es&lang=de', hash: '' })).toEqual({
      languages: ['es', 'de'],
      styleVariant: null,
    });
  });

  it('ignores a style variant it does not know, and answers null for none at all', () => {
    expect(readFlowParameters({ search: '?style-variant=sepia', hash: '' })).toBeNull();
    expect(readFlowParameters({ search: '?style-variant=LIGHT', hash: '' })).toEqual({
      languages: [],
      styleVariant: 'light',
    });
    expect(readFlowParameters({ search: '', hash: '#inquiry-id=inq_1' })).toBeNull();
  });
});

describe('carryParameters', () => {
  it('moves the fragment public parameters into the query, never the credentials', () => {
    expect(
      carryParameters(
        '?utm=1',
        '#inquiry-id=inq_1&session-token=ovs_secret&language=ar-EG&style-variant=dark',
      ),
    ).toBe('?utm=1&language=ar-EG&style-variant=dark');
  });

  it('leaves the query as it is when the fragment carries none', () => {
    expect(carryParameters('?lang=es', '#inquiry-id=inq_1&session-token=ovs_secret')).toBe(
      '?lang=es',
    );
    expect(carryParameters('', '#language=fr')).toBe('?language=fr');
  });

  it('keeps a parameter the query already names as the query has it', () => {
    expect(carryParameters('?language=de', '#language=fr&lang=es')).toBe('?language=de&lang=es');
  });
});
