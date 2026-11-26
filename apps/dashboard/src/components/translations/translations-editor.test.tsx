import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../lib/action-state';
import { THEME_IDS } from '../../testing/routes/themes-copy';
import {
  TranslationsEditor,
  type EditorKey,
  type TranslationsImportResult,
} from './translations-editor';

const KEYS: EditorKey[] = [
  {
    key: 'consent.title',
    kind: 'built-in',
    step: null,
    stepName: null,
    component: null,
    attribute: 'consent.title',
    maxLength: 120,
    placeholders: ['organization'],
    multiline: false,
    consent: false,
    legal: null,
    biometric: false,
  },
  {
    key: 'welcome.name.label',
    kind: 'component',
    step: 'welcome',
    stepName: 'Welcome',
    component: 'name',
    attribute: 'label',
    maxLength: 255,
    placeholders: ['organization'],
    multiline: false,
    consent: false,
    legal: null,
    biometric: false,
  },
];

const editor = (action?: () => Promise<ActionResult<TranslationsImportResult>>) =>
  render(
    <TranslationsEditor
      templateId={THEME_IDS.template}
      keys={KEYS}
      values={{ 'consent.title': { en: 'Synthetic title' } }}
      enabledLocales={['en', 'ar']}
      {...(action === undefined ? {} : { action })}
    />,
  );

describe('TranslationsEditor (C162)', () => {
  it('sends only the changed cells, as rows keyed by step, component and attribute', async () => {
    const action = vi
      .fn<() => Promise<ActionResult<TranslationsImportResult>>>()
      .mockResolvedValue({ ok: true, data: { kind: 'saved', count: 2 } });
    editor(action);

    fireEvent.change(screen.getByRole('textbox', { name: 'consent.title, ar' }), {
      target: { value: 'عنوان' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Text to add' }), {
      target: { value: 'welcome.name.label' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'welcome.name.label, en' }), {
      target: { value: 'Your name' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save texts' }));

    await waitFor(() => {
      expect(screen.getByText('2 texts were saved to the draft.')).toBeVisible();
    });
    const sent = action.mock.calls[0] as unknown as [unknown, FormData];
    expect(JSON.parse(sent[1].get('rows') as string)).toEqual([
      {
        step: null,
        'step-display-name': null,
        component: null,
        'attribute-name': 'consent.title',
        'locale-values': [{ locale: 'ar', value: 'عنوان' }],
      },
      {
        step: 'welcome',
        'step-display-name': null,
        component: 'name',
        'attribute-name': 'label',
        'locale-values': [{ locale: 'en', value: 'Your name' }],
      },
    ]);
  });

  it('says a refused cell in words at the cell, never echoing its text', async () => {
    const action = vi
      .fn<() => Promise<ActionResult<TranslationsImportResult>>>()
      .mockResolvedValue({
        ok: true,
        data: {
          kind: 'refused',
          refusals: [
            {
              pointer: '/data/attributes/translations/0/locale-values/0/value',
              code: 'copy_bidi_override',
            },
          ],
        },
      });
    editor(action);

    fireEvent.change(screen.getByRole('textbox', { name: 'consent.title, ar' }), {
      target: { value: 'synthetic\u202etext' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save texts' }));

    const cell = screen.getByRole('textbox', { name: 'consent.title, ar' });
    await waitFor(() => {
      expect(cell).toHaveAttribute('aria-invalid', 'true');
    });
    expect(cell).toHaveAccessibleDescription(/bidirectional embedding or override/);
    const alert = screen.getByText('Nothing was saved: some texts break a rule').closest('div');
    expect(alert?.textContent).not.toContain('synthetic');
  });

  it('says when nothing changed, and is read-only without an action', () => {
    const action = vi.fn();
    editor(action);
    fireEvent.click(screen.getByRole('button', { name: 'Save texts' }));
    expect(screen.getByText('Change at least one text before saving.')).toBeVisible();
    expect(action).not.toHaveBeenCalled();
  });

  it('shows each text’s rules and offers no save to a reader', () => {
    editor();

    const row = screen.getByRole('rowheader', { name: /consent\.title/ });
    expect(within(row).getByText('At most 120 characters')).toBeVisible();
    expect(within(row).getByText('One line')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save texts' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'consent.title, en' })).toHaveAttribute('readonly');
  });
});
