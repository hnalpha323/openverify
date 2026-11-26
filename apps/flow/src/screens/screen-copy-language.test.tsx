/**
 * WCAG 3.1.2 (Workflow 9D, a11y-audit): a screen's operator text in another language than the
 * page's (C162.5's fallback to the default locale, when a version enables a locale its operator
 * wrote no text for) says its language on the element that shows it, so a screen reader reads it
 * in that language. The audit found such texts unmarked inside `lang="es"`.
 */
import type { Component, ScreenClientView } from '@openverify/flow-spec';
import { screen as view } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils';
import { ScreenStep } from './screen-step';

const TEXTS: Readonly<Record<string, string>> = {
  'about.title.body': 'About you',
  'about.intro.body': 'A few details first.',
  'about.name.label': 'First name',
  'about.name.hint': 'As on your ID',
  'about.colour.label': 'Favourite colour',
  'about.red': 'Red',
  'about.agree.label': 'I confirm these details',
  'about.go.button': 'Continue',
};

const components: Component[] = [
  { id: 'title', kind: 'text', variant: 'title', copyKey: 'about.title.body' },
  { id: 'intro', kind: 'text', variant: 'body', copyKey: 'about.intro.body' },
  {
    id: 'name',
    kind: 'text_input',
    field: 'name_first',
    labelKey: 'about.name.label',
    hintKey: 'about.name.hint',
  },
  {
    id: 'colour',
    kind: 'select',
    field: 'colour',
    labelKey: 'about.colour.label',
    options: [{ key: 'red', value: 'r', labelKey: 'about.red' }],
  },
  { id: 'agree', kind: 'checkbox', field: 'agree', labelKey: 'about.agree.label' },
  { id: 'go', kind: 'button', labelKey: 'about.go.button', action: 'submit' },
];

const step: ScreenClientView = { id: 'about', type: 'screen', components };

function show(copyLanguage?: (key: string) => string | null) {
  renderWithI18n(
    <ScreenStep
      step={step}
      copy={(key) => TEXTS[key] ?? null}
      {...(copyLanguage === undefined ? {} : { copyLanguage })}
      onSubmit={vi.fn(() => Promise.resolve())}
    />,
  );
}

/** The nearest element at or above the one holding `text` that names a language. */
function languageOf(text: string): string | null {
  return view.getByText(text).closest('[lang]')?.getAttribute('lang') ?? null;
}

describe('a screen’s text in another language than the page (3.1.2)', () => {
  it('names the language on each element showing a fallback text', () => {
    show((key) => (key in TEXTS ? 'en' : null));

    for (const text of [
      'About you',
      'A few details first.',
      'First name',
      'As on your ID',
      'Favourite colour',
      'Red',
      'I confirm these details',
      'Continue',
    ]) {
      expect(languageOf(text), text).toBe('en');
    }
  });

  it('names none when every text is in the page’s language', () => {
    show(() => null);

    expect(view.getByText('About you')).not.toHaveAttribute('lang');
    expect(view.getByText('First name').closest('[lang]')?.tagName ?? 'none').not.toBe('LABEL');
  });
});
