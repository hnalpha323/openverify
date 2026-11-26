import { describe, expect, it } from 'vitest';
import { listHref } from '../../lib/list-query';
import {
  hasTransactionFilters,
  parseTransactionQuery,
  transactionFilterQuery,
} from './transaction-query';

describe('the transactions index query (C23, C105.2; C165.3 field filters)', () => {
  it('reads the type, status, reference and creation range', () => {
    const query = parseTransactionQuery({ status: 'open', from: '2026-10-01', to: '2026-10-02' });

    expect(query.errors).toEqual({});
    expect(query.filters).toMatchObject({
      status: 'open',
      createdAtStart: '2026-10-01T00:00:00.000Z',
      createdAtEnd: '2026-10-03T00:00:00.000Z',
    });
    expect(hasTransactionFilters(query.filters)).toBe(true);
  });

  it('reads each field filter as field.<key> and sends it as the field’s value', () => {
    const query = parseTransactionQuery({
      type: 'txntp_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
      'field.amount_band': ' high ',
      'field.express': 'true',
      'field.empty': '',
    });

    expect(query.errors).toEqual({});
    expect(query.filters.fields).toEqual({ amount_band: 'high', express: 'true' });
    expect(listHref('/transactions', transactionFilterQuery(query.values))).toBe(
      '/transactions?type=txntp_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z&field.amount_band=high&field.express=true',
    );
  });

  it('needs a type for a field filter, and at most ten of them', () => {
    expect(parseTransactionQuery({ 'field.amount_band': 'high' }).errors).toEqual({
      fields: 'Choose the transaction type whose field you filter by.',
    });
    const many = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [`field.f${String(index)}`, 'x']),
    );
    expect(
      parseTransactionQuery({ type: 'txntp_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z', ...many }).errors,
    ).toEqual({ fields: 'Filter by at most ten fields at once.' });
  });

  it('has no field filter without one', () => {
    expect(parseTransactionQuery({}).filters.fields).toBeUndefined();
    expect(hasTransactionFilters(parseTransactionQuery({}).filters)).toBe(false);
  });
});
