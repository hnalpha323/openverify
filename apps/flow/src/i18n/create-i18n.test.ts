import {
  PHASE1_CHECK_REASONS,
  defaultInquiryTemplateAttributes,
  type Phase1CheckId,
} from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { CAMERA_ERROR_CODES } from '../lib/camera-permission';
import { IMAGE_FILE_ERRORS } from '../lib/image-file';
import { CATALOGS } from './catalogs';
import { createI18n } from './create-i18n';
import { SUPPORTED_LANGUAGES } from './languages';
import { translateKey } from './translate-key';
import { en } from './locales/en';
import { es } from './locales/es';

interface Tree {
  readonly [key: string]: string | Tree;
}

function leaves(tree: Tree, prefix = ''): [key: string, message: string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
  );
}

function leafKeys(tree: Tree): string[] {
  return leaves(tree)
    .map(([key]) => key)
    .sort();
}

describe('createI18n', () => {
  it('is ready synchronously, in English by default', () => {
    const i18n = createI18n();

    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe('en');
    expect(i18n.t('consent.continue')).toBe('Continue');
  });

  it('translates to Spanish', () => {
    const i18n = createI18n('es');

    expect(i18n.t('consent.continue')).toBe('Continuar');
  });

  it('creates independent instances', async () => {
    const first = createI18n('en');
    const second = createI18n('en');

    await second.changeLanguage('es');

    expect(first.language).toBe('en');
    expect(second.language).toBe('es');
  });
});

describe('createI18n in the five built-in languages (C161.1)', () => {
  it.each([
    ['fr', 'Continuer'],
    ['de', 'Weiter'],
    ['ar', 'متابعة'],
  ] as const)('translates to %s', (language, word) => {
    expect(createI18n(language).t('consent.continue')).toBe(word);
  });

  it('serves each catalog as built', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(createI18n(language).getResourceBundle(language, 'translation')).toBe(
        CATALOGS[language],
      );
    }
  });
});

describe('locales', () => {
  it('translate exactly the same keys in Spanish as in English', () => {
    expect(leafKeys(es)).toEqual(leafKeys(en));
  });

  it.each(SUPPORTED_LANGUAGES)('has no empty %s messages', (language) => {
    const empty = leaves(CATALOGS[language]).filter(([, message]) => message.trim() === '');

    expect(empty).toEqual([]);
  });

  it('has a message for every camera error code', () => {
    expect(Object.keys(en.camera.errors).sort()).toEqual([...CAMERA_ERROR_CODES].sort());
  });
});

describe('messages the server refers to', () => {
  const { flow } = defaultInquiryTemplateAttributes();
  const serverKeys = flow.steps.flatMap((step) => {
    if (step.type === 'consent') {
      return step.textKeys;
    }
    return 'messageKey' in step && step.messageKey !== undefined ? [step.messageKey] : [];
  });

  it('covers the default template’s consent texts and messages', () => {
    expect(serverKeys).toEqual([
      'consent.biometric',
      'consent.processing',
      // C94.6: the session-integrity notice of the default template (flow version 3).
      'notice.session-integrity',
      'flow.completion',
      'flow.failure',
    ]);
  });

  it.each(SUPPORTED_LANGUAGES)('has every default template message in %s', (language) => {
    const i18n = createI18n(language);
    const resources = CATALOGS[language];

    for (const key of serverKeys) {
      expect(translateKey(i18n, key)).toBe(
        key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], resources),
      );
    }
  });

  it('has a retry message for every user-fixable reason the Phase 1 checks report', () => {
    const userFixable = Object.entries(PHASE1_CHECK_REASONS)
      .filter(
        ([check]) => getCheckDefinition(check as Phase1CheckId)?.checkType === 'user_behavior',
      )
      .flatMap(([, reasons]) => reasons);

    expect(userFixable.length).toBeGreaterThan(0);
    for (const reason of userFixable) {
      expect(Object.keys(en.retry.reasons)).toContain(reason);
    }
  });

  it('has a message for every image file error', () => {
    expect(Object.keys(en.capture.fileErrors).sort()).toEqual([...IMAGE_FILE_ERRORS].sort());
  });

  it('names every step type the web flow cannot run yet', () => {
    expect(Object.keys(en.unsupported.steps).sort()).toEqual(
      [
        'database',
        'document',
        'email_otp',
        'form',
        'nfc',
        'phone_otp',
        // C50.3: the Phase 5 steps, until their screens land.
        'aamva',
        'crypto_wallet',
        'database_business',
        'business_website',
      ].sort(),
    );
  });
});
