/**
 * C162.2-C162.4 (Workflow 9A, `api-templates`): the rules a version's operator copy meets. Plain text
 * on declared keys only (`COPY_KEYS`, or a screen component's `<step id>.<component id>.<attribute>`),
 * `{name}` placeholders from each key's closed list, no markup, control, bidi override or format
 * character (none at all in a legal text), a biometric consent text that states the retention
 * through `{days}`, every custom consent text in every enabled locale, and `legal-copy:<key>` for a
 * legal text overridden in production. Problems point into the version's attributes (`/copy/...`).
 *
 * Every pattern here is a fixed literal; no operator text reaches `RegExp` as a pattern (rule 18).
 */
import type { TemplateCopy, TemplateLocale } from '@openverify/contracts';
import {
  BIOMETRIC_CONSENT_COPY_KEYS,
  COMPONENT_COPY_ATTRIBUTES,
  COMPONENT_COPY_MAX_LENGTH,
  COPY_KEYS,
  isFlowV2,
  type AnyFlow,
  type Component,
  type CopyKeyDefinition,
} from '@openverify/flow-spec';

/** One rule a version's members break, by pointer into its attributes; a warning never blocks. */
export interface TemplateRuleProblem {
  pointer: string;
  code: string;
  detail: string;
  severity: 'error' | 'warning';
}

export interface CopyRuleContext {
  flow: AnyFlow;
  enabledLocales: readonly TemplateLocale[];
  environmentKind: 'sandbox' | 'production';
}

export interface CopyRuleResult {
  problems: TemplateRuleProblem[];
  /** `legal-copy:<key>` for each legal text overridden, in production (sandbox warns). */
  acknowledgements: string[];
}

/** A component text: its own maximum, `{organization}` only, one line, no legal weight. */
const COMPONENT_TEXT: CopyKeyDefinition = Object.freeze({
  maxLength: COMPONENT_COPY_MAX_LENGTH,
  placeholders: ['organization'],
  consent: false,
  multiline: false,
  legal: null,
});

