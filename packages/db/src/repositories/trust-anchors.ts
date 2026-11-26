/**
 * C53.3, C62.7, C62.8: the install-wide CSCA trust store. Nothing in it is personal data, and
 * nothing in it is committed or shipped: an operator's `trust-anchors:sync` fills it from the
 * verified master lists, and `seed:dev` adds the deterministic Utopia test CSCA as a
 * `sandbox_only` anchor.
 *
 * Workflow 5B Stage 1 (`contracts-5b`) wrote this file and the reads other agents use: the
 * loader Passive Authentication verifies against, which filters `sandbox_only` anchors out in
 * SQL for a production environment (C62.8), and the NFC publish rule's "has a non-sandbox anchor"
 * (C50.4, H28). `api-nfc` owns it and adds the sync's writes (sources, memberships, withdrawal,
 * CRLs, the audit rows).
 */
import { and, asc, desc, eq, exists, isNull, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  trustAnchorMemberships,
  trustAnchors,
  trustAnchorSources,
  trustAnchorSyncs,
  trustCrls,
} from '../schema.js';

/** An anchor as Passive Authentication receives it (`@openverify/emrtd` `TrustAnchor`). */
export interface LoadedTrustAnchor {
  /** The certificate's SHA-256, lower-case hex: the anchor's key. */
  id: string;
  certificate: Uint8Array;
  country: string;
  subjectDn: string;
  ski: string | null;
  aki: string | null;
  notBefore: Date;
  notAfter: Date;
  isLink: boolean;
  sandboxOnly: boolean;
  /** No enabled source lists it any more (C62.7). */
  withdrawn: boolean;
}

/** A CRL as Passive Authentication receives it (`@openverify/emrtd` `TrustCrl`). */
export interface LoadedTrustCrl {
  der: Uint8Array;
  issuerCountry: string;
  issuerKeyId: string | null;
  thisUpdate: Date;
  nextUpdate: Date | null;
}

export interface LoadTrustStoreOptions {
  /**
   * Mandatory (C62.8): a production environment never receives a `sandbox_only` anchor; the
   * filter is in SQL.
   */
  environmentKind: 'sandbox' | 'production';
}

/** A current membership of the anchor in an enabled source (C62.7: not withdrawn). */
const currentlyListed = (db: Db) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(trustAnchorMemberships)
      .innerJoin(trustAnchorSources, eq(trustAnchorSources.id, trustAnchorMemberships.sourceId))
      .where(
        and(
          eq(trustAnchorMemberships.anchorId, trustAnchors.sha256),
          isNull(trustAnchorMemberships.withdrawnAt),
          eq(trustAnchorSources.enabled, true),
        ),
      ),
  );

/** The anchors and CRLs Passive Authentication verifies against, for `environmentKind`. */
export async function loadTrustStore(
  db: Db,
  options: LoadTrustStoreOptions,
): Promise<{ anchors: LoadedTrustAnchor[]; crls: LoadedTrustCrl[] }> {
  const anchors = await db
    .select({
      id: trustAnchors.sha256,
      certificate: trustAnchors.certificate,
      country: trustAnchors.country,
      subjectDn: trustAnchors.subjectDn,
      ski: trustAnchors.ski,
      aki: trustAnchors.aki,
      notBefore: trustAnchors.notBefore,
      notAfter: trustAnchors.notAfter,
      isLink: trustAnchors.isLink,
      sandboxOnly: trustAnchors.sandboxOnly,
      listed: currentlyListed(db),
    })
    .from(trustAnchors)
    // C62.8: in SQL, so a production environment can never receive a sandbox-only anchor.
    .where(
      options.environmentKind === 'production' ? eq(trustAnchors.sandboxOnly, false) : undefined,
    )
    .orderBy(asc(trustAnchors.sha256));
  const crls = await db
    .select({
      der: trustCrls.der,
      issuerCountry: trustCrls.issuerCountry,
      issuerKeyId: trustCrls.issuerKeyId,
      thisUpdate: trustCrls.thisUpdate,
      nextUpdate: trustCrls.nextUpdate,
    })
    .from(trustCrls)
    .orderBy(asc(trustCrls.issuerCountry), desc(trustCrls.thisUpdate), asc(trustCrls.sha256));
  return {
    anchors: anchors.map(({ listed, certificate, ...anchor }) => ({
      ...anchor,
      certificate: new Uint8Array(certificate),
      withdrawn: !listed,
    })),
    crls: crls.map((crl) => ({ ...crl, der: new Uint8Array(crl.der) })),
  };
}

