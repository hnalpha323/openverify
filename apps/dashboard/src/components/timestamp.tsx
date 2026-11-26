// UTC, so server-rendered times do not depend on the server's time zone.
const UTC_DATE_TIME = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** An ISO-8601 timestamp in UTC, or the value as given when it does not parse. */
export function formatUtc(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : UTC_DATE_TIME.format(date);
}

/** A `<time>` with the machine-readable value and a readable UTC rendering. */
export function Timestamp({ value }: { readonly value: string }) {
  return (
    <time dateTime={value} className="whitespace-nowrap">
      {formatUtc(value)}
    </time>
  );
}
