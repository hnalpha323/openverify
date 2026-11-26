import { createHash } from 'node:crypto';
import {
  COMPONENT_COPY_MAX_LENGTH,
  COPY_KEYS,
  LOCALE_REVIEW_STATUS,
  catalogSha256,
  localeKeyDigests,
  type LocaleReviewStatus,
} from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
// The French catalog as the flow exports it (jsdom gives no file URL to read it from).
import frCatalog from '../../../../../contracts/fixtures/i18n/fr.json';
import { copyKeyCatalog, editorRowsOf, localeReviewStatuses } from './copy-key-catalog';

const flow = {
  specVersion: 2,
  entry: 'welcome',
  steps: [
    {
      id: 'welcome',
      type: 'screen',
      name: 'Welcome',
      components: [
        { id: 'intro', kind: 'text' },
        {
          id: 'group',
          kind: 'container',
          children: [{ id: 'colour', kind: 'select', options: [{ key: 'o1' }, { key: 'o2' }] }],
        },
      ],
    },
    { id: 'id_check', type: 'government_id' },
  ],
};

describe('copyKeyCatalog (C162.2)', () => {
  it('lists every built-in key of COPY_KEYS with its rules', () => {
    const catalog = copyKeyCatalog(undefined);
    const builtIn = catalog.filter((entry) => entry.kind === 'built-in');

    expect(builtIn.map((entry) => entry.key)).toEqual(Object.keys(COPY_KEYS));
    const biometric = builtIn.find((entry) => entry.key === 'consent.biometric');
    expect(biometric).toMatchObject({
      maxLength: 2000,
      placeholders: ['days', 'organization'],
      consent: true,
      legal: 'consent',
      biometric: true,
      multiline: true,
    });
    expect(builtIn.find((entry) => entry.key === 'consent.continue')?.placeholders).toEqual([]);
  });

  it('adds each screen component’s attributes and options, nested ones included, with the step name', () => {
    const components = copyKeyCatalog(flow).filter((entry) => entry.kind === 'component');

    expect(components.map((entry) => entry.key)).toContain('welcome.intro.title');
    expect(components.map((entry) => entry.key)).toContain('welcome.colour.option.o2');
    const option = components.find((entry) => entry.key === 'welcome.colour.option.o1');
    expect(option).toMatchObject({
      step: 'welcome',
      stepName: 'Welcome',
      component: 'colour',
      attribute: 'option.o1',
      maxLength: COMPONENT_COPY_MAX_LENGTH,
      placeholders: ['organization'],
      multiline: false,
      legal: null,
    });
    expect(components.some((entry) => entry.step === 'id_check')).toBe(false);
  });

  it('reads no component key from a flow it cannot walk', () => {
    expect(copyKeyCatalog({ steps: 'nope' }).every((entry) => entry.kind === 'built-in')).toBe(
      true,
    );
  });
});

describe('editorRowsOf (C162.7)', () => {
  it('keys the API rows as the copy keys they name', () => {
    expect(
      editorRowsOf([
        {
          step: null,
          'step-display-name': null,
          component: null,
          'attribute-name': 'consent.title',
          'locale-values': [{ locale: 'en', value: 'Synthetic' }],
        },
        {
          step: 'welcome',
          'step-display-name': 'Welcome',
          component: 'colour',
          'attribute-name': 'option.o1',
          'locale-values': [{ locale: 'ar', value: 'أحمر' }],
        },
      ]),
    ).toEqual({
      'consent.title': { en: 'Synthetic' },
      'welcome.colour.option.o1': { ar: 'أحمر' },
    });
  });
});

describe('localeReviewStatuses (C161.5)', () => {
  it('passes the recorded review status of each built-in locale on as plain data', () => {
    expect(localeReviewStatuses()).toEqual(LOCALE_REVIEW_STATUS);
  });

  it('shows a reviewed locale whose exported catalog changed one message as partially reviewed (R004)', () => {
    const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
    const digests = localeKeyDigests(frCatalog.messages, sha256);
    const [key = ''] = Object.keys(digests);
    const snapshot = { ...digests, [key]: sha256('the message as it was reviewed') };
    // Synthetic: no built-in locale has a recorded review.
    const reviewed: LocaleReviewStatus = {
      status: 'reviewed',
      by: 'A. Synthetic Reviewer',
      date: '2026-11-01',
      catalogSha256: catalogSha256(snapshot, sha256),
      keySha256: snapshot,
    };

    const statuses = localeReviewStatuses({ ...LOCALE_REVIEW_STATUS, fr: reviewed });

    expect(statuses.fr).toMatchObject({ status: 'partially-reviewed', unreviewedKeys: [key] });
    expect(statuses.es).toEqual(LOCALE_REVIEW_STATUS.es);
  });
});
