/**
 * C98.2, C101.2: the key inputs of the kinds that read the C78 analysis. The names are fictional or
 * common, as in `keys-golden.test.ts`.
 */
import { createHash } from 'node:crypto';
import { LIST_KEYS_VERSION, ListKeyInputError, graphKeyInput } from '@openverify/checks';
import { describe, expect, it } from 'vitest';
import { KEYS_VERSION } from '../keys/index.js';
import {
  graphNameBirthdateKeyInputs,
  graphNameKeyInputs,
  listLastNameKeyInputs,
  listNameKeyInputs,
  type ListName,
} from './index.js';

const name = (first: unknown, last: unknown) =>
  ({ 'name-first': first, 'name-last': last }) as ListName;

const inputs = (keys: readonly { input: string }[]) => keys.map(({ input }) => input);

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof ListKeyInputError) {
      return { code: error.code, member: error.member };
    }
    throw error;
  }
  throw new Error('the name was accepted');
};

describe('listNameKeyInputs (C98.2)', () => {
  it('keys <last>|<first> and <first>|<last> in both ICAO 9303 folds: at most 4', () => {
    expect(listNameKeyInputs(name('Ana', 'Müller'))).toEqual([
      { keyKind: 'identifier-name', input: 'muller|ana' },
      { keyKind: 'identifier-name', input: 'ana|muller' },
      { keyKind: 'identifier-name', input: 'mueller|ana' },
      { keyKind: 'identifier-name', input: 'ana|mueller' },
    ]);
  });

  it('keys one fold once when the folds agree', () => {
    expect(inputs(listNameKeyInputs(name('  JOSÉ ', "O'Brien")))).toEqual([
      'obrien|jose',
      'jose|obrien',
    ]);
  });

  it('keys one key when the two orders agree', () => {
    expect(inputs(listNameKeyInputs(name('Ana', 'Ana')))).toEqual(['ana|ana']);
  });

  it('joins several tokens with a space, however they were separated', () => {
    expect(inputs(listNameKeyInputs(name('Zoë Marie', 'Ångström')))).toEqual([
      'angstrom|zoe marie',
      'zoe marie|angstrom',
      'aangstroem|zoe marie',
      'zoe marie|aangstroem',
    ]);
    expect(listNameKeyInputs(name('Jean-Luc', 'Smith-Jones'))).toEqual(
      listNameKeyInputs(name('JEAN LUC', 'smith jones')),
    );
  });

  it('meets "Müller" and "Mueller" on the expanded fold, and "Muller" on the simple one', () => {
    const item = inputs(listNameKeyInputs(name('Ana', 'Müller')));
    expect(item).toContain(inputs(listNameKeyInputs(name('Ana', 'Mueller')))[0]);
    expect(item).toContain(inputs(listNameKeyInputs(name('Ana', 'Muller')))[0]);
  });

  it('meets a swapped name on the other order', () => {
    const swapped = inputs(listNameKeyInputs(name('Müller', 'Ana')));
    expect(inputs(listNameKeyInputs(name('Ana', 'Müller')))[0]).toBe(swapped[1]);
  });

  it('drops a title and keeps a particle, as the analysis reads them', () => {
    expect(listNameKeyInputs(name('Dr Ana', 'Müller'))).toEqual(
      listNameKeyInputs(name('Ana', 'Müller')),
    );
    expect(inputs(listNameKeyInputs(name('Pieter', 'van der Berg')))[0]).toBe(
      'van der berg|pieter',
    );
  });

  it('keeps a generational suffix: "John Smith Sr" is not "John Smith Jr", exactly', () => {
    const junior = inputs(listNameKeyInputs(name('John', 'Smith Jr')));
    expect(junior).not.toEqual(inputs(listNameKeyInputs(name('John', 'Smith Sr'))));
    expect(junior).not.toEqual(inputs(listNameKeyInputs(name('John', 'Smith'))));
  });

  it('meets a Cyrillic name and its ICAO 9303 Latin form', () => {
    expect(listNameKeyInputs(name('Мария', 'Иванова'))).toEqual(
      listNameKeyInputs(name('Mariia', 'Ivanova')),
    );
  });

  it('never meets on a lossy Latin form: two Han names that read alike are two people (ADR 0005)', () => {
    expect(inputs(listNameKeyInputs(name('小明', '王')))).toEqual(['王|小明', '小明|王']);
    expect(listNameKeyInputs(name('小明', '汪'))).not.toEqual(
      listNameKeyInputs(name('小明', '王')),
    );
    expect(listNameKeyInputs(name('Xiaoming', 'Wang'))).not.toEqual(
      listNameKeyInputs(name('小明', '王')),
    );
  });

  it('keys an Arabic name on its normalised original, which has vowels a Latin form lost', () => {
    const [first] = inputs(listNameKeyInputs(name('محمد', 'الله')));
    expect(first).toMatch(/^\p{Script=Arabic}+\|\p{Script=Arabic}+$/u);
  });

  it('gives parts that cannot move, in any script', () => {
    for (const [first, last] of [
      ['小明', '王'],
      ['محمد', 'الله'],
      ['Ēriks', 'Ķēniņš'],
      ['Łukasz', 'Żółć'],
    ] as const) {
      for (const { input } of listNameKeyInputs(name(first, last))) {
        const parts = input.split('|');
        expect(parts).toHaveLength(2);
        expect(parts.every((part) => part !== '' && part === part.trim())).toBe(true);
      }
    }
  });

  it.each([
    [name('---', 'Müller'), 'name-first'],
    [name('Ana', '---'), 'name-last'],
    [name('', 'Müller'), 'name-first'],
    [name(' ', 'Müller'), 'name-first'],
    [name('Ana', ''), 'name-last'],
    [name(null, 'Müller'), 'name-first'],
    [name('Ana', 7), 'name-last'],
  ])('refuses %j: an exact key needs both names', (value, member) => {
    expect(refusal(() => listNameKeyInputs(value))).toEqual({ code: 'invalid_value', member });
  });

  it('refuses a first name that is only a title', () => {
    expect(refusal(() => listNameKeyInputs(name('Dr', 'Müller')))).toEqual({
      code: 'invalid_value',
      member: 'name-first',
    });
  });

  it('refuses a last name that is only a suffix', () => {
    expect(refusal(() => listNameKeyInputs(name('Ana', 'Jr')))).toEqual({
      code: 'invalid_value',
      member: 'name-last',
    });
  });

  it('refuses a name the contract cannot serve, or the analysis would cut', () => {
    expect(refusal(() => listNameKeyInputs(name('a'.repeat(301), 'Müller')))).toEqual({
      code: 'out_of_range',
      member: 'name-first',
    });
    expect(refusal(() => listNameKeyInputs(name('Ana', 'a'.repeat(301))))).toEqual({
      code: 'out_of_range',
      member: 'name-last',
    });
    expect(refusal(() => listNameKeyInputs(name('a '.repeat(40), 'Müller')))).toEqual({
      code: 'out_of_range',
      member: 'name-first',
    });
  });
});

