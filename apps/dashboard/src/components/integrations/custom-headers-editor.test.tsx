import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CustomHeadersEditor } from './custom-headers-editor';

function submitted(): [string, string][] {
  const form = document.querySelector('form');
  if (form === null) {
    throw new Error('No form');
  }
  return [...new FormData(form).entries()].map(([name, value]) => [
    name,
    typeof value === 'string' ? value : value.name,
  ]);
}

describe('CustomHeadersEditor', () => {
  it('adds and removes header rows, each labelled by its number', async () => {
    render(
      <form>
        <CustomHeadersEditor />
      </form>,
    );
    expect(screen.getByRole('group', { name: 'Custom headers' })).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add a header' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a header' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Header 1 name' }), 'X-Team');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Header 1 value' }),
      'change-me-synthetic',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Header 2 name' }), 'X-Other');

    expect(screen.getByRole('textbox', { name: 'Header 2 name' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Remove header 2' }));

    expect(screen.queryByRole('textbox', { name: 'Header 2 name' })).not.toBeInTheDocument();
    expect(submitted()).toEqual([
      ['header-name', 'X-Team'],
      ['header-value', 'change-me-synthetic'],
    ]);
  });

  it('moves focus to the name of a row it adds', async () => {
    render(
      <form>
        <CustomHeadersEditor />
      </form>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add a header' }));

    expect(screen.getByRole('textbox', { name: 'Header 1 name' })).toHaveFocus();
  });

  it('moves focus to a control that remains when a row is removed (WCAG 2.4.3, Workflow 2E F012)', async () => {
    render(
      <form>
        <CustomHeadersEditor />
      </form>,
    );
    for (let index = 0; index < 3; index += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Add a header' }));
    }
    await userEvent.type(screen.getByRole('textbox', { name: 'Header 3 name' }), 'X-Third');

    // The row after it moves up and takes the focus.
    await userEvent.click(screen.getByRole('button', { name: 'Remove header 2' }));
    expect(screen.getByRole('textbox', { name: 'Header 2 name' })).toHaveValue('X-Third');
    expect(screen.getByRole('textbox', { name: 'Header 2 name' })).toHaveFocus();

    // The last row gives the focus to the one before it.
    await userEvent.click(screen.getByRole('button', { name: 'Remove header 2' }));
    expect(screen.getByRole('textbox', { name: 'Header 1 name' })).toHaveFocus();

    // The only row gives it to Add a header.
    await userEvent.click(screen.getByRole('button', { name: 'Remove header 1' }));
    expect(screen.getByRole('button', { name: 'Add a header' })).toHaveFocus();
  });

  it('stops at 10 headers', async () => {
    render(
      <form>
        <CustomHeadersEditor />
      </form>,
    );
    const add = screen.getByRole('button', { name: 'Add a header' });

    for (let index = 0; index < 10; index += 1) {
      await userEvent.click(add);
    }

    expect(add).toBeDisabled();
    expect(screen.getByText('A webhook takes at most 10 custom headers.')).toBeVisible();
  });

  it('keeps the stored headers unless the operator replaces them', async () => {
    render(
      <form>
        <CustomHeadersEditor existingNames={['Authorization', 'X-Team']} />
      </form>,
    );

    expect(
      screen.getByText('Authorization, X-Team. Their values are never shown again.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add a header' })).not.toBeInTheDocument();
    expect(submitted()).toEqual([]);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Replace the custom headers' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a header' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Header 1 name' }), 'X-New');

    expect(submitted()).toEqual([
      ['replace-custom-headers', 'true'],
      ['header-name', 'X-New'],
      ['header-value', ''],
    ]);
  });

  it('says when a webhook has no stored headers, and shows an error', () => {
    render(
      <form>
        <CustomHeadersEditor existingNames={[]} error="Give every header a name." />
      </form>,
    );

    expect(screen.getByText('None.')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Custom headers' })).toHaveAccessibleDescription(
      expect.stringContaining('Give every header a name.'),
    );
  });
});
