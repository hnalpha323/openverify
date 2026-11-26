import { describe, expect, it } from 'vitest';
import { foldText, foldedTokens, inDifferentScripts, writingSystemsOf } from './text.js';

describe('foldText', () => {
  it.each([
    ['smith', 'smith', 'smith', false, false],
    ['José', 'jose', 'jose', true, false],
    ['Müller', 'muller', 'mueller', true, false],
    ['Øster', 'oster', 'oester', true, false],
    ['Åsa', 'asa', 'aasa', true, false],
    ['Straße', 'strasse', 'strasse', true, false],
    ['Łukasz', 'lukasz', 'lukasz', true, false],
    ['ＪＯＨＮ', 'john', 'john', true, false],
    ["O'Brien", 'obrien', 'obrien', false, true],
    ['D’Angelo', 'dangelo', 'dangelo', false, true],
    ['Jean-Pierre', 'jean pierre', 'jean pierre', false, true],
    ['  Anna \t MARIA ', 'anna maria', 'anna maria', false, false],
    ['Иван', 'иван', 'иван', false, false],
    ['', '', '', false, false],
  ])('folds %j', (value, simplified, expanded, folded, specialCharacters) => {
    expect(foldText(value)).toEqual({ simplified, expanded, folded, specialCharacters });
  });

  it('gives the simplified tokens', () => {
    expect(foldedTokens('  Anna-Maria  Smith ')).toEqual(['anna', 'maria', 'smith']);
    expect(foldedTokens(' - ')).toEqual([]);
  });
});

describe('writing systems (C58.2)', () => {
  it.each([
    ['Ivan Petrov', ['latin']],
    ['Иван Petrov', ['cyrillic', 'latin']],
    ['Ἀθηνᾶ', ['greek']],
    ['李小龍', ['han']],
    ['たなか', ['hiragana']],
    ['김민준', ['hangul']],
    ['محمد', ['arabic']],
    ['123 - #', []],
  ])('reads %j', (value, systems) => {
    expect([...writingSystemsOf(value)].sort()).toEqual(systems);
  });

  it('tells two scripts apart only when both have letters and none in common', () => {
    expect(inDifferentScripts('Ivan', 'Иван')).toBe(true);
    expect(inDifferentScripts('Ivan', 'Ivan')).toBe(false);
    expect(inDifferentScripts('Иван Petrov', 'Ivan')).toBe(false);
    expect(inDifferentScripts('Ivan', '')).toBe(false);
    expect(inDifferentScripts('12', 'Иван')).toBe(false);
  });
});