describe('listLastNameKeyInputs (C98.2, F17)', () => {
  it('keys the last name per fold', () => {
    expect(listLastNameKeyInputs(name('Ana', 'Müller'))).toEqual([
      { keyKind: 'identifier-name-last', input: 'muller' },
      { keyKind: 'identifier-name-last', input: 'mueller' },
    ]);
  });

  it('keys one fold once', () => {
    expect(inputs(listLastNameKeyInputs(name('Ana', 'Smith')))).toEqual(['smith']);
  });

  it('never reads the first name: it is the fuzzy part', () => {
    expect(listLastNameKeyInputs(name('Anna', 'Müller'))).toEqual(
      listLastNameKeyInputs(name('Ana', 'Müller')),
    );
  });

  it('leaves a suffix out, so a candidate is found across generations', () => {
    expect(listLastNameKeyInputs(name('John', 'Smith Jr'))).toEqual(
      listLastNameKeyInputs(name('John', 'Smith')),
    );
  });

  it('keys a lossy last name on its original form, as the exact keys do', () => {
    expect(inputs(listLastNameKeyInputs(name('小明', '王')))).toEqual(['王']);
  });

  it('keeps every word of the last name', () => {
    expect(inputs(listLastNameKeyInputs(name('Pieter', 'van der Berg')))).toEqual(['van der berg']);
  });

  it('refuses what the exact keys refuse', () => {
    expect(refusal(() => listLastNameKeyInputs(name('Ana', '---')))).toEqual({
      code: 'invalid_value',
      member: 'name-last',
    });
  });
});

