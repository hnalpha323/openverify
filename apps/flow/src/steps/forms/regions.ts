/**
 * The choices of the forms' region fields (C52.3, C64.1): the countries of a database address,
 * named in the user's language by `Intl.DisplayNames`, and the US states, the District of
 * Columbia and the territories that issue the licenses the AAMVA form checks.
 */
import { US_JURISDICTIONS } from '@openverify/contracts';
import { getCountries } from 'libphonenumber-js';
import type { SelectOption } from '../../components/select-field';

/** A two-letter region code: the shape `address-country-code` takes (ISO 3166-1 alpha-2). */
const ALPHA_2 = /^[A-Z]{2}$/u;

/**
 * The countries of an address, sorted by their name in `language`. The codes are the regions
 * libphonenumber knows, which cover ISO 3166-1; a code `Intl` cannot name is left out.
 */
export function countryOptions(language: string): SelectOption[] {
  const names = new Intl.DisplayNames([language], { type: 'region', fallback: 'none' });
  const collator = new Intl.Collator(language);
  return getCountries()
    .filter((code) => ALPHA_2.test(code))
    .flatMap((code) => {
      const name = names.of(code);
      return name === undefined ? [] : [{ value: code, label: name }];
    })
    .sort((left, right) => collator.compare(left.label, right.label));
}

/** The jurisdictions' names as their cards print them. */
const JURISDICTION_NAMES: Readonly<Record<(typeof US_JURISDICTIONS)[number], string>> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
};

/** The Spanish names that differ from the English ones; the others are the same in both. */
const SPANISH_JURISDICTION_NAMES: Readonly<
  Partial<Record<(typeof US_JURISDICTIONS)[number], string>>
> = {
  HI: 'Hawái',
  LA: 'Luisiana',
  MS: 'Misisipi',
  MO: 'Misuri',
  NJ: 'Nueva Jersey',
  NM: 'Nuevo México',
  NY: 'Nueva York',
  NC: 'Carolina del Norte',
  ND: 'Dakota del Norte',
  OR: 'Oregón',
  PA: 'Pensilvania',
  SC: 'Carolina del Sur',
  SD: 'Dakota del Sur',
  WV: 'Virginia Occidental',
  DC: 'Distrito de Columbia',
  AS: 'Samoa Americana',
  MP: 'Islas Marianas del Norte',
  VI: 'Islas Vírgenes de los Estados Unidos',
};

/** The AAMVA issuing authorities (`US_JURISDICTIONS`), sorted by their name in `language`. */
export function jurisdictionOptions(language: string): SelectOption[] {
  const collator = new Intl.Collator(language);
  const spanish = language.split('-')[0] === 'es';
  return US_JURISDICTIONS.map((code) => ({
    value: code,
    label: (spanish ? SPANISH_JURISDICTION_NAMES[code] : undefined) ?? JURISDICTION_NAMES[code],
  })).sort((left, right) => collator.compare(left.label, right.label));
}