/**
 * C50.4 (H28): whether the store holds an anchor a production environment can verify against: a
 * non-sandbox anchor that an enabled source still lists.
 */
export async function hasNonSandboxTrustAnchor(db: Db): Promise<boolean> {
  const rows = await db
    .select({ id: trustAnchors.sha256 })
    .from(trustAnchors)
    .where(and(eq(trustAnchors.sandboxOnly, false), currentlyListed(db)))
    .limit(1);
  return rows.length > 0;
}

// The sync's writes and the console's read (api-nfc, C62.7, C62.8, C62.10) ----------------------

/** A manifest source as the sync last read it (C62.7). */
export interface TrustAnchorSourceSetting {
  id: string;
  enabled: boolean;
}

/**
 * C62.7: makes the store's sources follow the manifest: each named source is created when new and
 * takes the manifest's `enabled`; a source the manifest no longer names is left as it is.
 */
export async function syncTrustAnchorSources(
  db: Db,
  sources: readonly TrustAnchorSourceSetting[],
): Promise<void> {
  for (const source of sources) {
    await db
      .insert(trustAnchorSources)
      .values({ id: source.id, enabled: source.enabled })
      .onConflictDoUpdate({ target: trustAnchorSources.id, set: { enabled: source.enabled } });
  }
}

/** A CSCA (or a link certificate) a verified list carries, as the sync parsed it. Not PII. */
export interface TrustAnchorInput {
  /** The certificate's SHA-256, lower-case hex. */
  sha256: string;
  certificate: Uint8Array;
  /** ISO 3166-1 alpha-2. */
  country: string;
  subjectDn: string;
  ski: string | null;
  aki: string | null;
  notBefore: Date;
  notAfter: Date;
  isLink: boolean;
  /** C62.8: only the seed's Utopia CSCA. */
  sandboxOnly?: boolean | undefined;
}

/** A CRL the sync verified under its anchor and found current (C62.7). Not PII. */
export interface TrustCrlInput {
  /** The CRL's SHA-256, lower-case hex. */
  sha256: string;
  der: Uint8Array;
  issuerCountry: string;
  /** The issuing CSCA's key identifier (the CRL's AKI, else the anchor's SKI). */
  issuerKeyId: string | null;
  thisUpdate: Date;
  nextUpdate: Date;
  /** `cRLNumber`, decimal; `null` when the CRL carries none. */
  crlNumber: string | null;
  /** Where it was fetched; `null` for an imported or seeded CRL. */
  url: string | null;
}

/** One CRL the store refused, and why (C62.7, audited). */
export interface RefusedTrustCrl {
  issuerCountry: string;
  issuerKeyId: string | null;
  reason: 'crl_number_rollback' | 'crl_not_current';
}

export interface ApplyTrustSyncInput {
  /** The source the list belongs to (`trust_anchor_sources.id`); it must exist. */
  sourceId: string;
  /** The verified master list, or `null` when only CRLs are refreshed. */
  list: {
    sha256: string;
    signingTime: Date;
    anchors: readonly TrustAnchorInput[];
  } | null;
  /** CRLs verified under their anchors. */
  crls: readonly TrustCrlInput[];
  now: Date;
}

export interface ApplyTrustSyncResult {
  outcome: 'accepted' | 'refused';
  /** `list_signing_time_rollback` or `source_unknown` when refused; `null` when accepted. */
  reason: string | null;
  anchorsSeen: number;
  anchorsWithdrawn: number;
  crlsUpdated: number;
  crlsRefused: RefusedTrustCrl[];
}

/**
 * C62.7: applies one source's verified sync in one transaction under the source's advisory lock
 * (and each CRL issuer's): a list whose `signingTime` is older than the source's last is refused
 * (rollback); otherwise its anchors are upserted, their memberships of this source marked seen
 * (`last_seen_at`) and current, and every other membership of the source withdrawn
 * (`withdrawn_at`); each CRL is stored unless a stored CRL of its issuer has a higher
 * `cRLNumber` (refused) or it is not current at `now`; older CRLs of its issuer are dropped. One
 * `trust_anchor_syncs` row records the outcome, plus one per refused CRL.
 */
