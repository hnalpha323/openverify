/**
 * Country names and dates as the publishers print them (C77.2): OFAC, the UK and the UN write
 * country names, not codes, and OFAC and the UK write dates in their own forms. Names come from
 * `Intl.DisplayNames` in English at run time, so no country table is typed out here.
 */

const REGIONS = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const MONTHS = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

/** The English name of an ISO 3166-1 alpha-2 code (`GB` → `United Kingdom`). */
export function countryName(code: string): string {
  const name = /^[A-Z]{2}$/.test(code) ? REGIONS.of(code) : undefined;
  if (name === undefined) {
    throw new RangeError('not an ISO 3166-1 alpha-2 code');
  }
  return name;
}

const monthName = (month: string): string =>
  MONTHS.format(new Date(Date.UTC(2000, Number(month) - 1, 1)));

/** OFAC's printed date: `12 Apr 1980`, `Apr 1980` or `1980`, by the value's precision. */
export function ofacPrintedDate(value: string): string {
  const [year = '', month, day] = value.split('-');
  if (month === undefined) {
    return year;
  }
  return day === undefined ? `${monthName(month)} ${year}` : `${day} ${monthName(month)} ${year}`;
}

/** The UK list's date: `dd/mm/yyyy`, with `dd` and `mm` for unknown parts (`dd/mm/1970`). */
export function ukDate(value: string): string {
  const [year = '', month = 'mm', day = 'dd'] = value.split('-');
  return `${day}/${month}/${year}`;
}
