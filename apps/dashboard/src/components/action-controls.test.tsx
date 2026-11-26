import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useActionState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../lib/action-state';
import { ActionFeedback } from './action-feedback';
import { SubmitButton } from './submit-button';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

function Form({ action, success }: { action: Action; success?: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      <ActionFeedback
        state={state}
        {...(success === undefined ? {} : { successMessage: success })}
      />
    </form>
  );
}

describe('SubmitButton', () => {
  it('submits, then shows progress and blocks a second submit until the action answers', async () => {
    let finish: (result: ActionResult) => void = () => undefined;
    const action = vi.fn<Action>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<Form action={action} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    finish({ ok: true, data: undefined });
    expect(await screen.findByRole('button', { name: 'Save' })).toBeEnabled();
    expect(action).toHaveBeenCalledOnce();
  });
});

describe('ActionFeedback', () => {
  it('renders nothing before the first submit', () => {
    const { container } = render(<ActionFeedback state={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the problem of a failed action', async () => {
    render(
      <Form
        action={() =>
          Promise.resolve({ ok: false, problem: { title: 'Invalid Transition', detail: 'No.' } })
        }
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid Transition');
  });

  it('announces success when given a message', async () => {
    render(<Form action={() => Promise.resolve({ ok: true, data: undefined })} success="Saved." />);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
  });

  it('stays quiet on success without a message', async () => {
    render(<Form action={() => Promise.resolve({ ok: true, data: undefined })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
