/**
 * C62.8: the deterministic Utopia test CSCA that `seed:dev` inserts as the sandbox anchor, with a
 * CRL current for 90 days (re-seeding refreshes it), listed by the enabled source
 * `openverify-sandbox` (an anchor no enabled source lists is withdrawn, C62.7). The anchor is
 * `sandbox_only`, so the production loader never returns it (the filter is in SQL), and the
 * specimen rule fails a Utopia chip in production first (C62.3). Nothing here reaches a network
 * or a file: the certificate and CRL are built from a fixed seed by `@openverify/emrtd/testing`.
 */
import { createHash } from 'node:crypto';
import { applyTrustSync, syncTrustAnchorSources, type Db } from '@openverify/db';
import { parseCertificate, parseCrl } from '@openverify/emrtd';
import { buildUtopiaCrl, buildUtopiaCsca } from '@openverify/emrtd/testing';

/** The source that lists the sandbox anchor. */
export const SANDBOX_TRUST_SOURCE = 'openverify-sandbox';

export interface InstalledSandboxAnchor {
  /** The anchor's id, its certificate's SHA-256. */
  anchorId: string;
  notBefore: Date;
  notAfter: Date;
  crlNextUpdate: Date;
}

/** Inserts (or refreshes) the Utopia sandbox anchor and its CRL as of `now`. */
export async function installSandboxTrustAnchor(
  db: Db,
  options: { now: Date },
): Promise<InstalledSandboxAnchor> {
  const { now } = options;
  const csca = buildUtopiaCsca({ now });
  const anchor = parseCertificate(csca.der);
  const crlDer = buildUtopiaCrl({ csca, now });
  const crl = parseCrl(crlDer);
  if (crl.nextUpdate === null) {
    throw new Error('the Utopia CRL has no nextUpdate');
  }
  await syncTrustAnchorSources(db, [{ id: SANDBOX_TRUST_SOURCE, enabled: true }]);
  const applied = await applyTrustSync(db, {
    sourceId: SANDBOX_TRUST_SOURCE,
    // The seed's "list" is the one certificate, signed at `now`.
    list: {
      sha256: anchor.sha256,
      signingTime: now,
      anchors: [
        {
          sha256: anchor.sha256,
          certificate: anchor.der,
          country: anchor.country ?? csca.country,
          subjectDn: anchor.subjectDn,
          ski: anchor.ski,
          aki: anchor.aki,
          notBefore: anchor.notBefore,
          notAfter: anchor.notAfter,
          isLink: false,
          sandboxOnly: true,
        },
      ],
    },
    crls: [
      {
        sha256: createHash('sha256').update(crlDer).digest('hex'),
        der: crlDer,
        issuerCountry: crl.issuerCountry ?? csca.country,
        issuerKeyId: crl.issuerKeyId ?? anchor.ski,
        thisUpdate: crl.thisUpdate,
        nextUpdate: crl.nextUpdate,
        crlNumber: crl.crlNumber,
        url: null,
      },
    ],
    now,
  });
  if (applied.outcome !== 'accepted' || applied.crlsRefused.length > 0) {
    throw new Error(
      `the sandbox anchor was refused (${applied.reason ?? applied.crlsRefused[0]?.reason ?? 'unknown'})`,
    );
  }
  return {
    anchorId: anchor.sha256,
    notBefore: anchor.notBefore,
    notAfter: anchor.notAfter,
    crlNextUpdate: crl.nextUpdate,
  };
}
