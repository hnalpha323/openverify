import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CopyTemplateButton, PromoteTemplateButton } from './template-operations';

const TEMPLATE = 'itmpl_01JB0000000000000000000001';
const COPY = 'itmpl_01JB0000000000000000000005';
const VERSION = 'itmplv_01JB0000000000000000000001';
const SANDBOX = { id: 'env_01JB0000000000000000000001', kind: 'sandbox' as const };
const PRODUCTION = { id: 'env_01JB0000000000000000000009', kind: 'production' as const };

describe('copy a template from its page (C155.7)', () => {
  it('names the copy, says what it makes, and links the new template', async () => {
    const user = userEvent.setup();
    const action = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { id: COPY, name: 'Synthetic (copy)' } }),
    );
    render(
      <CopyTemplateButton
        templateId={TEMPLATE}
        templateName="Synthetic"
        versionId={VERSION}
        action={action}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Copy template…' }));
    const dialog = screen.getByRole('dialog', { name: 'Copy this template' });
    expect(dialog).toHaveAccessibleDescription(/new template whose draft copies this version/);
    const name = within(dialog).getByRole('textbox', { name: 'Name of the copy' });
    expect(name).toHaveFocus();
    expect(name).toHaveValue('Synthetic (copy)');
    await user.click(within(dialog).getByRole('button', { name: 'Copy template' }));

    expect(action).toHaveBeenCalledWith({
      templateId: TEMPLATE,
      name: 'Synthetic (copy)',
      versionId: VERSION,
    });
    expect(await screen.findByRole('link', { name: 'Open Synthetic (copy)' })).toHaveAttribute(
      'href',
      `/templates/${COPY}`,
    );
  });

  it('says a refusal in words and gives focus back on cancel', async () => {
    const user = userEvent.setup();
    const action = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        problem: { title: 'You do not have access', status: 403 },
      }),
    );
    render(<CopyTemplateButton templateId={TEMPLATE} templateName="Synthetic" action={action} />);
    const opener = screen.getByRole('button', { name: 'Copy template…' });

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Copy template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /not copied: You do not have access/,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(opener).toHaveFocus();
  });
});

describe('promote a template version from its page (C155.7, C154.5)', () => {
  const show = (
    action: Parameters<typeof PromoteTemplateButton>[0]['action'],
    environments = [SANDBOX, PRODUCTION],
  ) =>
    render(
      <PromoteTemplateButton
        templateId={TEMPLATE}
        versionId={VERSION}
        versionNumber={1}
        current={SANDBOX}
        environments={environments}
        action={action}
      />,
    );

  it('names the target, the rights the API checks there and what is not copied, then promotes', async () => {
    const user = userEvent.setup();
    const action = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { versionId: VERSION, versionNumber: 4, copiedThemeSets: 1 },
      }),
    );
    show(action);

    await user.click(screen.getByRole('button', { name: 'Promote…' }));
    const dialog = screen.getByRole('dialog', { name: 'Promote version 1 to another environment' });
    const promote = within(dialog).getByRole('button', { name: 'Promote version 1' });
    expect(promote).toBeDisabled();
    expect(within(dialog).queryByRole('radio', { name: /Sandbox/ })).toBeNull();
    expect(dialog).toHaveTextContent(/inquiry-templates:write in both environments/);
    expect(dialog).toHaveTextContent(/environments:production/);
    const notCopied = within(dialog).getByRole('list', { name: 'What a promote does not copy' });
    expect(notCopied).toHaveTextContent(/inquiries/i);
    expect(notCopied).toHaveTextContent(/never replaces/i);
    await user.click(within(dialog).getByRole('radio', { name: `Production (${PRODUCTION.id})` }));
    await user.click(promote);

    expect(action).toHaveBeenCalledWith({
      templateId: TEMPLATE,
      environmentId: PRODUCTION.id,
      versionId: VERSION,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Version 4 is a draft in Production .*1 theme set was copied/,
    );
  });

  it.each([
    [{ title: 'Conflict', status: 409, code: 'draft_exists' }, /already has a draft/],
    [{ title: 'Forbidden', status: 403 }, /rights in both environments/],
    [
      {
        title: 'Unprocessable',
        status: 422,
        errors: [{ pointer: '/list-config/screen/0', detail: 'No list of this kind and name.' }],
      },
      /No list of this kind and name/,
    ],
  ])('says the refusal %# in words', async (problem, words) => {
    const user = userEvent.setup();
    show(vi.fn(() => Promise.resolve({ ok: false as const, problem })));

    await user.click(screen.getByRole('button', { name: 'Promote…' }));
    await user.click(screen.getByRole('radio', { name: `Production (${PRODUCTION.id})` }));
    await user.click(screen.getByRole('button', { name: 'Promote version 1' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('says when there is no other environment to promote to', async () => {
    const user = userEvent.setup();
    show(vi.fn(), [SANDBOX]);

    await user.click(screen.getByRole('button', { name: 'Promote…' }));

    expect(screen.getByRole('dialog')).toHaveTextContent(/no other environment/i);
    expect(screen.getByRole('button', { name: 'Promote version 1' })).toBeDisabled();
  });
});
