/**
 * C143.5 (P21): what the trigger routes take, as a stored API log holds it for a reader without PII
 * visibility: `fields` with its file values, `object-ids` and CSV bodies, and `data.parameters` and a
 * form's `prefilled-value`, which sit outside any `attributes`. Synthetic.
 */
import { describe, expect, it } from 'vitest';
import { maskPersonalData } from '../../services/api-logs.js';

const CANARY = 'synthetic-canary';

const masked = (body: unknown) => JSON.stringify(maskPersonalData(body));

describe('a stored API log of the trigger routes (C143.5)', () => {
  it('masks a trigger’s fields, file values included', () => {
    const body = {
      data: {
        attributes: { fields: { reference: CANARY, scan: { filename: CANARY, data: CANARY } } },
      },
    };

    expect(masked(body)).not.toContain(CANARY);
  });

  it('masks a manual run’s ids and CSV', () => {
    const body = {
      data: { type: 'workflow-run', attributes: { 'object-ids': [CANARY], csv: CANARY } },
    };

    expect(masked(body)).not.toContain(CANARY);
  });

  it('masks a run-action’s parameters, which sit outside `attributes`', () => {
    const body = { data: { 'account-action-id': 'accac_1', parameters: { reference: CANARY } } };

    expect(masked(body)).not.toContain(CANARY);
  });

  it('masks a form’s prefilled values, inside an array', () => {
    const body = {
      data: [{ attributes: { form: [{ name: 'reference', 'prefilled-value': CANARY }] } }],
    };

    expect(masked(body)).not.toContain(CANARY);
  });

  it('keeps what is no value: a delivery’s status and reason', () => {
    const body = {
      data: [{ attributes: { status: 'refused', 'reason-code': 'workflow_not_running' } }],
    };

    expect(masked(body)).toContain('workflow_not_running');
  });
});
