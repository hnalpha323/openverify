import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './dialog';
import { ToastProvider, useToast } from './toasts';

function Harness({ dismissible }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      <button type="button">Outside</button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Rename the key"
        description="Names help you tell keys apart."
        {...(dismissible === undefined ? {} : { dismissible })}
      >
        <label>
          Name <input />
        </label>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
        >
          Done
        </button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a modal dialog named by its title and described by its description', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    const dialog = screen.getByRole('dialog', { name: 'Rename the key' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Names help you tell keys apart.');
  });

  it('moves focus into the dialog when it opens', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
  });

  it('closes on Escape and gives focus back to what opened it', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('gives focus back when closed from inside', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(opener).toHaveFocus();
  });

  it('ignores Escape when it may not be dismissed, for example while an action runs', async () => {
    render(<Harness dismissible={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('makes the page behind it inert while open', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('button', { name: 'Outside' }).closest('[inert]')).not.toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Outside' }).closest('[inert]')).toBeNull();
  });

  it('focuses the dialog itself when it has nothing focusable', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Done">
        <p>Nothing to do here.</p>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Done' })).toHaveFocus();
  });
});

/** A page whose dialog's action then removes or disables the button that opened it. */
function ReplacingHarness({ after }: { after: 'removed' | 'disabled-then-enabled' }) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<'shown' | 'gone' | 'disabled'>('shown');
  return (
    <div id="content" tabIndex={-1}>
      <h1>Inquiry</h1>
      {opener !== 'gone' && (
        <button
          type="button"
          disabled={opener === 'disabled'}
          onClick={() => {
            setOpen(true);
          }}
        >
          Approve
        </button>
      )}
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Approve the inquiry?"
      >
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            if (after === 'removed') {
              // The revalidated page arrives later and has no Approve button any more.
              setTimeout(() => {
                setOpener('gone');
              }, 20);
            } else {
              // The action runs: the opener is disabled while pending, then enabled again.
              setOpener('disabled');
              setTimeout(() => {
                setOpener('shown');
              }, 20);
            }
          }}
        >
          Approve inquiry
        </button>
      </Dialog>
    </div>
  );
}

describe('Dialog focus after its action changed the page (Workflow 2D F007)', () => {
  it('moves focus to the page content, not <body>, when the opener is removed afterwards', async () => {
    render(<ReplacingHarness after="removed" />);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve inquiry' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(document.getElementById('content'));
    });
  });

  it('gives focus back to the opener once it is enabled again', async () => {
    render(<ReplacingHarness after="disabled-then-enabled" />);
    const opener = screen.getByRole('button', { name: 'Approve' });

    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Approve inquiry' }));

    await waitFor(() => {
      expect(opener).toBeEnabled();
    });
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });
});

describe('Dialog and the notifications live region (Workflow 2D F008)', () => {
  function ToastingHarness() {
    const [open, setOpen] = useState(false);
    const { show } = useToast();
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Approve
        </button>
        <Dialog
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title="Approve the inquiry?"
        >
          <button
            type="button"
            onClick={() => {
              // As ConfirmActionButton does: the dialog closes and the toast shows in one update.
              setOpen(false);
              show({ tone: 'success', message: 'The inquiry was approved.' });
            }}
          >
            Approve inquiry
          </button>
        </Dialog>
      </>
    );
  }

  it('leaves the notifications region out of the inert page, so a toast shown on closing is announced', async () => {
    render(
      <ToastProvider>
        <ToastingHarness />
      </ToastProvider>,
    );
    const region = screen.getByRole('region', { name: 'Notifications' });

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(
      screen.getByRole('button', { name: 'Approve', hidden: true }).closest('[inert]'),
    ).not.toBeNull();
    expect(region.closest('[inert]')).toBeNull();
    const inertWhenInserted: boolean[] = [];
    const observer = new MutationObserver(() => {
      inertWhenInserted.push(region.closest('[inert]') !== null);
    });
    observer.observe(region, { childList: true });

    await userEvent.click(screen.getByRole('button', { name: 'Approve inquiry' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The inquiry was approved.');
    observer.disconnect();
    expect(inertWhenInserted).toEqual([false]);
  });
});
