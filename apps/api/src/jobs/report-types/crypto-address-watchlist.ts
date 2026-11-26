/**
 * C79.3, C83 (Workflow 6A Stage 3, owner `api-reports`): the `crypto-address-watchlist` report
 * job, behind the frozen `ReportTypeJob` of `jobs/report-types/index.ts`. The address is stripped
 * of a URI scheme and query, canonicalised by the C79.3 format table, and matched exactly against
 * the canonical addresses of the pinned sanctions lists (R; no score but 1). The canonical address
 * goes to the framework, which keeps its blind index (`crypto_address_index`); the optional
 * exposure step asks the `cryptoExposure` provider through its port when one is bound (F19), and
 * an unbound or unrated one leaves `exposure` null with its reason, never a pass.
 */
import { screenCrypto } from '../reports/screening.js';
import type { ReportTypeJob } from './job.js';

export const cryptoAddressWatchlistReportJob: ReportTypeJob = {
  type: 'crypto-address-watchlist',
  run: (ctx) => screenCrypto(ctx),
};
