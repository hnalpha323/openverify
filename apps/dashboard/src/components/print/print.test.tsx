/**
 * C173.3 (decision 59; review P36): the Print button of an inquiry, report or verification page
 * records the audit entry first and opens the browser's dialog only once it is recorded; it says
 * that it records use of the button, not every print. The printed footer names the environment,
 * the object, who printed it and when, and whether the page holds personal data.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { CASES_REPORTS_COPY } from '../../lib/copy/cases-reports';
import { later } from '../../testing/later';
import { ObjectPrintButton, ObjectPrintFooter } from './object-print';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
const OBJECT = 'inq_01JB0000000000000000000001';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ObjectPrintButton', () => {
  it('records the print with the object id, then opens the print dialog', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const action = vi.fn<Action>(() => later({ ok: true, data: undefined }));
    render(<ObjectPrintButton objectId={OBJECT} action={action} />);

    expect(screen.getByText(CASES_REPORTS_COPY.print.recordsUse)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Print' }));

    await vi.waitFor(() => {
      expect(print).toHaveBeenCalledTimes(1);
    });
    expect(action.mock.calls[0]?.[1].get('object-id')).toBe(OBJECT);
  });

  it('prints nothing when the audit is refused, and says why', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(
      <ObjectPrintButton
        objectId={OBJECT}
        action={() =>
          later<ActionResult>({ ok: false, problem: { title: 'Not found', status: 404 } })
        }
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Print' }));

    expect(await screen.findByText('Not found')).toBeVisible();
    expect(print).not.toHaveBeenCalled();
  });
});

describe('ObjectPrintFooter', () => {
  it('names the environment, the object, the operator and the time, and says the printout holds personal data', () => {
    const { container } = render(
      <ObjectPrintFooter
        kind="inquiry"
        environment="sandbox"
        objectId={OBJECT}
        operatorId="usr_01JB0000000000000000000009"
        personalData
      />,
    );
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });

    const footer = container.querySelector('[data-inquiry-print-footer]');
    expect(footer).toHaveTextContent('Environment: sandbox');
    expect(footer).toHaveTextContent(OBJECT);
    expect(footer).toHaveTextContent('Printed by usr_01JB0000000000000000000009 at');
    expect(footer).toHaveTextContent(CASES_REPORTS_COPY.print.containsPersonalData);
    expect(footer).toHaveTextContent(CASES_REPORTS_COPY.print.recordsUse);
  });

  it('says personal data is masked for a reader without pii:view', () => {
    const { container } = render(
      <ObjectPrintFooter
        kind="report"
        environment="production"
        objectId="rep_01JB0000000000000000000001"
        operatorId="usr_01JB0000000000000000000009"
        personalData={false}
      />,
    );

    expect(container.querySelector('[data-report-print-footer]')).toHaveTextContent(
      CASES_REPORTS_COPY.print.masked,
    );
  });
});