describe('the graph name kinds (C101.2)', () => {
  it('shares the list keys for the weak name kind (decision 29, narrowed)', () => {
    expect(graphNameKeyInputs(name('Ana', 'Müller'))).toEqual(
      listNameKeyInputs(name('Ana', 'Müller')),
    );
  });

  it('adds the birthdate to each form for name_birthdate', () => {
    expect(graphNameBirthdateKeyInputs(name('Ana', 'Müller'), '1990-02-03')).toEqual([
      { keyKind: 'identifier-name-birthdate', input: 'muller|ana|1990-02-03' },
      { keyKind: 'identifier-name-birthdate', input: 'ana|muller|1990-02-03' },
      { keyKind: 'identifier-name-birthdate', input: 'mueller|ana|1990-02-03' },
      { keyKind: 'identifier-name-birthdate', input: 'ana|mueller|1990-02-03' },
    ]);
  });

  it('reads the birthdate as the birthdate kind does', () => {
    expect(inputs(graphNameBirthdateKeyInputs(name('Ana', 'Ana'), ' 1990-02-03 '))).toEqual([
      `ana|ana|${graphKeyInput('birthdate', { value: '1990-02-03' }).input}`,
    ]);
  });

  it('refuses a date that is no day', () => {
    expect(refusal(() => graphNameBirthdateKeyInputs(name('Ana', 'Ana'), '1990-13-01'))).toEqual({
      code: 'invalid_value',
      member: 'value',
    });
  });

  it('refuses a name the exact keys refuse', () => {
    expect(refusal(() => graphNameBirthdateKeyInputs(name('Ana', '---'), '1990-02-03'))).toEqual({
      code: 'invalid_value',
      member: 'name-last',
    });
  });
});

/** One digest per `LIST_KEYS_VERSION;KEYS_VERSION`, as `keys-golden.test.ts` holds its own. */
const GOLDEN: Readonly<Record<string, string>> = {
  'lists-1;names-2': '579f8a45aa53b47e58e9397bc28415d7f478e7bbf0f1888a3aad4bad1227f5bc',
};

const NAMES: readonly (readonly [string, string])[] = [
  ['Hans', 'Müller'],
  ['John Paul', 'Smith'],
  ['Иван', 'Петров'],
  ['Мария', 'Щербакова'],
  ['محمد', 'عبد الله'],
  ['小明', '王'],
  ['Jean-Luc', 'de la Fontaine Jr'],
  ['Ołeksij', 'Ćwik'],
  ['Ünal', 'Øvergård'],
  ['Dr Ana', "O'Brien"],
];

describe('the version guard of the name kinds (C98.2, Phase 6 outcome 7)', () => {
  it('holds its golden digest: a changed output needs a new LIST_KEYS_VERSION', () => {
    const rows = NAMES.flatMap(([first, last]) => [
      listNameKeyInputs(name(first, last)),
      listLastNameKeyInputs(name(first, last)),
      graphNameKeyInputs(name(first, last)),
      graphNameBirthdateKeyInputs(name(first, last), '1990-02-03'),
    ]);
    const digest = createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
    expect(digest).toBe(GOLDEN[`${LIST_KEYS_VERSION};${KEYS_VERSION}`]);
  });
});
