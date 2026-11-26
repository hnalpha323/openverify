import { cspMode, type CspMode } from '../../lib/csp/policy';
import { SETTINGS_COPY } from '../../lib/copy/settings';

/**
 * C170.5: on every console page, says in words and an icon when the script policy is only
 * reported, not enforced (`OPENVERIFY_DASHBOARD_CSP_MODE=report-only`). Nothing when enforced.
 * A server component: the mode is the console's configuration, read per request.
 */
export function CspModeBanner({ mode = cspMode() }: { readonly mode?: CspMode }) {
  if (mode !== 'report-only') {
    return null;
  }
  return (
    <div
      role="status"
      aria-label={SETTINGS_COPY.csp.bannerLabel}
      className="border-b border-amber-300 bg-amber-50 px-6 py-1.5 text-sm text-amber-950"
    >
      <p className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-4 shrink-0 fill-none stroke-current stroke-2"
        >
          <path d="M8 1.5 15 14H1z M8 6v4 M8 11.5v.5" />
        </svg>
        <strong className="font-semibold">{SETTINGS_COPY.csp.bannerTitle}</strong>{' '}
        <span>{SETTINGS_COPY.csp.bannerNote}</span>
      </p>
    </div>
  );
}
