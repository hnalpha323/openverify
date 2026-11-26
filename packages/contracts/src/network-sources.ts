/**
 * Network sources as the console reads them (plan C92, C108; Workflow 7A): the dashboard
 * `GET /api/v1/dashboard/network-sources` answer (`settings:read`). Network data is public: the
 * page names no session, address or subject, only publication times, digests, counts and codes.
 */
import { z } from 'zod';

const timestamp = z.iso.datetime().nullable();
const sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .nullable();
const code = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .nullable();

/** The document's schema, strict (api-network's, moved here by integration-7a). */
export const dashboardNetworkSourcesSchema = z.strictObject({
  sources: z.array(
    z.strictObject({
      id: z.string().min(1).max(64),
      publisher: z.string().min(1).max(200),
      role: z.string().min(1).max(32),
      enabled: z.boolean(),
      'enabled-by-default': z.boolean(),
      'sandbox-only': z.boolean(),
      /** No download: imported only (Azure, the sandbox). */
      'import-only': z.boolean(),
      'last-sync-id': z.string().nullable(),
      'last-checked-at': timestamp,
      'last-applied-at': timestamp,
      'published-at': timestamp,
      sha256,
      origin: z.enum(['publisher', 'import']).nullable(),
      /** C92.4: `null` for a source never checked or turned off; never for the sandbox source. */
      stale: z.boolean().nullable(),
      'stale-after-hours': z.int().nullable(),
      'refresh-interval-hours': z.int().nullable(),
      'last-error-code': code,
      'check-failures': z.int().min(0),
      'last-failed-at': timestamp,
      attribution: z.string().min(1).max(500),
      'link-back': z.url().nullable(),
      terms: z.strictObject({ note: z.string().min(1).max(1000), url: z.url().nullable() }),
    }),
  ),
  'recent-syncs': z.array(
    z.strictObject({
      id: z.string(),
      'source-id': z.string(),
      'started-at': z.iso.datetime(),
      'finished-at': timestamp,
      outcome: z.string().regex(/^[a-z][a-z_]*$/),
      'error-code': code,
      'published-at': timestamp,
      sha256,
      'snapshot-bytes': z.int().min(0).nullable(),
      'entry-count': z.int().min(0),
      actor: z.enum(['cli', 'job', 'seed']),
      origin: z.enum(['publisher', 'import']).nullable(),
      overrides: z.array(
        z.enum(['allow-mass-removal', 'allow-mass-addition', 'accept-older-publication']),
      ),
    }),
  ),
  /** C92.6: the pinned hosting and VPN ASN seeds this process holds. */
  'asn-seeds': z.strictObject({
    status: z.enum(['loaded', 'missing', 'unexpected']),
    files: z.array(z.string()),
    'hosting-asns': z.int().min(0).nullable(),
    'vpn-asns': z.int().min(0).nullable(),
    seeds: z.array(
      z.strictObject({
        name: z.string(),
        commit: z
          .string()
          .regex(/^[0-9a-f]{40}$/)
          .nullable(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    ),
  }),
});
export type DashboardNetworkSources = z.infer<typeof dashboardNetworkSourcesSchema>;
