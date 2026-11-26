import { useId } from 'react';
import { PREVIEW_COPY } from '../../lib/copy/preview';

/**
 * C156.7 (review H15): what the preview does not do, said beside it on every state: no camera, no
 * checks, simulated outcomes, and the server-side validations it does not run.
 */
export function PreviewBanner() {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-md border border-line bg-surface p-4 text-sm"
    >
      <h2 id={headingId} className="font-semibold text-ink">
        <span aria-hidden="true">ⓘ </span>
        {PREVIEW_COPY.banner.heading}
      </h2>
      <ul className="mt-2 list-disc ps-5 text-ink-muted">
        {Object.values(PREVIEW_COPY.banner.items).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