export async function applyTrustSync(
  db: Db,
  input: ApplyTrustSyncInput,
): Promise<ApplyTrustSyncResult> {
  const { sourceId, list, now } = input;
  return db.transaction(async (tx) => {
    // C62.7: one sync of a source at a time; the lock goes with the transaction.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${SOURCE_LOCK}${sourceId}`}))`);
    const [source] = await tx
      .select({ lastSigningTime: trustAnchorSources.lastSigningTime })
      .from(trustAnchorSources)
      .where(eq(trustAnchorSources.id, sourceId))
      .for('update');
    const refused = (reason: string): ApplyTrustSyncResult => ({
      outcome: 'refused',
      reason,
      anchorsSeen: 0,
      anchorsWithdrawn: 0,
      crlsUpdated: 0,
      crlsRefused: [],
    });
    if (source === undefined) {
      return refused('source_unknown');
    }
    if (
      list !== null &&
      source.lastSigningTime !== null &&
      list.signingTime.getTime() < source.lastSigningTime.getTime()
    ) {
      await insertSync(tx, {
        sourceId,
        outcome: 'refused',
        reason: 'list_signing_time_rollback',
        listSha256: list.sha256,
        listSigningTime: list.signingTime,
      });
      return refused('list_signing_time_rollback');
    }
    let anchorsWithdrawn = 0;
    if (list !== null) {
      anchorsWithdrawn = await applyList(tx, sourceId, list, now);
    }
    const crlsRefused: RefusedTrustCrl[] = [];
    let crlsUpdated = 0;
    for (const crl of input.crls) {
      const stored = await storeCrl(tx, crl, now);
      if (stored === 'stored') {
        crlsUpdated += 1;
      } else if (stored !== 'unchanged') {
        crlsRefused.push({
          issuerCountry: crl.issuerCountry,
          issuerKeyId: crl.issuerKeyId,
          reason: stored,
        });
        await insertSync(tx, { sourceId, outcome: 'refused', reason: stored });
      }
    }
    const anchorsSeen = list?.anchors.length ?? 0;
    await insertSync(tx, {
      sourceId,
      outcome: 'accepted',
      reason: null,
      listSha256: list?.sha256 ?? null,
      listSigningTime: list?.signingTime ?? null,
      anchorsSeen,
      anchorsWithdrawn,
      crlsUpdated,
    });
    return {
      outcome: 'accepted',
      reason: null,
      anchorsSeen,
      anchorsWithdrawn,
      crlsUpdated,
      crlsRefused,
    };
  });
}

/** The advisory lock key prefix of a source's sync (C62.7). */
const SOURCE_LOCK = 'openverify/trust-anchor-source/';
/** The advisory lock key prefix of a CRL issuer, whose `cRLNumber` only moves forward. */
const CRL_ISSUER_LOCK = 'openverify/trust-crl-issuer/';

/**
 * Upserts a list's anchors, marks this source's memberships of them seen and current, and
 * withdraws every other membership of the source; returns how many it withdrew.
 */
