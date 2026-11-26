import type { VerificationConfig } from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { LIFECYCLE_IDS as IDS } from '../../testing/lifecycle-fixtures';
import { CHECK_READING_FLOW } from '../../testing/routes/template-forms';
import { ToastProvider } from '../toasts';
import { VerificationConfigForm } from './verification-config-form';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const COPY = TEMPLATE_FORMS_COPY;
const ETAG = `"${'3'.repeat(64)}"`;
const CONFIG: VerificationConfig = {
  'government-id': defaultTemplateConfig('government_id'),
  selfie: defaultTemplateConfig('selfie'),
};

function renderForm(action: Action, readOnly = false) {
  render(
    <ToastProvider>
      <VerificationConfigForm
        config={CONFIG}
        flow={CHECK_READING_FLOW}
        ids={{ templateId: IDS.template, versionId: IDS.draft, etag: ETAG }}
        action={action}
        readOnly={readOnly}
      />
    </ToastProvider>,
  );
}

const valueOf = (data: FormData | undefined): unknown => {
  const value = data?.get('value');
  return typeof value === 'string' ? JSON.parse(value) : undefined;
};

describe('VerificationConfigForm (C153.1 on the settings tab)', () => {
  it('shows the check panels of every type the draft configures, and saves the whole config', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    renderForm(action);

    const form = screen.getByRole('form', { name: COPY.verificationConfig.legend });
    expect(
      within(form).getByRole('heading', { name: COPY.checkPanels.typeHeading('government-id') }),
    ).toBeVisible();
    expect(
      within(form).getByRole('heading', { name: COPY.checkPanels.typeHeading('selfie') }),
    ).toBeVisible();
    const glare = within(form).getByRole('region', { name: 'id_glare_detection' });
    const run = within(glare).getByRole('checkbox', {
      name: COPY.checkPanels.enabled('id_glare_detection'),
    });
    const before = (run as HTMLInputElement).checked;
    await userEvent.click(run);
    await userEvent.click(within(form).getByRole('button', { name: COPY.verificationConfig.save }));

    const data = action.mock.calls[0]?.[1];
    expect(data?.get('member')).toBe('verification-config');
    expect(data?.get('etag')).toBe(ETAG);
    expect(valueOf(data)).toMatchObject({
      'government-id': { checks: { id_glare_detection: { enabled: !before } } },
    });
    expect(
      await screen.findByText(COPY.memberForm.saved(COPY.verificationConfig.legend)),
    ).toBeVisible();
  });

  it('announces each change politely', async () => {
    renderForm(vi.fn<Action>());

    const glare = screen.getByRole('region', { name: 'id_glare_detection' });
    await userEvent.click(
      within(glare).getByRole('checkbox', { name: COPY.checkPanels.enabled('id_glare_detection') }),
    );

    expect(screen.getByRole('status')).toHaveTextContent(/id_glare_detection/);
  });

  it('sends nothing while the contract refuses the config, and says so', async () => {
    const action = vi.fn<Action>();
    render(
      <ToastProvider>
        <VerificationConfigForm
          config={{
            selfie: { checks: { selfie_liveness_detection: { enabled: true, required: true } } },
          }}
          flow={CHECK_READING_FLOW}
          ids={{ templateId: IDS.template, versionId: IDS.draft, etag: ETAG }}
          action={action}
        />
      </ToastProvider>,
    );

    await userEvent.click(
      screen.getByRole('checkbox', {
        name: COPY.checkPanels.required('selfie_liveness_detection'),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: COPY.verificationConfig.save }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(COPY.memberForm.refusedBeforeSending);
  });

  it('shows the checks read-only, with nothing to save', () => {
    renderForm(vi.fn<Action>(), true);

    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('region', { name: 'id_glare_detection' })).toBeVisible();
  });
});
