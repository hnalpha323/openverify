/**
 * C83 (Workflow 6A Stage 1b): what the report provider factories read
 * (`providers/{adverse-media,email-intelligence,phone-intelligence,address-verification,
 * crypto-exposure}/index.ts`, owned by `api-providers`). Frozen by `foundation-6`.
 */
import type { ReportProviderCredentials } from '../config.js';
import type { OutboundHttp } from '../http/index.js';
import type { Clock, KeyValueCache, RateLimiter } from '../ports.js';

export interface ReportProviderOptions {
  /** The credentials of the bound real adapters; `undefined` outside the worker. */
  credentials?: ReportProviderCredentials | undefined;
  outboundHttp?: OutboundHttp | undefined;
  /** No article cache (C81.2, P03): the cache is for the shared budget's bookkeeping only. */
  cache?: KeyValueCache | undefined;
  /** C81.2 (V09): the GCRA limiter of the shared GDELT budget. */
  rateLimiter?: RateLimiter | undefined;
  clock?: Clock | undefined;
}