async function applyList(
  tx: Db,
  sourceId: string,
  list: NonNullable<ApplyTrustSyncInput['list']>,
  now: Date,
): Promise<number> {
  for (const anchor of list.anchors) {
    await tx
      .insert(trustAnchors)
      .values({
        sha256: anchor.sha256,
        country: anchor.country,
        subjectDn: anchor.subjectDn,
        ski: anchor.ski,
        aki: anchor.aki,
        certificate: Buffer.from(anchor.certificate),
        notBefore: anchor.notBefore,
        notAfter: anchor.notAfter,
        isLink: anchor.isLink,
        sandboxOnly: anchor.sandboxOnly === true,
        firstSeenAt: now,
      })
      // The certificate's SHA-256 is its key: a stored anchor never changes.
      .onConflictDoNothing({ target: trustAnchors.sha256 });
    await tx
      .insert(trustAnchorMemberships)
      .values({
        sourceId,
        anchorId: anchor.sha256,
        listSigningTime: list.signingTime,
        lastSeenAt: now,
        withdrawnAt: null,
      })
      .onConflictDoUpdate({
        target: [trustAnchorMemberships.sourceId, trustAnchorMemberships.anchorId],
        set: { listSigningTime: list.signingTime, lastSeenAt: now, withdrawnAt: null },
      });
  }
  const listed = list.anchors.map((anchor) => anchor.sha256);
  const withdrawn = await tx
    .update(trustAnchorMemberships)
    .set({ withdrawnAt: now })
    .where(
      and(
        eq(trustAnchorMemberships.sourceId, sourceId),
        isNull(trustAnchorMemberships.withdrawnAt),
        listed.length === 0 ? undefined : notInArray(trustAnchorMemberships.anchorId, listed),
      ),
    )
    .returning({ anchorId: trustAnchorMemberships.anchorId });
  await tx
    .update(trustAnchorSources)
    .set({ lastSigningTime: list.signingTime, lastListSha256: list.sha256, lastSyncedAt: now })
    .where(eq(trustAnchorSources.id, sourceId));
  return withdrawn.length;
}

/** Whether `a` is a lower decimal `cRLNumber` than `b`. */
const crlNumberBelow = (a: string, b: string): boolean => BigInt(a) < BigInt(b);

/**
 * C62.7: stores a verified CRL unless it is not current at `now` or a stored CRL of its issuer
 * has a higher `cRLNumber`; the issuer's older CRLs are dropped.
 */
