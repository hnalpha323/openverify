/**
 * R003 (Workflow 9D review): a `date` value is a real calendar day. `Date.parse` rolls an impossible
 * day over (`2023-02-29` parses as 1 March), so the screen submission and the fields write check the
 * day round-trips instead (`isCalendarDate`).
 *
 * Every value is synthetic.
 */
import { screenStepSchema } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import { isCalendarDate } from './calendar-date.js';
import { validateScreenSubmission } from './screen-submission.js';

describe('isCalendarDate (R003)', () => {
  it.each(['2024-02-29', '2023-02-28', '2024-12-31', '0001-01-01'])('takes %s', (text) => {
    expect(isCalendarDate(text)).toBe(true);
  });

  it.each(['2023-02-29', '2024-04-31', '2024-02-30', '2023-13-01', '2023-02-32', '2023-2-01', ''])(
    'refuses %j',
    (text) => {
      expect(isCalendarDate(text)).toBe(false);
    },
  );
});

describe('a screen’s date component (R003)', () => {
  const step = screenStepSchema.parse({
    id: 'visit',
    type: 'screen',
    components: [
      { id: 'when', kind: 'date', field: 'visit_date', labelKey: 'visit.when' },
      { id: 'go', kind: 'button', labelKey: 'visit.go', action: 'submit' },
    ],
  });
  // The submit button has no port of its own, so the body names none (it leaves through `next`).
  const submit = (value: string) =>
    validateScreenSubmission(step, {}, { values: { visit_date: value } });

  it('refuses an impossible day at its field, and takes a leap day', () => {
    expect(() => submit('2023-02-29')).toThrow(
      expect.objectContaining({
        errors: [expect.objectContaining({ pointer: '/values/visit_date' })],
      }),
    );
    expect(submit('2024-02-29')).toEqual({ fields: { visit_date: '2024-02-29' }, port: 'next' });
  });
});