const PLACEHOLDER = /\{([a-z][a-z0-9_]{0,39})\}/gu;
const MARKUP = /<\/?[A-Za-z!]|\]\(|&[A-Za-z#][A-Za-z0-9]*;/u;
/** C0 and C1 controls and DEL; a line feed is checked apart, by the key's `multiline`. */
function hasControl(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 0x20 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** The text's length in code points, as a person counts characters. */
function codePoints(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    // A low surrogate completes the code point its high surrogate started.
    if (code < 0xdc00 || code > 0xdfff) count += 1;
  }
  return count;
}
const BIDI_OVERRIDE = /[\u202a-\u202e]/u;
const FORMAT = /\p{Cf}/gu;
/** LRM, RLM and the isolates (whose balance is checked apart) may stand in a text that is not legal. */
const ALLOWED_FORMAT = new Set(['\u200e', '\u200f', '\u2066', '\u2067', '\u2068', '\u2069']);

const escapePointer = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1');
const pointerOf = (locale: string, key?: string) =>
  `/copy/messages/${locale}${key === undefined ? '' : `/${escapePointer(key)}`}`;

/** The component copy keys a v2 flow's screens declare, nested components included. */
function componentKeys(flow: AnyFlow): Set<string> {
  const keys = new Set<string>();
  if (!isFlowV2(flow)) {
    return keys;
  }
  const walk = (stepId: string, components: readonly Component[]): void => {
    for (const component of components) {
      const prefix = `${stepId}.${component.id}`;
      for (const attribute of COMPONENT_COPY_ATTRIBUTES) {
        keys.add(`${prefix}.${attribute}`);
      }
      if ('options' in component) {
        for (const option of component.options) {
          keys.add(`${prefix}.option.${option.key}`);
        }
      }
      if ('children' in component) {
        walk(stepId, component.children);
      }
    }
  };
  for (const step of flow.steps) {
    if (step.type === 'screen') {
      walk(step.id, step.components);
    }
  }
  return keys;
}

/** Whether every isolate initiator is closed by a pop, in order, and no pop comes unopened. */
function isolatesBalanced(text: string): boolean {
  let open = 0;
  for (const character of text) {
    if (character === '\u2066' || character === '\u2067' || character === '\u2068') {
      open += 1;
    } else if (character === '\u2069') {
      if (open === 0) return false;
      open -= 1;
    }
  }
  return open === 0;
}

/** The first rule one text breaks, or `null`. */
function textProblem(
  key: string,
  text: string,
  definition: CopyKeyDefinition,
): { code: string; detail: string } | null {
  if (text.trim().length === 0) {
    return { code: 'copy_empty', detail: 'A text must not be empty.' };
  }
  if (codePoints(text) > definition.maxLength) {
    return {
      code: 'copy_too_long',
      detail: `This text may be at most ${String(definition.maxLength)} characters long.`,
    };
  }
  if (hasControl(text) || (!definition.multiline && text.includes('\n'))) {
    return {
      code: 'copy_control_character',
      detail: definition.multiline
        ? 'A text may hold no control character but a line feed.'
        : 'This text is one line: it may hold no control character or line feed.',
    };
  }
  if (BIDI_OVERRIDE.test(text)) {
    return {
      code: 'copy_bidi_override',
      detail: 'Bidirectional embeddings and overrides (U+202A to U+202E) are refused.',
    };
  }
  const formats = text.match(FORMAT) ?? [];
  if (formats.some((character) => definition.legal !== null || !ALLOWED_FORMAT.has(character))) {
    return {
      code: 'copy_format_character',
      detail:
        definition.legal === null
          ? 'Invisible format characters are refused, except the marks U+200E and U+200F.'
          : 'A text with legal weight may hold no invisible format character.',
    };
  }
  if (!isolatesBalanced(text)) {
    return {
      code: 'copy_bidi_unbalanced',
      detail: 'Each bidirectional isolate (U+2066 to U+2068) must be closed by U+2069.',
    };
  }
  if (MARKUP.test(text)) {
    return { code: 'copy_markup', detail: 'Copy is plain text: no HTML, Markdown or entities.' };
  }
  const names = [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
  if (/[{}]/u.test(text.replaceAll(PLACEHOLDER, ''))) {
    return {
      code: 'copy_placeholder_invalid',
      detail: 'Braces stand only around a placeholder name, such as {organization}.',
    };
  }
  const unknown = names.find((name) => !definition.placeholders.includes(name));
  if (unknown !== undefined) {
    return {
      code: 'copy_placeholder_unknown',
      detail:
        definition.placeholders.length === 0
          ? 'This text takes no placeholder.'
          : `This text takes only ${definition.placeholders.map((name) => `{${name}}`).join(', ')}.`,
    };
  }
  if (BIOMETRIC_CONSENT_COPY_KEYS.includes(key) && !names.includes('days')) {
    return {
      code: 'consent_copy_missing_placeholder',
      detail:
        'A biometric consent text states the face-template retention through {days}, which the server fills.',
    };
  }
  return null;
}

/** The copy's problems and the acknowledgements it needs. */
export function copyRuleProblems(copy: TemplateCopy, context: CopyRuleContext): CopyRuleResult {
  const problems: TemplateRuleProblem[] = [];
  const acknowledgements = new Set<string>();
  const components = componentKeys(context.flow);
  const consentKeys = new Set<string>();
  for (const [locale, texts] of Object.entries(copy.messages)) {
    if (!context.enabledLocales.includes(locale as TemplateLocale)) {
      problems.push({
        pointer: pointerOf(locale),
        code: 'locale_unsupported',
        detail: 'The version does not enable this locale; add it to enabled-locales first.',
        severity: 'error',
      });
      continue;
    }
    for (const [key, text] of Object.entries(texts)) {
      const definition = COPY_KEYS[key] ?? (components.has(key) ? COMPONENT_TEXT : undefined);
      if (definition === undefined) {
        problems.push({
          pointer: pointerOf(locale, key),
          code: 'copy_key_unknown',
          detail: 'No overridable text or screen component of this flow has this key.',
          severity: 'error',
        });
        continue;
      }
      const broken = textProblem(key, text, definition);
      if (broken !== null) {
        problems.push({ pointer: pointerOf(locale, key), ...broken, severity: 'error' });
        continue;
      }
      if (definition.consent) {
        consentKeys.add(key);
      }
      if (definition.legal !== null) {
        if (context.environmentKind === 'production') {
          acknowledgements.add(`legal-copy:${key}`);
        } else {
          problems.push({
            pointer: pointerOf(locale, key),
            code: 'legal_copy_overridden',
            detail:
              'This text has legal weight; in production its override needs the acknowledgement legal-copy:<key>.',
            severity: 'warning',
          });
        }
      }
    }
  }
  // C162.4: a custom consent text in every enabled locale, never a fallback to built-in words.
  for (const key of consentKeys) {
    for (const locale of context.enabledLocales) {
      if (copy.messages[locale]?.[key] === undefined) {
        problems.push({
          pointer: pointerOf(locale, key),
          code: 'consent_copy_incomplete',
          detail: 'A custom consent text must be given in every enabled locale.',
          severity: 'error',
        });
      }
    }
  }
  return { problems, acknowledgements: [...acknowledgements] };
}

/** The copy with every text NFC-normalised, as it is stored (C162.3). */
export function normaliseCopy(copy: TemplateCopy): TemplateCopy {
  return {
    messages: Object.fromEntries(
      Object.entries(copy.messages).map(([locale, texts]) => [
        locale,
        Object.fromEntries(
          Object.entries(texts).map(([key, text]) => [key, text.normalize('NFC')]),
        ),
      ]),
    ),
  };
}
