/**
 * Reading a synthetic record the way each publisher writer needs it: name parts by role, the
 * primary name, Latin aliases, original-script names, countries by role and date bounds.
 */
import type { WatchlistRecord } from '../../record/index.js';

export type RecordName = WatchlistRecord['names'][number];
export type RecordIdentifier = WatchlistRecord['identifiers'][number];
type CountryRole = WatchlistRecord['countries'][number]['role'];

/** The value of the part with `role`, or `null`. */
export const partOf = (name: RecordName, role: RecordName['parts'][number]['role']) =>
  name.parts.find((part) => part.role === role)?.value ?? null;

/** The record's primary name (the first name when none is marked). */
export function primaryName(record: WatchlistRecord): RecordName {
  const primary = record.names.find((name) => name.primary) ?? record.names[0];
  if (primary === undefined) {
    throw new RangeError('a record has at least one name');
  }
  return primary;
}

/** The record's Latin names other than the primary one. */
export const latinAliases = (record: WatchlistRecord): RecordName[] =>
  record.names.filter((name) => !name.primary && name.script === 'latin');

/** The record's names in any script but Latin. */
export const originalScriptNames = (record: WatchlistRecord): RecordName[] =>
  record.names.filter((name) => name.script !== 'latin');

/** The record's country codes with one of `roles`, nulls left out. */
export const countriesWith = (record: WatchlistRecord, roles: readonly CountryRole[]): string[] =>
  record.countries.flatMap((country) =>
    country.code !== null && roles.includes(country.role) ? [country.code] : [],
  );

/** The record's identifiers of `kind`. */
export const identifiersOf = (
  record: WatchlistRecord,
  kind: RecordIdentifier['kind'],
): RecordIdentifier[] => record.identifiers.filter((identifier) => identifier.kind === kind);

const lastDayOfMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The first day a partial date can mean (`1980` → `1980-01-01`). */
export function lowerBound(value: string): string {
  const [year = '', month = '01', day = '01'] = value.split('-');
  return `${year}-${month}-${day}`;
}

/** The last day a partial date can mean (`1980-02` → `1980-02-29`). */
export function upperBound(value: string): string {
  const [year = '', month, day] = value.split('-');
  if (month === undefined) {
    return `${year}-12-31`;
  }
  return `${year}-${month}-${day ?? String(lastDayOfMonth(Number(year), Number(month))).padStart(2, '0')}`;
}

/** A writing system's name as the publishers label it. */
export const SCRIPT_LABELS: Readonly<Record<string, string>> = {
  latin: 'Latin',
  cyrillic: 'Cyrillic',
  arabic: 'Arabic',
  han: 'Chinese Simplified',
  greek: 'Greek',
  hebrew: 'Hebrew',
  hangul: 'Korean',
};
