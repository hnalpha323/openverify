import type { ReactNode } from 'react';
import { switchableEnvironments } from '../lib/api/environments';
import { getSession } from '../lib/api/me';
import { ConsoleHeader } from './console-header';
import { CspModeBanner } from './csp/csp-mode-banner';
import { EnvironmentBanner } from './environment-banner';
import { Nav } from './nav';
import { visibleNavGroups } from './nav-items';

export { switchableEnvironments } from '../lib/api/environments';

/**
 * The signed-in console around every page (C21, C23): the environment banner, the header with
 * the environment switch, and the navigation the operator's role allows. A section's
 * `layout.tsx` re-exports it:
 *
 * ```ts
 * export { ConsoleLayout as default } from '../../components/console-layout';
 * ```
 *
 * A session that has not passed required MFA sees no navigation; its pages redirect to
 * `/account/security` (`renderPage`).
 */
export async function ConsoleLayout({ children }: { readonly children: ReactNode }) {
  const session = await getSession();
  const groups = session.mfaSatisfied ? visibleNavGroups(session.permissions) : [];

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:outline-2 focus:outline-focus"
      >
        Skip to content
      </a>
      <EnvironmentBanner kind={session.environment.kind} />
      <CspModeBanner />
      <ConsoleHeader session={session} targets={switchableEnvironments(session)} />
      <div className="flex flex-1 flex-col md:flex-row">
        {groups.length > 0 && <Nav groups={groups} />}
        <div id="content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          {children}
        </div>
      </div>
    </div>
  );
}
