/**
 * `POST /csp-reports` (C170.2): the console's CSP violation reports, public in `proxy.ts`. The
 * rules are `lib/csp/reports.ts`'; the client address comes through the console's own helpers.
 */
import { requestClientAddress } from '../../lib/api/client-address';
import { createCspReportHandler } from '../../lib/csp/reports';

export const POST = createCspReportHandler({
  clientAddress: () => requestClientAddress(),
  // The production clock; the handler's tests inject their own.
  now: () => Date.now(),
  log: (entry) => {
    console.warn(JSON.stringify(entry));
  },
});
