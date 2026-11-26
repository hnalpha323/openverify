/**
 * C238.3, C238.9, C237.4 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 4): the
 * `share_consent` step's text, composed by the server and never by a client. This module returns
 * the logical form (the closed placeholders filled, NFC); `api-consent` digests it with Phase 9's
 * `consentTextDigest` algorithm (UTF-8, SHA-256 in hex over the NFC text), so one definition of the
 * logical form holds for consent and share-consent (Stage 1a amendment 20).
 */
import { SHARE_CATEGORIES, type ShareCategory } from './categories.js';

/** C238.3: the closed placeholders (flow-spec's `SHARE_CONSENT_PLACEHOLDERS`, the same list). */
export const SHARE_TEXT_PLACEHOLDERS = Object.freeze([
  'source',
  'recipient',
  'categories',
  'expires',
  'withdraw',
  'retention',
] as const);
export type ShareTextPlaceholder = (typeof SHARE_TEXT_PLACEHOLDERS)[number];

/** The copy keys a step of each side shows (flow-spec's `share.consent.*` keys). */
export interface ShareConsentTextKeys {
  readonly title: string;
  readonly main: string;
  readonly biometric: string;
  readonly accept: string;
  readonly decline: string;
  readonly withdraw: string;
}

export const SHARE_CONSENT_TEXT_KEYS: Readonly<
  Record<'source' | 'destination', ShareConsentTextKeys>
> = Object.freeze({
  source: Object.freeze({
    title: 'share.consent.title',
    main: 'share.consent.source',
    biometric: 'share.consent.biometric-source',
    accept: 'share.consent.accept',
    decline: 'share.consent.decline',
    withdraw: 'share.consent.withdraw',
  }),
  destination: Object.freeze({
    title: 'share.consent.title',
    main: 'share.consent.destination',
    biometric: 'share.consent.biometric-destination',
    accept: 'share.consent.accept',
    decline: 'share.consent.decline',
    withdraw: 'share.consent.withdraw',
  }),
});

/**
 * One text to compose: its key, its text (the version's operator copy, `{name}` placeholders, or a
 * released built-in text, `{{name}}`), and the key's closed list (`COPY_KEYS[key].placeholders`).
 */
export interface ShareTextTemplate {
  readonly key: string;
  readonly text: string;
  readonly builtIn: boolean;
  readonly placeholders: readonly string[];
}

/** The values the server fills (C238.3, C238.9, C237.4). */
export interface ShareTextValues {
  readonly locale: string;
  /** The source organisation's display name, as shown. */
  readonly source: string;
  /** The recipient organisation's display name, as shown. */
  readonly recipient: string;
  readonly categories: readonly ShareCategory[];
  /** The locale's words for each category. */
  readonly categoryWords: Readonly<Record<ShareCategory, string>>;
  /** The consent's validity, the step's `consentValidSeconds`. */
  readonly validSeconds: number;
  /** The step's `withdrawalContact`. */
  readonly withdraw: string;
  /**
   * C238.9: the destination's retention term: the template's `retention-days`, else the
   * environment's, in days; or the locale's words when neither is set; `null` when unknown.
   */
  readonly retention: { readonly days: number } | { readonly words: string } | null;
}

export const SHARE_TEXT_PROBLEMS = Object.freeze([
  'placeholder_not_allowed',
  'value_empty',
  'withdraw_empty',
  'retention_missing',
] as const);
export type ShareTextProblem = (typeof SHARE_TEXT_PROBLEMS)[number];

export type ShareTextComposition =
  | { readonly ok: true; readonly body: string; readonly keys: readonly string[] }
  | {
      readonly ok: false;
      readonly problem: ShareTextProblem;
      readonly key: string;
      readonly placeholder: string;
    };

/** The units a duration is said in, largest first, with their length in seconds. */
const DURATION_UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
] as const;

/**
 * A whole, positive number of seconds in words, in the largest unit that divides it (the step's
 * 1,209,600 is "14 days"), by the locale's own unit words (`Intl.NumberFormat`, `unitDisplay:
 * 'long'`). A duration, never a date: the text served and the text recomposed at the accept are
 * the same, so their digests agree.
 */
export function durationInWords(seconds: number, locale: string): string {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new RangeError('a duration is a whole, positive number of seconds');
  }
  const [unit, length] = DURATION_UNITS.find(([, size]) => seconds % size === 0) ?? ['second', 1];
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(
    seconds / length,
  );
}

