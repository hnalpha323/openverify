import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { renderPage } from '../../lib/api/page';

export const metadata: Metadata = { title: 'Error page probe' };

/** Only exactly this mode turns the probe on: the e2e stack's, never the compose dashboard's. */
const PROBE_MODE = 'development';

/**
 * C170.3 (Workflow 9D, K9-15): a deterministic trigger for the console's error boundary, so the
 * real-header CSP spec can check the error page's policy and nonces. It throws on purpose for a
 * signed-in operator, and only while the dashboard runs with `OPENVERIFY_MODE=development` (the
 * e2e stack's mode); in any other mode, or none (the compose dashboard sets none), it is the 404
 * page and calls nothing. The error boundary shows its generic words and a digest, never this
 * message.
 */
export default async function ErrorProbePage() {
  if (process.env.OPENVERIFY_MODE !== PROBE_MODE) {
    notFound();
  }
  return renderPage({}, () => {
    throw new Error('The error page probe was opened on purpose (development mode only).');
  });
}
