/**
 * Nicknames (C58.3): our own table, `packages/checks/data/nicknames.json`, built by
 * `scripts/build-nicknames.ts` from the authored rows and the reviewed Wikidata pairs; each pair
 * records its sources (`authored`, or `wikidata:<nickname item>/<formal item>`). A pair is a
 * direct link between a formal name and a nickname: two nicknames of one name are not linked,
 * and nothing is chained. The table is read once, on first use.
 */

import { z } from 'zod';
import { readMatchingData } from './data-files.js';
import { foldText } from './text.js';

/** One nickname of one formal name, as `nicknames.json` lists it. */
export interface NicknamePair {
  readonly formal: string;
  readonly nickname: string;
  /** ISO 639-1 codes of the languages the nickname is used in. */
  readonly languages: readonly string[];
  /** `authored`, and `wikidata:<nickname item>/<formal item>` for each reviewed Wikidata pair. */
  readonly sources: readonly string[];
}

const nicknameTableSchema = z.object({
  pairs: z.array(
    z.strictObject({
      formal: z.string().min(1),
      nickname: z.string().min(1),
      languages: z.array(z.string()).min(1),
      sources: z.array(z.string()).min(1),
    }),
  ),
});

interface NicknameTable {
  readonly pairs: readonly NicknamePair[];
  /** Each folded name (both renderings) to the folded names it is directly paired with. */
  readonly links: ReadonlyMap<string, ReadonlySet<string>>;
}

let loaded: NicknameTable | undefined;

const renderings = (name: string): string[] => {
  const folded = foldText(name);
  return [...new Set([folded.simplified, folded.expanded])];
};

function nicknameTable(): NicknameTable {
  if (loaded === undefined) {
    const { pairs } = nicknameTableSchema.parse(readMatchingData('nicknames.json'));
    const links = new Map<string, Set<string>>();
    const link = (from: string, to: string) => {
      const linked = links.get(from) ?? new Set<string>();
      linked.add(to);
      links.set(from, linked);
    };
    for (const pair of pairs) {
      for (const formal of renderings(pair.formal)) {
        for (const nickname of renderings(pair.nickname)) {
          link(formal, nickname);
          link(nickname, formal);
        }
      }
    }
    loaded = { pairs, links };
  }
  return loaded;
}

/** Every pair of the committed table. */
export function nicknamePairs(): readonly NicknamePair[] {
  return nicknameTable().pairs;
}

/** Whether a name token is a formal name or a nickname of the table, in either rendering. */
export function isListedName(name: string): boolean {
  const { links } = nicknameTable();
  return renderings(name).some((rendering) => links.has(rendering));
}

/**
 * Whether one of two name tokens is a listed nickname of the other, in either folded rendering
 * (Bill and William, José and Pepe). Equal tokens are not nicknames of each other.
 */
export function areNicknames(a: string, b: string): boolean {
  const left = renderings(a).filter(Boolean);
  const right = renderings(b).filter(Boolean);
  if (left.length === 0 || right.length === 0 || left.some((name) => right.includes(name))) {
    return false;
  }
  const { links } = nicknameTable();
  return left.some((name) => right.some((other) => links.get(name)?.has(other) === true));
}
