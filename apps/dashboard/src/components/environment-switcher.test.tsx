import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../lib/action-state';
import { EnvironmentSwitcher } from './environment-switcher';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const SANDBOX = { id: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51', kind: 'sandbox' } as const;
const PRODUCTION = { id: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y52', kind: 'production' } as const;

describe('EnvironmentSwitcher', () => {
  it('offers to switch to each environment the operator may enter', () => {
    render(
      <EnvironmentSwitcher current={SANDBOX} targets={[PRODUCTION]} action={vi.fn<Action>()} />,
    );

    const form = screen.getByRole('form', { name: 'Environment' });
    expect(form).toHaveTextContent('Sandbox');
    expect(screen.getByRole('button', { name: 'Switch to production' })).toBeVisible();
  });

  it('sends the chosen environment to the switch action', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    render(<EnvironmentSwitcher current={SANDBOX} targets={[PRODUCTION]} action={action} />);

    await userEvent.click(screen.getByRole('button', { name: 'Switch to production' }));

    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0]?.[1].get('environment-id')).toBe(PRODUCTION.id);
  });

  it('shows why a switch failed', async () => {
    render(
      <EnvironmentSwitcher
        current={SANDBOX}
        targets={[PRODUCTION]}
        action={() => Promise.resolve({ ok: false, problem: { title: 'You do not have access' } })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Switch to production' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access');
  });

  it('only names the environment when there is nowhere to switch to', () => {
    render(<EnvironmentSwitcher current={PRODUCTION} targets={[]} action={vi.fn<Action>()} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Production')).toBeVisible();
  });
});
