/**
 * C162.2-C162.4 (Workflow 9A): operator copy is plain text on declared keys with each key's own
 * `{name}` placeholders; markup, control characters, bidi overrides and format characters are
 * refused (any format character in a legal text); a biometric consent override states `{days}`;
 * a custom consent text is given in every enabled locale; a legal text overridden in production
 * needs `legal-copy:<key>`. Every text is synthetic.
 */
import { readFileSync } from 'node:fs';
import type { TemplateCopy } from '@openverify/contracts';
import { parseAnyFlow } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import { copyRuleProblems, normaliseCopy, type CopyRuleContext } from './copy-rules.js';

const screenFlow = parseAnyFlow(
  JSON.parse(
    readFileSync(
      new URL('../../../../../contracts/fixtures/flows/v2/projection-screen.json', import.meta.url),
      'utf8',
    ),
  ),
);

const context = (overrides: Partial<CopyRuleContext> = {}): CopyRuleContext => ({
  flow: screenFlow,
  enabledLocales: ['en'],
  environmentKind: 'sandbox',
  ...overrides,
});

const copyOf = (messages: TemplateCopy['messages']): TemplateCopy => ({ messages });

const codes = (copy: TemplateCopy, overrides: Partial<CopyRuleContext> = {}) =>
  copyRuleProblems(copy, context(overrides)).problems.map(({ pointer, code, severity }) => ({
    pointer,
    code,
    severity,
  }));

describe('operator copy (C162.2, C162.3)', () => {
  it('accepts plain text on a declared key with its own placeholders', () => {
    expect(
      copyRuleProblems(
        copyOf({ en: { 'completion.title': 'Thank you, {organization} has it' } }),
        context(),
      ),
    ).toEqual({ problems: [], acknowledgements: [] });
  });

  it('refuses an unknown key, an unknown placeholder, a stray brace and markup, at their pointers', () => {
    expect(
      codes(
        copyOf({
          en: {
            'nope.title': 'x',
            'completion.title': 'Hi {name}',
            'failure.title': 'Count {n, plural, one {#}}',
            'screen.continue': '<b>Go</b>',
          },
        }),
      ),
    ).toEqual([
      { pointer: '/copy/messages/en/nope.title', code: 'copy_key_unknown', severity: 'error' },
      {
        pointer: '/copy/messages/en/completion.title',
        code: 'copy_placeholder_unknown',
        severity: 'error',
      },
      {
        pointer: '/copy/messages/en/failure.title',
        code: 'copy_placeholder_invalid',
        severity: 'error',
      },
      { pointer: '/copy/messages/en/screen.continue', code: 'copy_markup', severity: 'error' },
    ]);
  });

  it('refuses a text past its key maximum and a line feed where the key is one line', () => {
    expect(
      codes(copyOf({ en: { 'screen.continue': 'x'.repeat(41), 'completion.title': 'a\nb' } })),
    ).toEqual([
      { pointer: '/copy/messages/en/screen.continue', code: 'copy_too_long', severity: 'error' },
      {
        pointer: '/copy/messages/en/completion.title',
        code: 'copy_control_character',
        severity: 'error',
      },
    ]);
  });

  it('refuses bidi overrides and unclosed isolates, and format characters but LRM and RLM', () => {
    expect(
      codes(
        copyOf({
          en: {
            'completion.title': 'a\u202eb',
            'failure.title': 'a\u2067b',
            'screen.continue': 'a​b',
            'screen.help': 'a\u2067b\u2069 \u200f',
          },
        }),
      ),
    ).toEqual([
      {
        pointer: '/copy/messages/en/completion.title',
        code: 'copy_bidi_override',
        severity: 'error',
      },
      {
        pointer: '/copy/messages/en/failure.title',
        code: 'copy_bidi_unbalanced',
        severity: 'error',
      },
      {
        pointer: '/copy/messages/en/screen.continue',
        code: 'copy_format_character',
        severity: 'error',
      },
    ]);
  });

  it('refuses every format character in a legal text, LRM included', () => {
    expect(codes(copyOf({ en: { 'notice.session-integrity': 'We check this page \u200e.' } }))).toEqual([
      {
        pointer: '/copy/messages/en/notice.session-integrity',
        code: 'copy_format_character',
        severity: 'error',
      },
    ]);
  });

  it('accepts a component text of a screen in the flow, an option by its key, and nothing else', () => {
    const step = screenFlow.steps.find((candidate) => candidate.type === 'screen');
    expect(step).toBeDefined();
    const component = step?.type === 'screen' ? step.components[0] : undefined;
    expect(component).toBeDefined();
    const key = `${step?.id ?? ''}.${component?.id ?? ''}.label`;
    expect(
      codes(
        copyOf({
          en: {
            [key]: 'Your name',
            [`${step?.id ?? ''}.missing.label`]: 'x',
            'step.c.colour': 'x',
          },
        }),
      ),
    ).toEqual([
      {
        pointer: `/copy/messages/en/${step?.id ?? ''}.missing.label`,
        code: 'copy_key_unknown',
        severity: 'error',
      },
      { pointer: '/copy/messages/en/step.c.colour', code: 'copy_key_unknown', severity: 'error' },
    ]);
  });

  it('refuses copy for a locale the version does not enable', () => {
    expect(codes(copyOf({ fr: { 'completion.title': 'Merci' } }))).toEqual([
      { pointer: '/copy/messages/fr', code: 'locale_unsupported', severity: 'error' },
    ]);
  });

  it('normalises every text to NFC', () => {
    expect(normaliseCopy(copyOf({ en: { 'completion.title': 'Café' } }))).toEqual(
      copyOf({ en: { 'completion.title': 'Café' } }),
    );
  });
});

describe('consent copy and legal texts (C162.2, C162.4)', () => {
  it('asks {days} in a biometric consent override', () => {
    expect(
      codes(
        copyOf({ en: { 'consent.biometric-matching': 'We compare your selfie with others.' } }),
      ),
    ).toEqual([
      {
        pointer: '/copy/messages/en/consent.biometric-matching',
        code: 'consent_copy_missing_placeholder',
        severity: 'error',
      },
    ]);
  });

  it('asks a custom consent text in every enabled locale', () => {
    expect(
      codes(
        copyOf({ en: { 'consent.processing': 'We process your photos for {organization}.' } }),
        {
          enabledLocales: ['en', 'fr'],
        },
      ),
    ).toEqual([
      {
        pointer: '/copy/messages/en/consent.processing',
        code: 'legal_copy_overridden',
        severity: 'warning',
      },
      {
        pointer: '/copy/messages/fr/consent.processing',
        code: 'consent_copy_incomplete',
        severity: 'error',
      },
    ]);
  });

  it('needs legal-copy:<key> for a legal text in production and warns in sandbox', () => {
    const copy = copyOf({ en: { 'notice.session-integrity': 'This page checks how it is used.' } });
    expect(copyRuleProblems(copy, context({ environmentKind: 'production' }))).toEqual({
      problems: [],
      acknowledgements: ['legal-copy:notice.session-integrity'],
    });
    expect(codes(copy)).toEqual([
      {
        pointer: '/copy/messages/en/notice.session-integrity',
        code: 'legal_copy_overridden',
        severity: 'warning',
      },
    ]);
  });
});
