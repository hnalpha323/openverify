/**
 * C78.8: a synthetic customer population, screened to count alerts per 1,000 customers. Names mix
 * our fictional syllable names with single Latin forms drawn from the variant groups (given names
 * and surnames of many cultures), combined at random, so no customer is a real person. Generated at
 * evaluation time from `evaluation-6`'s seed and never committed.
 */
import { fictionalFamilyName, fictionalGivenName } from '../names.js';
import { seededRandom, type SeededRandom } from '../random.js';
import { SYNTHETIC_COUNTRIES } from '../records.js';
import { formsByScript, type VariantGroup } from './groups.js';

export interface SyntheticCustomer {
  readonly id: string;
  /** The query in the public watchlist request shape. */
  readonly query: Readonly<Record<string, string>>;
}

export interface CustomerOptions {
  readonly seed: string;
  readonly count: number;
  /** Variant groups to draw real-world name forms from; without them, fictional names only. */
  readonly groups?: readonly VariantGroup[];
  /** The share of names drawn from the groups (default 0.5). */
  readonly groupShare?: number;
}

const capitalise = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
const pad2 = (value: number): string => String(value).padStart(2, '0');

export function syntheticCustomers(options: CustomerOptions): SyntheticCustomer[] {
  const random = seededRandom(`customers/${options.seed}`);
  const pool = (options.groups ?? []).flatMap((group) => formsByScript(group).latin);
  const share = options.groupShare ?? 0.5;
  const draw = (stream: SeededRandom, fictional: () => string): string =>
    pool.length > 0 && stream.chance(share) ? capitalise(stream.pick(pool)) : fictional();
  return Array.from({ length: options.count }, (_, index) => {
    const stream = random.fork(`customer-${String(index)}`);
    const given = draw(stream, () => fictionalGivenName(stream).latin);
    const family = draw(stream, () => fictionalFamilyName(stream).latin);
    const birthdate = `${String(stream.between(1940, 2005))}-${pad2(stream.between(1, 12))}-${pad2(stream.between(1, 28))}`;
    return {
      id: `CUS-${String(index + 1).padStart(7, '0')}`,
      query: {
        'name-first': given,
        'name-last': family,
        birthdate,
        ...(stream.chance(0.5) ? { 'address-country-code': stream.pick(SYNTHETIC_COUNTRIES) } : {}),
      },
    };
  });
}
