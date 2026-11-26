import { webhookDeliverySearchBodySchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { INTEGRATION_IDS } from './testing-fixtures';
import { deliverySearchBodyOf } from './delivery-search-query';

function form(rows: readonly (readonly [string, string, string, string])[], combine = 'and') {
  const data = new FormData();
  data.set('combine', combine);
  for (const [attribute, negate, operator, value] of rows) {
    data.append('clause-attribute', attribute);
    data.append('clause-negate', negate);
    data.append('clause-operator', operator);
    data.append('clause-value', value);
  }
  return data;
}

describe('deliverySearchBodyOf (C165.4)', () => {
  it('builds and, or and not over the four attributes, comma lists as in, within the contract', () => {
    const body = deliverySearchBodyOf(
      form([
        ['status', 'is', 'eq', 'failed'],
        ['event_name', 'is-not', 'in', 'inquiry.approved, inquiry.declined'],
        ['webhook_id', 'is', 'eq', INTEGRATION_IDS.webhook],
        ['updated_at', 'is', 'gte', '2026-10-20T00:00'],
      ]),
    );

    expect(body).toEqual({
      query: {
        and: [
          { attribute: 'status', operator: 'eq', value: 'failed' },
          {
            not: {
              attribute: 'event_name',
              operator: 'in',
              value: ['inquiry.approved', 'inquiry.declined'],
            },
          },
          { attribute: 'webhook_id', operator: 'eq', value: INTEGRATION_IDS.webhook },
          { attribute: 'updated_at', operator: 'gte', value: '2026-10-20T00:00:00.000Z' },
        ],
      },
      page: { size: 25 },
    });
    expect(webhookDeliverySearchBodySchema.safeParse(body).success).toBe(true);
  });

  it('joins with or, and keeps the cursor of a next page', () => {
    const data = form(
      [
        ['status', 'is', 'eq', 'failed'],
        ['status', 'is', 'eq', 'pending'],
      ],
      'or',
    );
    data.set('after', 'whd_01J9ZK3M5Q7R8S9T0V1W2X3Y63');

    expect(deliverySearchBodyOf(data)).toEqual({
      query: {
        or: [
          { attribute: 'status', operator: 'eq', value: 'failed' },
          { attribute: 'status', operator: 'eq', value: 'pending' },
        ],
      },
      page: { size: 25, after: 'whd_01J9ZK3M5Q7R8S9T0V1W2X3Y63' },
    });
  });

  it('skips empty rows and refuses a search without any clause', () => {
    expect(() => deliverySearchBodyOf(form([['status', 'is', 'eq', '']]))).toThrow(
      expect.objectContaining({ name: 'ActionInputError' }),
    );
  });

  it('refuses more than 20 clauses, a status not in the list and a malformed time, naming the row', () => {
    const many = Array.from({ length: 21 }, () => ['status', 'is', 'eq', 'failed'] as const);
    let thrown: unknown;
    try {
      deliverySearchBodyOf(form(many));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      problem: { errors: [{ pointer: '/clauses', detail: 'Use at most 20 conditions.' }] },
    });

    try {
      deliverySearchBodyOf(
        form([
          ['status', 'is', 'eq', 'lost'],
          ['updated_at', 'is', 'lt', 'yesterday'],
        ]),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      problem: {
        errors: [
          { pointer: '/clauses/0', detail: 'Condition 1: choose pending, succeeded or failed.' },
          { pointer: '/clauses/1', detail: 'Condition 2: enter a date and time (UTC).' },
        ],
      },
    });
  });
});
