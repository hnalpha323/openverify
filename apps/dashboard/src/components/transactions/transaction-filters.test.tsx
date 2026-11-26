import type { TransactionTypeResource } from '@openverify/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { transactionType } from '../../testing/transactions-fixtures';
import { TransactionFilters } from './transaction-filters';
import { parseTransactionQuery } from './transaction-query';

const TYPE = 'txntp_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';

function typeWithFields(): TransactionTypeResource {
  const base = transactionType({ id: TYPE });
  return {
    ...base,
    attributes: {
      ...base.attributes,
      'field-schemas': [
        {
          type: 'choices',
          key: 'amount_band',
          label: 'Amount band',
          config: { filterable: true, choices: ['low', 'high'] },
        },
        { type: 'boolean', key: 'express', label: 'Express', config: { filterable: true } },
        { type: 'date', key: 'shipped_on', label: 'Shipped on', config: { filterable: true } },
        {
          type: 'string',
          key: 'order_code',
          label: 'Order code',
          config: { filterable: true, searchable: true },
        },
        { type: 'string', key: 'note', label: 'Note', config: {} },
      ],
    },
  };
}

const show = (params: Record<string, string>, canFilterStrings = false) =>
  render(
    <TransactionFilters
      query={parseTransactionQuery(params)}
      types={[typeWithFields()]}
      canFilterStrings={canFilterStrings}
    />,
  );

describe('the transaction field filters (C165.3)', () => {
  it('offers the chosen type’s filterable fields, a string one only with pii:view', () => {
    show({ type: TYPE });

    expect(screen.getByLabelText('Amount band')).toHaveAttribute('name', 'field.amount_band');
    expect(screen.getByLabelText('Express')).toHaveAttribute('name', 'field.express');
    expect(screen.getByLabelText('Shipped on')).toHaveAttribute('type', 'date');
    expect(screen.queryByLabelText('Order code')).toBeNull();
    expect(screen.queryByLabelText('Note')).toBeNull();
    expect(
      screen.getByText(/A text field is offered only to a role that sees personal data/),
    ).toBeVisible();
  });

  it('offers a searchable string field to a reader of personal data', () => {
    show({ type: TYPE, 'field.order_code': 'synthetic-order' }, true);

    expect(screen.getByLabelText('Order code')).toHaveValue('synthetic-order');
  });

  it('offers no field filter before a type is chosen, and says why', () => {
    show({});

    expect(screen.queryByLabelText('Amount band')).toBeNull();
    expect(screen.getByText(/Choose a type to filter by its fields/)).toBeVisible();
  });
});
