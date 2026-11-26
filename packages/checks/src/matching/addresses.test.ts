import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import { addressFromLines, matchAddresses, type PostalAddress } from './addresses.js';

/** A synthetic US address (invented street and city, an unassigned ZIP code). */
const HOME: PostalAddress = {
  street1: '123 Quillon Street',
  street2: 'Apt 4',
  city: 'Lanternfield',
  subdivision: 'CA',
  postalCode: '00123',
  countryCode: 'US',
};
const with_ = (changes: Partial<Record<keyof PostalAddress, string | null>>): PostalAddress => ({
  ...HOME,
  ...changes,
});
const level = (a: PostalAddress, b: PostalAddress) => matchAddresses(a, b).level;

describe('matchAddresses (C58.4)', () => {
  it('is full when every component matches, the unit equal on both', () => {
    const match = matchAddresses(HOME, HOME);

    expect(match.level).toBe('full');
    expect(match.components).toEqual({
      country: 'exact',
      'postal-code': 'exact',
      'house-number': 'exact',
      street: 'exact',
      unit: 'exact',
      city: 'exact',
      subdivision: 'exact',
    });
    expect(match.flags).toEqual([]);
  });

  it('reads abbreviations, case, ZIP+4, alpha-3 and subdivision names as the same address', () => {
    const variant = {
      street1: '123 QUILLON ST.',
      street2: 'Apartment 4',
      city: 'lanternfield',
      subdivision: 'California',
      postalCode: '00123-4567',
      countryCode: 'USA',
    };

    expect(level(variant, HOME)).toBe('full');
  });

  it("a neighbour's house number is none", () => {
    const match = matchAddresses(with_({ street1: '125 Quillon Street' }), HOME);

    expect(match.level).toBe('none');
    expect(match.components['house-number']).toBe('mismatch');
    expect(match.methods).toEqual([]);
  });

  it('a unit on one side only is partial', () => {
    const match = matchAddresses(with_({ street2: null }), HOME);

    expect(match.level).toBe('partial');
    expect(match.components.unit).toBe('one-sided');
    expect(match.flags).toContain('unit-one-sided');
  });

  it.each([
    ['another unit', with_({ street2: 'Apt 5' }), HOME],
    ['another street', with_({ street1: '123 Harrowgate Avenue' }), HOME],
    ['another street type', with_({ street1: '123 Quillon Avenue' }), HOME],
    ['another postal code', with_({ postalCode: '00124' }), HOME],
    ['another country', with_({ countryCode: 'CA' }), HOME],
    [
      'another directional',
      with_({ street1: '123 S Quillon Street' }),
      with_({ street1: '123 N Quillon St' }),
    ],
  ])('%s is none', (_case, a, b) => {
    expect(level(a, b)).toBe('none');
  });

  it.each([
    ['a street type on one side only', with_({ street1: '123 Quillon' })],
    ['a near spelling of the street', with_({ street1: '123 Quilon Street' })],
    ['a directional on one side only', with_({ street1: '123 N Quillon Street' })],
    ['no postal code on one side', with_({ postalCode: null })],
  ])('%s is partial', (_case, other) => {
    expect(level(other, HOME)).toBe('partial');
  });

  it('a near spelling rests on string similarity', () => {
    expect(matchAddresses(with_({ street1: '123 Quilon Street' }), HOME).methods).toContain(
      'string_similarity',
    );
  });

  it('a directional matches its abbreviation', () => {
    expect(
      level(with_({ street1: '123 N Quillon St' }), with_({ street1: '123 North Quillon Street' })),
    ).toBe('full');
  });

  it('another city is partial with the same postal code, and undecidable without one', () => {
    const elsewhere = matchAddresses(with_({ city: 'Quillonbridge' }), HOME);

    expect(elsewhere.level).toBe('partial');
    expect(elsewhere.flags).toContain('city-mismatch');
    expect(
      matchAddresses(
        with_({ city: 'Quillonbridge', postalCode: null }),
        with_({ postalCode: null }),
      ),
    ).toMatchObject({
      level: 'missing',
      flags: expect.arrayContaining(['city-mismatch']) as unknown,
    });
  });

  it('another subdivision caps the level at partial', () => {
    expect(matchAddresses(with_({ subdivision: 'NV' }), HOME)).toMatchObject({
      level: 'partial',
      flags: ['subdivision-mismatch'],
    });
  });

  it('is missing without a street, or with a house number on one side only', () => {
    expect(level(with_({ street1: null, street2: null }), HOME)).toBe('missing');
    expect(matchAddresses(with_({ street1: 'Quillon Street' }), HOME)).toMatchObject({
      level: 'missing',
      flags: ['house-number-one-sided'],
    });
  });

  it('splits German street suffixes and reads the number after the street', () => {
    const berlin: PostalAddress = {
      street1: 'Rosenstraße 12',
      city: 'Lanternfeld',
      postalCode: '00042',
      countryCode: 'DE',
    };

    expect(level({ ...berlin, street1: 'Rosenstr. 12' }, berlin)).toBe('full');
    expect(level({ ...berlin, street1: 'Rosen Strasse 12' }, berlin)).toBe('full');
    expect(
      level({ ...berlin, street1: 'Rosenstraße 12 a' }, { ...berlin, street1: 'Rosenstraße 12a' }),
    ).toBe('full');
    expect(level({ ...berlin, street1: 'Rosenstraße 14' }, berlin)).toBe('none');
  });

  it('reads a street type in front, as French and Spanish write it', () => {
    expect(
      level(
        {
          street1: '12 Avenue des Tilleuls',
          city: 'Quillonville',
          postalCode: '00042',
          countryCode: 'FR',
        },
        {
          street1: '12 Av. des Tilleuls',
          city: 'Quillonville',
          postalCode: '00042',
          countryCode: 'FR',
        },
      ),
    ).toBe('full');
  });

  it('reads a floor and door after the house number and a comma as the unit (C58.4)', () => {
    const spain = (changes: Partial<PostalAddress>): PostalAddress => ({
      city: 'Quillonvilla',
      postalCode: '53042',
      countryCode: 'ES',
      ...changes,
    });
    const entered = spain({ street1: 'Calle del Molino 27, 2B' });

    // The same door, on the street line or on a line of its own.
    expect(level(entered, spain({ street1: 'CALLE DEL MOLINO 27', street2: '2B' }))).toBe('full');
    expect(level(entered, spain({ street1: 'Calle del Molino, 27, 2B' }))).toBe('full');
    // A neighbour's door, and a door on one side only.
    expect(level(entered, spain({ street1: 'Calle del Molino 27, 3A' }))).toBe('none');
    expect(level(entered, spain({ street1: 'Calle del Molino 27' }))).toBe('partial');
    // A comma between the street and its number is no unit.
    expect(
      level(spain({ street1: 'Calle del Molino, 27' }), spain({ street1: 'Calle del Molino 27' })),
    ).toBe('full');
  });

  it('reads Saint and St in a street name as one word', () => {
    expect(
      level(with_({ street1: '5 Saint Quillon Road' }), with_({ street1: '5 St Quillon Rd' })),
    ).toBe('full');
  });

  it('compares PO boxes by their number, and a box against a street is undecidable', () => {
    expect(
      level(
        with_({ street1: 'PO Box 77', street2: null }),
        with_({ street1: 'P.O. Box 77', street2: null }),
      ),
    ).toBe('full');
    expect(
      level(
        with_({ street1: 'PO Box 77', street2: null }),
        with_({ street1: 'PO Box 78', street2: null }),
      ),
    ).toBe('none');
    expect(level(with_({ street1: 'PO Box 77', street2: null }), HOME)).toBe('missing');
  });

  it('reads a house number written in the other order for its country', () => {
    const berlin: PostalAddress = {
      street1: 'Rosenstraße 12',
      city: 'Lanternfeld',
      postalCode: '00042',
      countryCode: 'DE',
    };

    expect(level({ ...berlin, street1: '12 Rosenstraße' }, berlin)).toBe('full');
    expect(level(with_({ street1: 'Quillon Street 123' }), HOME)).toBe('full');
  });

  it('reads trailing directionals and ordinal words', () => {
    expect(
      level(
        with_({ street1: '123 Quillon Street NW' }),
        with_({ street1: '123 Quillon St Northwest' }),
      ),
    ).toBe('full');
    expect(level(with_({ street1: '5 Fifth Avenue' }), with_({ street1: '5 5th Ave' }))).toBe(
      'full',
    );
  });

  it('a street name joined on one side is partial, by tokenization', () => {
    const match = matchAddresses(
      with_({ street1: '123 Mac Arthur Street' }),
      with_({ street1: '123 MacArthur Street' }),
    );

    expect(match.level).toBe('partial');
    expect(match.methods).toContain('tokenization');
  });

  it('two ZIP+4 codes of one ZIP are a fuzzy postal code, so partial', () => {
    const match = matchAddresses(
      with_({ postalCode: '00123-4567' }),
      with_({ postalCode: '00123-4568' }),
    );

    expect(match).toMatchObject({ level: 'partial', components: { 'postal-code': 'fuzzy' } });
    expect(match.methods).toContain('string_difference');
  });

  it('two fuzzy components are undecidable, and a house number alone is no street', () => {
    expect(
      matchAddresses(with_({ street1: '123 Quilon Street', city: 'Lanternfeld' }), HOME),
    ).toMatchObject({
      level: 'missing',
      flags: expect.arrayContaining(['too-many-fuzzy-components']) as unknown,
    });
    expect(level(with_({ street1: '123' }), HOME)).toBe('missing');
  });

  it('is symmetric', () => {
    const others = [
      with_({ street2: null }),
      with_({ street1: '125 Quillon Street' }),
      with_({ city: 'Quillonbridge' }),
      with_({ street1: 'Quillon Street' }),
    ];
    for (const other of others) {
      expect(matchAddresses(other, HOME)).toEqual(matchAddresses(HOME, other));
    }
  });

  it('compares a street line of 100 KB of doors after commas in bounded time (C58.7)', () => {
    const doors = 'Calle del Molino 27' + ', 2B'.repeat(25_000);

    expect(
      cpuMilliseconds(() => {
        matchAddresses(with_({ street1: doors, street2: doors }), with_({ street1: doors }));
      }),
    ).toBeLessThan(200);
  });

  it('compares 100 KB of near-matching input in bounded time (C58.7)', () => {
    const long = '123 Quillon Street '.repeat(5_300);

    expect(
      cpuMilliseconds(() => {
        matchAddresses(with_({ street1: long, street2: long, city: long }), HOME);
      }),
    ).toBeLessThan(200);
  });
});

describe('addressFromLines', () => {
  it('reads the postal line, and the street lines before it, leaving out a name line', () => {
    expect(
      addressFromLines(
        ['Ada Vellacott', '123 Quillon St', 'Apt 4', 'Lanternfield, CA 00123'],
        'US',
      ),
    ).toEqual({
      street1: '123 Quillon St',
      street2: 'Apt 4',
      city: 'Lanternfield',
      subdivision: 'CA',
      postalCode: '00123',
      countryCode: 'US',
    });
    expect(
      addressFromLines(['Ada Vellacott', 'Rosenstraße 12', '00042 Lanternfeld'], 'DE'),
    ).toEqual({
      street1: 'Rosenstraße 12',
      street2: null,
      city: 'Lanternfeld',
      subdivision: null,
      postalCode: '00042',
      countryCode: 'DE',
    });
  });

  it('keeps the first line as the street when no postal code is found', () => {
    expect(addressFromLines(['123 Quillon St', 'somewhere'], 'US')).toEqual({
      street1: '123 Quillon St',
      street2: null,
      city: null,
      subdivision: null,
      postalCode: null,
      countryCode: 'US',
    });
  });
});
