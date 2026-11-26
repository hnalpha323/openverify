import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from './copy-button';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CopyButton', () => {
  it('copies the value to the clipboard and says so', async () => {
    const user = userEvent.setup();
    render(<CopyButton value="ov_sbx_synthetic" label="Copy the token" />);

    await user.click(screen.getByRole('button', { name: 'Copy the token' }));

    await expect(navigator.clipboard.readText()).resolves.toBe('ov_sbx_synthetic');
    expect(screen.getByRole('status')).toHaveTextContent('Copied to the clipboard.');
  });

  it('says how to copy by hand when the clipboard refuses', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    render(<CopyButton value="secret" />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Copying failed. Select the text and copy it.',
    );
  });
});
