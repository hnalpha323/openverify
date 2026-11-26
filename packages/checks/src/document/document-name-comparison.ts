/**
 * `document_name_comparison` (R, user behaviour with category `fraud`, required; C60.6, V12): the
 * addressee's name against the reference's (the inquiry's fields, else its latest government ID,
 * else the account), at `min-match-level` through the C58 name matcher; a joint addressee ("A and
 * B") matches on either name. A mismatch fails `document_name_mismatch`, so a bill in a partner's
 * or a former name can be replaced; no reference answers `no_reference_data`, no readable name or
 * an undecidable comparison `input_missing`.
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { meetsRequirement, type FieldMatch } from '../matching/levels.js';
import { matchNameStrings } from '../matching/names.js';
import { checkResult, presentText } from '../result.js';
import { documentReferenceName, type DocumentContext } from './context.js';
import { DOCUMENT_LEXICONS } from './lexicons/index.js';

const ID = 'document_name_comparison';

/**
 * The holders a joint addressee names ("QUINN & ADA VALEMONT", "A and B"), a lone given name
 * taking the last holder's family name.
 */
export function documentHolderNames(name: string, jointWords: readonly string[]): string[] {
  const joints = new Set(['&', '+', ...jointWords.map((word) => word.toLowerCase())]);
  const parts: string[][] = [[]];
  for (const word of name.replaceAll('&', ' & ').split(/\s+/).filter(Boolean)) {
    if (joints.has(word.toLowerCase())) {
      parts.push([]);
    } else {
      parts.at(-1)?.push(word);
    }
  }
  const holders = parts.filter((part) => part.length > 0);
  const family = holders.at(-1);
  return holders.map((part) =>
    part.length === 1 && family !== undefined && family.length >= 2 && part !== family
      ? [...part, family.at(-1) ?? ''].join(' ')
      : part.join(' '),
  );
}

const describe = (match: FieldMatch) => ({
  level: match.level,
  methods: [...match.methods],
  flags: [...match.flags],
});

export function documentNameComparison(context: DocumentContext): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const options = phase5ResultOptions(config, ['min-match-level']);
  const { established, extraction } = context;
  if (established === null || extraction === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const reference = documentReferenceName(context.input);
  if (reference === null) {
    return checkResult(ID, 'not_applicable', ['no_reference_data'], {}, options);
  }
  if (extraction.name === null) {
    return checkResult(
      ID,
      'not_applicable',
      ['input_missing'],
      { 'reference-source': reference.source },
      options,
    );
  }
  const { first, middle, last } = reference.name;
  const full = [first, middle, last]
    .map((part) => presentText(part))
    .filter(Boolean)
    .join(' ');
  const language = context.classifier?.language ?? null;
  const holders = documentHolderNames(
    extraction.name,
    language === null ? [] : DOCUMENT_LEXICONS[language].jointWords,
  );
  const matches = holders.map((holder) => matchNameStrings(holder, full));
  const required = config.values['min-match-level'] === 'full' ? 'full' : 'partial';
  const meeting = matches.find((match) => meetsRequirement(match.level, required));
  const decided = matches.filter((match) => match.level !== 'missing');
  const shown = meeting ?? decided[0] ?? matches[0];
  const metadata = {
    ...(shown === undefined ? {} : describe(shown)),
    'reference-source': reference.source,
    holders: holders.length,
  };
  if (meeting !== undefined) {
    return checkResult(ID, 'passed', [], metadata, options);
  }
  return decided.length === matches.length
    ? checkResult(ID, 'failed', ['document_name_mismatch'], metadata, options)
    : checkResult(ID, 'not_applicable', ['input_missing'], metadata, options);
}
