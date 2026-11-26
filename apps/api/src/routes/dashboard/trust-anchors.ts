/**
 * C62.10: `GET /api/v1/dashboard/trust-anchors` (`settings:read`), the console view of the CSCA
 * trust store. The schema is frozen (C54.2); `api-nfc` built the handler over its
 * `trust-anchors` repository (`trustStoreOverview`): each source with its last sync and list,
 * the usable, link and withdrawn anchors per country (sandbox-only anchors apart), the withdrawn
 * anchors, each CRL's freshness at the server clock, the sandbox anchors seed:dev inserts,
 * whether a production environment can publish an NFC step, and the two trust-store settings this
 * process reads (Workflow 5C review K13). Holds no personal data.
 */
import {
  dashboardTrustAnchorsSchema,
  toTimestamp,
  type DashboardTrustAnchors,
} from '@openverify/contracts';
import { trustStoreOverview, type TrustStoreOverview } from '@openverify/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { NfcSettings } from '../../config.js';
import { problemResponses } from '../../plugins/openapi.js';
import type { AdminRouteContext } from './admin-context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

const timestampOrNull = (value: Date | null) => (value === null ? null : toTimestamp(value));

/** The overview as the frozen schema names it, with the settings this process reads (K13). */
export function trustAnchorsDocument(
  overview: TrustStoreOverview,
  generatedAt: Date,
  nfc: NfcSettings,
): DashboardTrustAnchors {
  return {
    'generated-at': toTimestamp(generatedAt),
    'has-production-anchor': overview.hasProductionAnchor,
    settings: {
      'refresh-enabled': nfc.trustAnchorRefresh,
      'icao-crls-allowed': nfc.allowIcaoCrls,
    },
    sources: overview.sources.map((source) => ({
      id: source.id,
      enabled: source.enabled,
      'last-synced-at': timestampOrNull(source.lastSyncedAt),
      'list-signing-time': timestampOrNull(source.listSigningTime),
      'list-sha256': source.listSha256,
      anchors: source.anchors,
      'last-sync':
        source.lastSync === null
          ? null
          : {
              outcome: source.lastSync.outcome,
              reason: source.lastSync.reason,
              'anchors-seen': source.lastSync.anchorsSeen,
              'anchors-withdrawn': source.lastSync.anchorsWithdrawn,
              'crls-updated': source.lastSync.crlsUpdated,
              'created-at': toTimestamp(source.lastSync.createdAt),
            },
    })),
    countries: overview.countries.map((country) => ({
      country: country.country,
      anchors: country.anchors,
      'link-certificates': country.linkCertificates,
      'withdrawn-anchors': country.withdrawnAnchors,
      'next-expiry': timestampOrNull(country.nextExpiry),
    })),
    'withdrawn-anchors': overview.withdrawnAnchors.map((anchor) => ({
      id: anchor.id,
      country: anchor.country,
      'subject-dn': anchor.subjectDn,
      'withdrawn-at': timestampOrNull(anchor.withdrawnAt),
    })),
    crls: overview.crls.map((crl) => ({
      'issuer-country': crl.issuerCountry,
      'issuer-key-id': crl.issuerKeyId,
      'this-update': toTimestamp(crl.thisUpdate),
      'next-update': toTimestamp(crl.nextUpdate),
      'fetched-at': toTimestamp(crl.fetchedAt),
      freshness: crl.freshness,
    })),
    'sandbox-anchors': overview.sandboxAnchors.map((anchor) => ({
      id: anchor.id,
      country: anchor.country,
      'not-before': toTimestamp(anchor.notBefore),
      'not-after': toTimestamp(anchor.notAfter),
      'crl-next-update': timestampOrNull(anchor.crlNextUpdate),
    })),
  };
}

export const trustAnchorRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.get(
    '/trust-anchors',
    {
      config: { scopes: ['settings:read'] },
      schema: {
        summary: 'Get the trust store',
        description:
          'C62.10: the install-wide CSCA trust store of government ID NFC checks: each source ' +
          'with its last sync, the master list signing time and SHA-256, the anchors per ' +
          'country, the withdrawn anchors, the freshness of each CRL, the sandbox anchors, ' +
          'whether a production anchor exists, and whether the refresh job runs and ICAO PKD ' +
          'CRLs are allowed, as the API process reads OPENVERIFY_TRUST_ANCHOR_REFRESH and ' +
          'OPENVERIFY_NFC_ALLOW_ICAO_CRLS. Holds no personal data.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: { 200: dashboardTrustAnchorsSchema, ...problemResponses(401, 403, 404) },
      },
    },
    async () => {
      const now = context.clock.now();
      return trustAnchorsDocument(await trustStoreOverview(context.db, now), now, context.nfc);
    },
  );
  return Promise.resolve();
};
