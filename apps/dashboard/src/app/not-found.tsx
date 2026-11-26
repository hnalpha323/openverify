import Link from 'next/link';
import { LINK_CLASS } from '../components/link-styles';
import { PageMain } from '../components/page-main';

/** Any route without a page, or a resource the session's environment does not have. */
export default function NotFound() {
  return (
    <PageMain width="narrow" className="items-start">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-ink-muted">
        This page does not exist, or it belongs to another environment.
      </p>
      <Link href="/" className={LINK_CLASS}>
        Go to the dashboard
      </Link>
    </PageMain>
  );
}
