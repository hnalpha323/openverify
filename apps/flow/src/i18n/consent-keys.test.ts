/**
 * C45.1, C42.3: the flow has its own text, in every language, for each consent key the default
 * template shows, the optional matching consent included; that text names the retention days.
 */
import { describe, expect, it } from 'vitest';
import fixture from '../../../../contracts/fixtures/flows/default-gov-id-selfie.json';
import { SUPPORTED_LANGUAGES } from './languages';
import { CATALOGS } from './catalogs';
import type { Messages } from './locales/en';

const MESSAGES: Readonly<Record<(typeof SUPPORTED_LANGUAGES)[number], Messages>> = CATALOGS;

const consent = fixture.flow.steps.find((step) => step.type === 'consent') as unknown as {
  textKeys: string[];
  optionalTextKeys?: string[];
};

function textOf(messages: Messages, key: string): string | undefined {
  const [group, name] = key.split('.');
  const section = (messages as unknown as Record<string, Record<string, string | undefined>>)[
    group ?? ''
  ];
  return section?.[name ?? ''];
}

describe.each(SUPPORTED_LANGUAGES)('consent texts in %s', (language) => {
  const messages = MESSAGES[language];

  it('has a text for every required and optional consent key of the default template', () => {
    expect(consent.optionalTextKeys).toEqual(['consent.biometric-matching']);
    for (const key of [...consent.textKeys, ...(consent.optionalTextKeys ?? [])]) {
      expect(textOf(messages, key), key).toEqual(expect.any(String));
    }
  });

  it('has the texts of the collection tiers: the two notices and the recognition consent (C94.6, ADR 0006)', () => {
    expect(consent.textKeys).toContain('notice.session-integrity');
    for (const key of [
      'notice.session-integrity',
      'notice.device-recognition',
      'consent.device-recognition',
    ]) {
      expect(textOf(messages, key), key).toEqual(expect.any(String));
    }
  });

  it('has the automated-decision consent, which says that automated decisions are made (C128.4)', () => {
    expect(textOf(messages, 'consent.automated-decision')).toEqual(expect.any(String));
    // "automated" in each language; Arabic says it with آلي.
    expect(textOf(messages, 'consent.automated-decision')).toMatch(/autom|آلي/i);
  });

  it('says how long the face templates are kept, from the session ({{days}})', () => {
    expect(textOf(messages, 'consent.biometric-matching')).toContain('{{days}}');
  });
});