/**
 * The categories in words, in `SHARE_CATEGORIES` order and once each, joined as the locale joins a
 * list (`Intl.ListFormat`, a conjunction).
 */
export function categoriesInWords(
  categories: readonly ShareCategory[],
  words: Readonly<Record<ShareCategory, string>>,
  locale: string,
): string {
  const named = SHARE_CATEGORIES.filter((category) => categories.includes(category)).map(
    (category) => words[category].normalize('NFC'),
  );
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(named);
}

/** `{name}` in operator copy, `{{name}}` in a released built-in text (Phase 9 C162.3, C162.9). */
const OPERATOR_PLACEHOLDER = /\{([a-z][a-z0-9_]{0,39})\}/g;
const BUILT_IN_PLACEHOLDER = /\{\{([a-z][a-z0-9_]{0,39})\}\}/g;
const CLOSED: ReadonlySet<string> = new Set(SHARE_TEXT_PLACEHOLDERS);

/** The value of one placeholder, or why it cannot be filled. */
function valueOf(
  name: ShareTextPlaceholder,
  values: ShareTextValues,
): { readonly value: string } | { readonly problem: ShareTextProblem } {
  switch (name) {
    case 'source':
    case 'recipient': {
      const value = values[name].normalize('NFC');
      return value.length === 0 ? { problem: 'value_empty' } : { value };
    }
    case 'categories':
      return values.categories.length === 0 ||
        values.categories.some((category) => values.categoryWords[category].length === 0)
        ? { problem: 'value_empty' }
        : { value: categoriesInWords(values.categories, values.categoryWords, values.locale) };
    case 'expires':
      return { value: durationInWords(values.validSeconds, values.locale) };
    case 'withdraw':
      // C237.4 (review H06): `{withdraw}` never renders empty.
      return values.withdraw.trim().length === 0
        ? { problem: 'withdraw_empty' }
        : { value: values.withdraw.normalize('NFC') };
    case 'retention':
      if (values.retention === null) {
        return { problem: 'retention_missing' };
      }
      if ('days' in values.retention) {
        return { value: durationInWords(values.retention.days * 86_400, values.locale) };
      }
      return values.retention.words.length === 0
        ? { problem: 'value_empty' }
        : { value: values.retention.words.normalize('NFC') };
  }
}

/**
 * C238.3: the logical text of `parts`: each part's closed placeholders filled by the server in one
 * pass (a value that looks like a placeholder stays as written), the parts joined by a blank line,
 * the whole NFC. `keys` names the parts' copy keys in order (the client view's `text.keys`). The
 * client composes nothing; `api-consent` serves `body` with its digest and checks the echoed digest
 * against it (C238.4).
 *
 * Refused, at the first placeholder in text order that cannot be filled: one outside the key's
 * closed list or the share list (`placeholder_not_allowed`), an empty name or category list or
 * category word (`value_empty`), an empty or blank withdrawal contact (`withdraw_empty`, C237.4),
 * a retention term the text asks for and the server does not know (`retention_missing`, C238.9).
 * @throws {RangeError} for no part at all, or a validity that is not a whole positive number of
 *   seconds.
 */
export function composeShareConsentText(
  parts: readonly ShareTextTemplate[],
  values: ShareTextValues,
): ShareTextComposition {
  if (parts.length === 0) {
    throw new RangeError('a share-consent text has at least one part');
  }
  const bodies: string[] = [];
  for (const part of parts) {
    const pattern = part.builtIn ? BUILT_IN_PLACEHOLDER : OPERATOR_PLACEHOLDER;
    let filled = '';
    let written = 0;
    for (const match of part.text.matchAll(pattern)) {
      const name = match[1] ?? '';
      if (!CLOSED.has(name) || !part.placeholders.includes(name)) {
        return { ok: false, problem: 'placeholder_not_allowed', key: part.key, placeholder: name };
      }
      const result = valueOf(name as ShareTextPlaceholder, values);
      if ('problem' in result) {
        return { ok: false, problem: result.problem, key: part.key, placeholder: name };
      }
      filled += part.text.slice(written, match.index) + result.value;
      written = match.index + match[0].length;
    }
    filled += part.text.slice(written);
    bodies.push(filled);
  }
  return {
    ok: true,
    body: bodies.join('\n\n').normalize('NFC'),
    keys: parts.map((part) => part.key),
  };
}