async function storeCrl(
  tx: Db,
  crl: TrustCrlInput,
  now: Date,
): Promise<'stored' | 'unchanged' | RefusedTrustCrl['reason']> {
  if (!(crl.thisUpdate.getTime() <= now.getTime() && now.getTime() < crl.nextUpdate.getTime())) {
    return 'crl_not_current';
  }
  const issuer = `${crl.issuerCountry}/${crl.issuerKeyId ?? ''}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${CRL_ISSUER_LOCK}${issuer}`}))`);
  const sameIssuer = and(
    eq(trustCrls.issuerCountry, crl.issuerCountry),
    crl.issuerKeyId === null
      ? isNull(trustCrls.issuerKeyId)
      : eq(trustCrls.issuerKeyId, crl.issuerKeyId),
  );
  const stored = await tx
    .select({ sha256: trustCrls.sha256, crlNumber: trustCrls.crlNumber })
    .from(trustCrls)
    .where(sameIssuer);
  if (stored.some((row) => row.sha256 === crl.sha256)) {
    return 'unchanged';
  }
  if (
    crl.crlNumber !== null &&
    stored.some(
      (row) => row.crlNumber !== null && crlNumberBelow(crl.crlNumber ?? '0', row.crlNumber),
    )
  ) {
    return 'crl_number_rollback';
  }
  await tx.delete(trustCrls).where(sameIssuer);
  await tx.insert(trustCrls).values({
    sha256: crl.sha256,
    issuerCountry: crl.issuerCountry,
    issuerKeyId: crl.issuerKeyId,
    der: Buffer.from(crl.der),
    thisUpdate: crl.thisUpdate,
    nextUpdate: crl.nextUpdate,
    crlNumber: crl.crlNumber,
    url: crl.url,
    fetchedAt: now,
  });
  return 'stored';
}

/** One `trust_anchor_syncs` row. */
async function insertSync(
  tx: Db,
  row: {
    sourceId: string | null;
    outcome: 'accepted' | 'refused' | 'failed';
    reason: string | null;
    listSha256?: string | null;
    listSigningTime?: Date | null;
    anchorsSeen?: number;
    anchorsWithdrawn?: number;
    crlsUpdated?: number;
  },
): Promise<void> {
  await tx.insert(trustAnchorSyncs).values({
    sourceId: row.sourceId,
    outcome: row.outcome,
    reason: row.reason,
    listSha256: row.listSha256 ?? null,
    listSigningTime: row.listSigningTime ?? null,
    anchorsSeen: row.anchorsSeen ?? 0,
    anchorsWithdrawn: row.anchorsWithdrawn ?? 0,
    crlsUpdated: row.crlsUpdated ?? 0,
  });
}

/** C62.7: one audit row for a sync that did not reach the store (a fetch or verification failure). */
export async function recordTrustAnchorSync(
  db: Db,
  input: {
    sourceId: string | null;
    outcome: 'refused' | 'failed';
    reason: string;
    listSha256?: string | null;
    listSigningTime?: Date | null;
  },
): Promise<void> {
  await insertSync(db, {
    sourceId: input.sourceId,
    outcome: input.outcome,
    reason: input.reason,
    listSha256: input.listSha256 ?? null,
    listSigningTime: input.listSigningTime ?? null,
  });
}

/**
 * The source an anchor is trusted through (`passive-authentication.anchor-source`, C52.8): the
 * first enabled source, by id, that lists it now; `null` when none does.
 */
export async function trustAnchorSourceOf(db: Db, anchorId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: trustAnchorSources.id })
    .from(trustAnchorMemberships)
    .innerJoin(trustAnchorSources, eq(trustAnchorSources.id, trustAnchorMemberships.sourceId))
    .where(
      and(
        eq(trustAnchorMemberships.anchorId, anchorId),
        isNull(trustAnchorMemberships.withdrawnAt),
        eq(trustAnchorSources.enabled, true),
      ),
    )
    .orderBy(asc(trustAnchorSources.id))
    .limit(1);
  return row?.id ?? null;
}

/** The console's view of the trust store (C62.10), as `GET /dashboard/trust-anchors` serves it. */
export interface TrustStoreOverview {
  hasProductionAnchor: boolean;
  sources: {
    id: string;
    enabled: boolean;
    lastSyncedAt: Date | null;
    listSigningTime: Date | null;
    listSha256: string | null;
    anchors: number;
    lastSync: {
      outcome: 'accepted' | 'refused' | 'failed';
      reason: string | null;
      anchorsSeen: number;
      anchorsWithdrawn: number;
      crlsUpdated: number;
      createdAt: Date;
    } | null;
  }[];
  countries: {
    country: string;
    anchors: number;
    linkCertificates: number;
    withdrawnAnchors: number;
    nextExpiry: Date | null;
  }[];
  withdrawnAnchors: { id: string; country: string; subjectDn: string; withdrawnAt: Date | null }[];
  crls: {
    issuerCountry: string;
    issuerKeyId: string;
    thisUpdate: Date;
    nextUpdate: Date;
    fetchedAt: Date;
    freshness: 'current' | 'expired';
  }[];
  sandboxAnchors: {
    id: string;
    country: string;
    notBefore: Date;
    notAfter: Date;
    crlNextUpdate: Date | null;
  }[];
}

/** C62.10: the trust store as the console shows it, CRL freshness judged at `now`. */
export async function trustStoreOverview(db: Db, now: Date): Promise<TrustStoreOverview> {
  const sources = await db.select().from(trustAnchorSources).orderBy(asc(trustAnchorSources.id));
  const memberships = await db
    .select({
      sourceId: trustAnchorMemberships.sourceId,
      anchorId: trustAnchorMemberships.anchorId,
      withdrawnAt: trustAnchorMemberships.withdrawnAt,
    })
    .from(trustAnchorMemberships);
  const syncs = await db
    .select()
    .from(trustAnchorSyncs)
    .orderBy(desc(trustAnchorSyncs.createdAt), desc(trustAnchorSyncs.id));
  const anchors = await db
    .select({
      id: trustAnchors.sha256,
      country: trustAnchors.country,
      subjectDn: trustAnchors.subjectDn,
      ski: trustAnchors.ski,
      notBefore: trustAnchors.notBefore,
      notAfter: trustAnchors.notAfter,
      isLink: trustAnchors.isLink,
      sandboxOnly: trustAnchors.sandboxOnly,
    })
    .from(trustAnchors)
    .orderBy(asc(trustAnchors.country), asc(trustAnchors.sha256));
  const crls = await db
    .select({
      issuerCountry: trustCrls.issuerCountry,
      issuerKeyId: trustCrls.issuerKeyId,
      thisUpdate: trustCrls.thisUpdate,
      nextUpdate: trustCrls.nextUpdate,
      fetchedAt: trustCrls.fetchedAt,
    })
    .from(trustCrls)
    .orderBy(asc(trustCrls.issuerCountry), asc(trustCrls.issuerKeyId), desc(trustCrls.thisUpdate));

  const enabled = new Set(sources.filter((source) => source.enabled).map((source) => source.id));
  const current = (membership: (typeof memberships)[number]) =>
    membership.withdrawnAt === null && enabled.has(membership.sourceId);
  const usable = new Set(memberships.filter(current).map((membership) => membership.anchorId));

  const countries = new Map<string, TrustStoreOverview['countries'][number]>();
  for (const anchor of anchors.filter((candidate) => !candidate.sandboxOnly)) {
    const entry = countries.get(anchor.country) ?? {
      country: anchor.country,
      anchors: 0,
      linkCertificates: 0,
      withdrawnAnchors: 0,
      nextExpiry: null,
    };
    if (usable.has(anchor.id)) {
      entry.anchors += 1;
      entry.linkCertificates += anchor.isLink ? 1 : 0;
      entry.nextExpiry =
        entry.nextExpiry === null || anchor.notAfter < entry.nextExpiry
          ? anchor.notAfter
          : entry.nextExpiry;
    } else {
      entry.withdrawnAnchors += 1;
    }
    countries.set(anchor.country, entry);
  }

  const withdrawnAt = (anchorId: string): Date | null =>
    memberships
      .filter(
        (membership) =>
          membership.anchorId === anchorId &&
          membership.withdrawnAt !== null &&
          enabled.has(membership.sourceId),
      )
      .reduce<Date | null>(
        (latest, membership) =>
          latest === null || (membership.withdrawnAt ?? latest) > latest
            ? membership.withdrawnAt
            : latest,
        null,
      );

  const isCurrent = (crl: { thisUpdate: Date; nextUpdate: Date | null }) =>
    crl.nextUpdate !== null &&
    crl.thisUpdate.getTime() <= now.getTime() &&
    now.getTime() < crl.nextUpdate.getTime();

  return {
    hasProductionAnchor: anchors.some((anchor) => !anchor.sandboxOnly && usable.has(anchor.id)),
    sources: sources.map((source) => {
      const last = syncs.find((sync) => sync.sourceId === source.id);
      return {
        id: source.id,
        enabled: source.enabled,
        lastSyncedAt: source.lastSyncedAt,
        listSigningTime: source.lastSigningTime,
        listSha256: source.lastListSha256,
        anchors: memberships.filter(
          (membership) => membership.sourceId === source.id && membership.withdrawnAt === null,
        ).length,
        lastSync:
          last === undefined
            ? null
            : {
                outcome: last.outcome,
                reason: last.reason,
                anchorsSeen: last.anchorsSeen,
                anchorsWithdrawn: last.anchorsWithdrawn,
                crlsUpdated: last.crlsUpdated,
                createdAt: last.createdAt,
              },
      };
    }),
    countries: [...countries.values()],
    withdrawnAnchors: anchors
      .filter((anchor) => !usable.has(anchor.id))
      .map((anchor) => ({
        id: anchor.id,
        country: anchor.country,
        subjectDn: anchor.subjectDn,
        withdrawnAt: withdrawnAt(anchor.id),
      })),
    crls: crls.flatMap((crl) =>
      crl.issuerKeyId === null || crl.nextUpdate === null
        ? []
        : [
            {
              issuerCountry: crl.issuerCountry,
              issuerKeyId: crl.issuerKeyId,
              thisUpdate: crl.thisUpdate,
              nextUpdate: crl.nextUpdate,
              fetchedAt: crl.fetchedAt,
              freshness: isCurrent(crl) ? ('current' as const) : ('expired' as const),
            },
          ],
    ),
    sandboxAnchors: anchors
      .filter((anchor) => anchor.sandboxOnly && usable.has(anchor.id))
      .map((anchor) => {
        const own = crls.find(
          (crl) => crl.issuerCountry === anchor.country && crl.issuerKeyId === anchor.ski,
        );
        return {
          id: anchor.id,
          country: anchor.country,
          notBefore: anchor.notBefore,
          notAfter: anchor.notAfter,
          crlNextUpdate: own?.nextUpdate ?? null,
        };
      }),
  };
}
