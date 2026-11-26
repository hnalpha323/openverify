import { Button } from '@openverify/ui';
import Link from 'next/link';
import { logout } from '../app/actions/auth';
import { switchEnvironment } from '../app/actions/environment';
import type { DashboardSession, SessionEnvironment } from '../lib/api/me';
import { EnvironmentSwitcher } from './environment-switcher';
import { LINK_CLASS } from './link-styles';
import { CONSOLE_COPY } from '../lib/copy/console';
import { ACCOUNT_SECURITY_PATH, NOTIFICATION_PREFERENCES_PATH } from './nav-items';

export interface ConsoleHeaderProps {
  readonly session: Pick<DashboardSession, 'user' | 'environment'>;
  /** Where the environment switcher may go (`switchableEnvironments`). */
  readonly targets: readonly SessionEnvironment[];
}

/** The console's banner landmark: the brand, the environment switch, the operator, sign out. */
export function ConsoleHeader({ session, targets }: ConsoleHeaderProps) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-6 py-3">
        <Link
          href="/"
          className="font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          OpenVerify Dashboard
        </Link>
        <EnvironmentSwitcher
          current={session.environment}
          targets={targets}
          action={switchEnvironment}
        />
        <div className="ms-auto flex flex-wrap items-center gap-4 text-sm">
          <span className="text-ink-muted">{session.user.name ?? session.user.email}</span>
          <Link href={ACCOUNT_SECURITY_PATH} className={LINK_CLASS}>
            Security
          </Link>
          <Link href={NOTIFICATION_PREFERENCES_PATH} className={LINK_CLASS}>
            {CONSOLE_COPY.nav.notificationPreferences}
          </Link>
          <form action={logout}>
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
