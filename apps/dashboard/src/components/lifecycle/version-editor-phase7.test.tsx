import type { ResolvedListConfig, ResolvedSignalConfig } from '@openverify/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import {
  LIFECYCLE_IDS as IDS,
  RESOLVED_SETTINGS,
  VERSION_CONTENT,
} from '../../testing/lifecycle-fixtures';
import { SIGNAL_IDS } from '../../testing/signals-fixtures';
import { ToastProvider } from '../toasts';
import { VersionEditor } from './version-editor';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const SIGNAL_CONFIG: ResolvedSignalConfig = {
  collect: 'default',
  'on-signal': 'needs_review',
  'review-rules': [{ signal: 'inquiry/bot_score', gte: 70 }],
};
const LIST_CONFIG: ResolvedListConfig = {
  screen: [SIGNAL_IDS.list],
  'on-list-match': 'needs_review',
};

function renderEditor(action: Action) {
  render(
    <ToastProvider>
      <VersionEditor
        templateId={IDS.template}
        versionId={IDS.draft}
        flow={VERSION_CONTENT.flow}
        verificationConfig={VERSION_CONTENT['verification-config']}
        settings={RESOLVED_SETTINGS}
        signalConfig={SIGNAL_CONFIG}
        listConfig={LIST_CONFIG}
        action={action}
      />
    </ToastProvider>,
  );
  return screen.getByRole('form', { name: 'Edit the draft' });
}

const json = (element: HTMLTextAreaElement): unknown => JSON.parse(element.value);

describe('VersionEditor: signal-config and list-config (C90.6, C99.5, C108)', () => {
  it('edits both as JSON documents, beside the others', () => {
    const form = renderEditor(vi.fn<Action>());

    expect(
      json(within(form).getByRole<HTMLTextAreaElement>('textbox', { name: 'Signal config' })),
    ).toEqual(SIGNAL_CONFIG);
    expect(
      json(within(form).getByRole<HTMLTextAreaElement>('textbox', { name: 'List config' })),
    ).toEqual(LIST_CONFIG);
  });

  it('saves both with the draft', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    const form = renderEditor(action);

    fireEvent.change(within(form).getByRole('textbox', { name: 'List config' }), {
      target: { value: '{ "screen": "none" }' },
    });
    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }));

    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('list-config')).toBe('{ "screen": "none" }');
    const signal = sent?.get('signal-config');
    expect(JSON.parse(typeof signal === 'string' ? signal : '')).toEqual(SIGNAL_CONFIG);
  });

  it('shows an error in the document it is about, by its path inside it', async () => {
    const form = renderEditor(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [
            { pointer: '/data/attributes/signal-config/collect/0', detail: 'not a signal' },
            { pointer: '/data/attributes/list-config/screen/0', detail: 'not a list' },
          ],
        },
      }),
    );

    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }));

    const signal = within(form).getByRole('textbox', { name: 'Signal config' });
    await waitFor(() => {
      expect(signal).toHaveAttribute('aria-invalid', 'true');
    });
    expect(signal).toHaveAccessibleDescription(/\/collect\/0.*not a signal/);
    expect(within(form).getByRole('textbox', { name: 'List config' })).toHaveAccessibleDescription(
      /\/screen\/0/,
    );
  });

  it('shows the defaults for a version a server served without them', () => {
    render(
      <ToastProvider>
        <VersionEditor
          templateId={IDS.template}
          versionId={IDS.draft}
          flow={VERSION_CONTENT.flow}
          verificationConfig={VERSION_CONTENT['verification-config']}
          settings={RESOLVED_SETTINGS}
          action={vi.fn<Action>()}
        />
      </ToastProvider>,
    );

    expect(
      json(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Signal config' })),
    ).toEqual({});
  });
});
