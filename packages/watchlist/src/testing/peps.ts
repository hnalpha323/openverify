/**
 * Synthetic PEP records in the frozen normalised record (C77.1, C80.2, C80.3): fictional office
 * holders with positions of each public class, as the Wikidata sync writes them after its tenure,
 * relative and retention rules. Positions use fictional `Q-test-…` ids, never a real Wikidata item,
 * and fictional labels that say they are synthetic.
 */
import type { WatchlistRecord } from '../record/index.js';
import { fictionalPersonName } from './names.js';
import { seededRandom, type SeededRandom } from './random.js';
import { SYNTHETIC_COUNTRIES } from './records.js';

/** The fictional position labels by PEP class (C80.2's public class numbers). */
export const SYNTHETIC_POSITION_LABELS: Readonly<Record<1 | 2 | 3 | 4, readonly string[]>> =
  Object.freeze({
    1: [
      'Synthetic Head of Government',
      'Synthetic Head of State',
      'Synthetic Minister of Testing',
      'Synthetic National Legislator',
      'Synthetic Central Bank Board Member',
      'Synthetic Party Leader',
    ],
    2: [
      'Synthetic Ambassador',
      'Synthetic Senior Judge',
      'Synthetic Deputy Minister',
      'Synthetic Agency Director',
      'Synthetic Secretary-General of an International Organisation',
    ],
    3: [
      'Synthetic State Enterprise Board Member',
      'Synthetic State Enterprise Chief Executive',
      'Synthetic State Bank Director',
    ],
    4: [
      'Synthetic Mayor',
      'Synthetic Local Assembly Member',
      'Synthetic International Body Senior Officer',
    ],
  });

export interface SyntheticPepsOptions {
  readonly seed: string;
  /** Office holders (default 10). */
  readonly count?: number;
  /** The first `Q-test-` number (default 5001) of the holders; positions number from 9001. */
  readonly firstNumber?: number;
}

type Position = WatchlistRecord['positions'][number];

const pad2 = (value: number): string => String(value).padStart(2, '0');

function date(random: SeededRandom, fromYear: number, toYear: number): string {
  return `${String(random.between(fromYear, toYear))}-${pad2(random.between(1, 12))}-${pad2(random.between(1, 28))}`;
}

function position(
  random: SeededRandom,
  id: string,
  pepClass: 1 | 2 | 3 | 4,
  current: boolean,
): Position {
  const start = date(random, 2005, 2024);
  const startYear = Number(start.slice(0, 4));
  return {
    position: id,
    label: random.pick(SYNTHETIC_POSITION_LABELS[pepClass]),
    pep_class: pepClass,
    country: random.pick(SYNTHETIC_COUNTRIES),
    start,
    end: current ? null : date(random, startYear + 1, Math.min(startYear + 6, 2026)),
    in_office: current ? 'yes' : 'no',
  };
}

/** Synthetic office holders, each with one or two positions. */
export function syntheticPeps(options: SyntheticPepsOptions): WatchlistRecord[] {
  const random = seededRandom(`peps/${options.seed}`);
  const first = options.firstNumber ?? 5001;
  const used = new Set<string>();
  let nextPosition = 9001;
  return Array.from({ length: options.count ?? 10 }, (_, index) => {
    const stream = random.fork(`holder-${String(index)}`);
    let name = fictionalPersonName(stream);
    while (used.has(`${name.given.latin} ${name.family.latin}`)) {
      name = fictionalPersonName(stream);
    }
    used.add(`${name.given.latin} ${name.family.latin}`);
    const pepClass = ((index % 4) + 1) as 1 | 2 | 3 | 4;
    const positions = [
      position(stream, `Q-test-${String(nextPosition)}`, pepClass, stream.chance(0.7)),
    ];
    nextPosition += 1;
    if (stream.chance(0.3)) {
      const earlier = stream.pick([1, 2, 3, 4] as const);
      positions.push(position(stream, `Q-test-${String(nextPosition)}`, earlier, false));
      nextPosition += 1;
    }
    const names: WatchlistRecord['names'] = [
      {
        full: `${name.given.latin} ${name.family.latin}`,
        parts: [
          { role: 'given', value: name.given.latin },
          { role: 'family', value: name.family.latin },
        ],
        script: 'latin',
        quality: 'strong',
        primary: true,
      },
    ];
    if (stream.chance(0.25)) {
      names.push({
        full: `${name.given.cyrillic} ${name.family.cyrillic}`,
        parts: [],
        script: 'cyrillic',
        quality: 'strong',
        primary: false,
      });
    }
    const gender = stream.chance(0.8) ? stream.pick(['female', 'male'] as const) : undefined;
    return {
      entry_id: `Q-test-${String(first + index)}`,
      kind: 'individual',
      names,
      birth_dates: stream.chance(0.8)
        ? [{ value: date(stream, 1940, 1985), precision: 'day' }]
        : [],
      birth_places: [],
      countries: [{ code: positions[0]?.country ?? null, role: 'citizenship' }],
      ...(gender === undefined ? {} : { gender }),
      identifiers: [],
      addresses: [],
      crypto_addresses: [],
      programs: [],
      positions,
      relations: [],
    };
  });
}
