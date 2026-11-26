/**
 * C62.8, C65.3, C65.5: what `seed:dev` and the full-stack e2e run build. The Utopia CSCA comes from
 * the fixed seed `UTOPIA_CSCA_SEED` with a validity aligned to UTC years, so its key, name and key
 * identifier never change and its bytes stay the same within a calendar year (a re-seed in the
 * same year finds the same anchor); its CRL is refreshed on every seed (`nextUpdate` now + 90
 * days, `cRLNumber` the day number, so it never goes back). The e2e builds a per-run DSC under the
 * same key, and the chip with a P-256 Active Authentication key.
 */
import { createHash } from 'node:crypto';
import { toHex } from '../bytes.js';
import { parseCrl } from '../pki.js';
import type { TrustStore } from '../types.js';
import { buildChip, type TestChip, type TestChipOptions } from './chip.js';
import { buildCrl, buildCsca, buildDsc, type TestCertificate } from './x509.js';

/** The fictional issuer of every synthetic chip (Doc 9303's specimen state). */
export const UTOPIA = Object.freeze({ alpha3: 'UTO', alpha2: 'UT' });

/** The seed of the deterministic Utopia CSCA that `seed:dev` inserts as the sandbox anchor (C62.8). */
export const UTOPIA_CSCA_SEED = 'openverify/emrtd/utopia-csca/v1';

const DAY_MS = 86_400_000;
/** C62.8: the seed's CRL is current for 90 days. */
const SEED_CRL_DAYS = 90;
const CSCA_YEARS = 16;

/** The Utopia CSCA: brainpoolP256r1 with explicit parameters, valid from 1 January of last year for 16 years. */
export function buildUtopiaCsca(options: { readonly now: Date }): TestCertificate {
  const year = options.now.getUTCFullYear();
  return buildCsca({
    seed: UTOPIA_CSCA_SEED,
    now: options.now,
    country: UTOPIA.alpha2,
    commonName: 'CSCA Utopia',
    notBefore: new Date(Date.UTC(year - 1, 0, 1)),
    notAfter: new Date(Date.UTC(year - 1 + CSCA_YEARS, 0, 1)),
  });
}

/** The seed's CRL of the Utopia CSCA (C62.8): this update now, next update in 90 days. */
export function buildUtopiaCrl(options: {
  readonly csca: TestCertificate;
  readonly now: Date;
  readonly revokedSerials?: readonly string[] | undefined;
}): Uint8Array {
  return buildCrl({
    issuer: options.csca,
    now: options.now,
    nextUpdateDays: SEED_CRL_DAYS,
    crlNumber: Math.floor(options.now.getTime() / DAY_MS),
    revokedSerials: options.revokedSerials,
  });
}

export interface UtopiaChipOptions extends Omit<
  TestChipOptions,
  'dsc' | 'seed' | 'activeAuthentication'
> {
  readonly now: Date;
  /** The per-run seed of the DSC and the chip's keys. */
  readonly seed: string;
}

export interface UtopiaChip extends TestChip {
  readonly csca: TestCertificate;
  readonly dsc: TestCertificate;
}

/**
 * C65.5: a chip under the Utopia CSCA `seed:dev` inserted: a per-run DSC (explicit
 * brainpoolP256r1) and a P-256 Active Authentication key, so every required NFC check can pass.
 */
export function buildUtopiaChip(options: UtopiaChipOptions): UtopiaChip {
  const { now, seed, ...chip } = options;
  const csca = buildUtopiaCsca({ now });
  const dsc = buildDsc({ seed: `${seed}/dsc`, issuer: csca, now });
  return {
    csca,
    dsc,
    ...buildChip({
      ...chip,
      dsc,
      seed: `${seed}/chip`,
      activeAuthentication: { kind: 'ec', curve: 'P-256' },
    }),
  };
}

/**
 * A trust store as the repository loader would return it (C62.8), for unit tests: each CSCA (or
 * link) a current, sandbox-only anchor, each CRL with the fields its issuer and dates give.
 */
export function testTrustStore(options: {
  readonly anchors: readonly TestCertificate[];
  readonly crls?: readonly Uint8Array[] | undefined;
}): TrustStore {
  return {
    anchors: options.anchors.map((certificate) => ({
      id: createHash('sha256').update(certificate.der).digest('hex'),
      certificate: certificate.der,
      country: certificate.country,
      ski: toHex(certificate.keyIdentifier),
      aki: toHex(certificate.keyIdentifier),
      isLink: false,
      sandboxOnly: true,
      withdrawn: false,
    })),
    crls: (options.crls ?? []).map((der) => {
      const crl = parseCrl(der);
      return {
        der,
        issuerCountry: crl.issuerCountry ?? '',
        issuerKeyId: crl.issuerKeyId,
        thisUpdate: crl.thisUpdate,
        nextUpdate: crl.nextUpdate,
      };
    }),
  };
}
