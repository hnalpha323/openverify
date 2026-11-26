import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import TemplateLoading from './[id]/loading';
import TemplatesError from './error';
import TemplatesLayout from './layout';
import TemplatesLoading from './loading';

vi.mock('../actions/auth', () => ({ logout: vi.fn() }));
vi.mock('../actions/environment', () => ({ switchEnvironment: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('templates section', () => {
  it('is in the console layout', () => {
    expect(TemplatesLayout).toBe(ConsoleLayout);
  });

  it('announces its loading states', () => {
    render(<TemplatesLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading templates…');
  });

  it('announces that one template is loading', () => {
    render(<TemplateLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the template…');
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<TemplatesError error={new Error('ETIMEDOUT')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The templates could not be loaded.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
