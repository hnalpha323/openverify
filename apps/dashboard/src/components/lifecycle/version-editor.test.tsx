import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import {
  LIFECYCLE_IDS as IDS,
  RESOLVED_SETTINGS,
  VERSION_CONTENT,
} from '../../testing/lifecycle-fixtures';
import { VersionEditor } from './version-editor';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

function renderEditor(action: Action) {
  render(
    <ToastProvider>
      <VersionEditor
        templateId={IDS.template}
        versionId={IDS.draft}
        flow={VERSION_CONTENT.flow}
        verificationConfig={VERSION_CONTENT['verification-config']}
        settings={RESOLVED_SETTINGS}
        action={action}
      />
    </ToastProvider>,
  );
  return screen.getByRole('form', { name: 'Edit the draft' });
}

describe('VersionEditor', () => {
  it('saves the edited documents with the version', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    const form = renderEditor(action);

    fireEvent.change(within(form).getByRole('textbox', { name: 'Settings' }), {
      target: { value: '{ "inquiry-expiration-seconds": 3600 }' },
    });
    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }));

    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('inquiry-template-id')).toBe(IDS.template);
    expect(sent?.get('version-id')).toBe(IDS.draft);
    expect(sent?.get('settings')).toBe('{ "inquiry-expiration-seconds": 3600 }');
    const flow = sent?.get('flow');
    expect(JSON.parse(typeof flow === 'string' ? flow : '')).toEqual(VERSION_CONTENT.flow);
    expect(await screen.findByText('Saved the draft.')).toBeVisible();
  });

  it('shows each error in the document it is about, by path, and the rest below', async () => {
    const form = renderEditor(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [
            { pointer: '/data/attributes/flow/steps/1/type', detail: 'is not supported yet' },
            {
              pointer: '/data/attributes/verification-config/selfie/checks',
              detail: 'needs at least one enabled, required check',
            },
            { pointer: '/data/attributes/settings', detail: 'is not valid JSON' },
            { pointer: '/data/attributes', detail: 'nothing to update' },
          ],
        },
      }),
    );

    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }));

    expect(await within(form).findByRole('list', { name: 'Problems in Flow' })).toHaveTextContent(
      '/steps/1/type: is not supported yet',
    );
    expect(
      within(form).getByRole('list', { name: 'Problems in Verification config' }),
    ).toHaveTextContent('/selfie/checks: needs at least one enabled, required check');
    expect(within(form).getByRole('list', { name: 'Problems in Settings' })).toHaveTextContent(
      '/: is not valid JSON',
    );
    expect(within(form).getByRole('alert')).toHaveTextContent('nothing to update');
  });

  it('names the check and setting the API refused, under the verification config (C37)', async () => {
    const form = renderEditor(() =>
      Promise.resolve({
        ok: false,
        // The API's 400 for a body that fails validation, as the action passes it on.
        problem: {
          title: 'Bad Request',
          detail: 'The request body failed validation.',
          status: 400,
          errors: [
            {
              pointer:
                '/data/attributes/verification-config/government-id/checks/id_blur_detection/config/min-blur-score',
              detail: 'Too big: expected number to be <=1000',
            },
            {
              pointer: '/data/attributes/verification-config/government-id/allowed-countries/1',
              detail: 'must be an ISO 3166-1 alpha-2 code',
            },
          ],
        },
      }),
    );

    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }));

    const problems = await within(form).findByRole('list', {
      name: 'Problems in Verification config',
    });
    const [blur, country] = within(problems).getAllByRole('listitem');
    expect(blur).toHaveTextContent(
      'Government ID, check id_blur_detection, setting min-blur-score',
    );
    expect(blur).toHaveTextContent(
      '/government-id/checks/id_blur_detection/config/min-blur-score: Too big: expected number to be <=1000',
    );
    expect(country).toHaveTextContent('Government ID, allowed countries, entry 2');
    // The text area is described by the problems, words included (Workflow 2E F013).
    expect(
      within(form).getByRole('textbox', { name: 'Verification config' }),
    ).toHaveAccessibleDescription(
      expect.stringContaining('Government ID, check id_blur_detection, setting min-blur-score'),
    );
  });
});
