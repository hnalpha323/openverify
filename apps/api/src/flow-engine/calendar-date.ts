/**
 * A `date` value of a screen component or an inquiry field (C148.2, C149.2): `YYYY-MM-DD` naming a
 * real calendar day. One rule for the screen submission and the fields write. `Date.parse` alone
 * rolls an impossible day over (`2023-02-29` reads as 1 March), so the day must round-trip (R003,
 * Workflow 9D).
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** Whether `text` is a real calendar day in the `YYYY-MM-DD` form. */
export function isCalendarDate(text: string): boolean {
  if (!ISO_DATE.test(text)) {
    return false;
  }
  const time = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text;
}
