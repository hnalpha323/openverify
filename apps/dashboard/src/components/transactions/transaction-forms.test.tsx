import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../lib/action-state';
import { RELATION_SCHEMAS, TRANSACTION_IDS } from '../../testing/transactions-fixtures';
import { ToastProvider } from '../toasts';
import { AttachObjectsForm, RelationForm } from './transaction-forms';
import { describeTransactionProblem } from './transaction-words';

const ID = TRANSACTION_IDS.transaction;

/** An action refused as the API refuses it, passed through the words the server action uses. */
const refused = (code: string, pointer: string, detail: string) =>
  vi.fn((): Promise<ActionResult> =>
    Promise.resolve({
      ok: false,
      problem: describeTransactionProblem({
        title: 'Unprocessable Entity',
        detail: 'Refused.',
        status: 422,
        code,
        errors: [{ pointer, detail }],
      }),
    }),
  );

describe('the transaction forms word the two limits at their pointers (K7B-6-console, C108)', () => {
  it('says to remove the current target, at the relation field', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <RelationForm
          transactionId={ID}
          relations={RELATION_SCHEMAS}
          add={refused(
            'relation_cardinality_exceeded',
            '/meta/relation-schema-key',
            'Holds one target.',
          )}
          remove={vi.fn()}
        />
      </ToastProvider>,
    );

    await user.type(screen.getByRole('textbox', { name: /Target ID/u }), TRANSACTION_IDS.account);
    await user.click(screen.getByRole('button', { name: 'Set relation' }));

    const relation = await screen.findByRole('combobox', { name: 'Relation' });
    await vi.waitFor(() => {
      expect(relation).toHaveAttribute('aria-invalid', 'true');
    });
    expect(relation).toHaveAccessibleDescription('Remove the current target first.');
    expect(screen.queryByText('Holds one target.')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This relation already has its one target.',
    );
  });

  it('says the limit of related objects, at the object IDs', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <AttachObjectsForm
          transactionId={ID}
          action={refused('related_objects_limit', '/meta/object-ids', 'Past the limit.')}
        />
      </ToastProvider>,
    );

    await user.type(screen.getByRole('textbox', { name: /Object IDs/u }), TRANSACTION_IDS.inquiry);
    await user.click(screen.getByRole('button', { name: 'Attach' }));

    const objects = screen.getByRole('textbox', { name: /Object IDs/u });
    await vi.waitFor(() => {
      expect(objects).toHaveAttribute('aria-invalid', 'true');
    });
    expect(objects).toHaveAccessibleDescription(
      expect.stringContaining('At most 100 related objects: detach one first.'),
    );
    expect(screen.queryByText('Past the limit.')).toBeNull();
  });
});

describe('the relation form names each relation in words (K7C-2; K9-1)', () => {
  it('reads a relation by its key, its target kind in words and how many targets it takes', () => {
    render(
      <ToastProvider>
        <RelationForm
          transactionId={ID}
          relations={[
            { key: 'payer', target: 'account', cardinality: 'one' },
            { key: 'refunds', target: 'transaction', cardinality: 'many' },
          ]}
          add={vi.fn()}
          remove={vi.fn()}
        />
      </ToastProvider>,
    );

    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'payer (Account, one target)',
      'refunds (Transaction, many targets)',
    ]);
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['payer', 'refunds']);
  });
});
