/**
 * C151.10 (Workflow 9A, api-flow-engine; Workflow 9B, api-flow-expiry; public `meta` names,
 * semantics left open there are ours): the expiry windows. Each window is the inquiry's own, set by
 * `POST /inquiries`' `meta` and stored in its `INQUIRY_EXPIRY_OVERRIDE_COLUMNS`, else its pinned
 * version's setting. An inquiry's own window changes that inquiry only.
 *
 * - At creation, `expires-at` is the creation time plus `meta.expiration-after-create-interval-
 *   seconds`, else the version's `inquiry-expiration-seconds` ({@link createdInquiryWindows}).
 * - At the start (`created -> pending`), `position.ts` moves the expiry to `started-at + window`
 *   ({@link startWindowSeconds}: `expiration-after-start-interval-seconds`, else the version's
 *   `inquiry-expiration-after-start-seconds`); with neither, the start changes nothing (review H25).
 * - On a resume (`POST /inquiries/:id/resume`, a one-time link redemption),
 *   {@link extendExpiryOnResumeInTx} moves it to `max(expires-at, now + window)`
 *   (`expiration-after-resume-interval-seconds`, else the version's
 *   `inquiry-expiration-after-resume-seconds`, 86,400 by default), so a resume never shortens the
 *   time left.
 * - A one-time link lives the lifetime its request names, else the inquiry's
 *   `one-time-link-expiration-seconds`, else the version's ({@link oneTimeLinkLifetimeSeconds}).
 *
 * Ours: a decided or redacted inquiry is left as it is, and an inquiry already at or past its
 * expiry is never revived by a start or a resume, so whether it ends expired never depends on when
 * the expiry sweep runs.
 */
import {
  resolveTemplateSettings,
  templateSettingsSchema,
  type CreateInquiryBody,
  type ResolvedTemplateSettings,
} from '@openverify/contracts';
import {
  getInquiryTemplateVersion,
  setInquiryExpiresAtInTx,
  type Db,
  type Inquiry,
} from '@openverify/db';

const OPEN: ReadonlySet<string> = new Set(['created', 'pending']);

/** The settings in force of a version's stored `settings` (the defaults where unreadable). */
export function versionExpirySettings(settings: unknown): ResolvedTemplateSettings {
  const parsed = templateSettingsSchema.safeParse(settings ?? {});
  return resolveTemplateSettings(parsed.success ? parsed.data : {});
}

/** The after-start window in force, in seconds; `null` when neither the inquiry nor its version sets one. */
export function startWindowSeconds(
  inquiry: Pick<Inquiry, 'expirationAfterStartSeconds'>,
  settings: ResolvedTemplateSettings,
): number | null {
  return (
    inquiry.expirationAfterStartSeconds ??
    settings['inquiry-expiration-after-start-seconds'] ??
    null
  );
}

/** The after-resume window in force, in seconds; `null` only for settings served before C151.10. */
export function resumeWindowSeconds(
  inquiry: Pick<Inquiry, 'expirationAfterResumeSeconds'>,
  settings: ResolvedTemplateSettings,
): number | null {
  return (
    inquiry.expirationAfterResumeSeconds ??
    settings['inquiry-expiration-after-resume-seconds'] ??
    null
  );
}

/**
 * Whether a start or a resume may move the expiry: the inquiry is open, not redacted, and not yet
 * at its expiry at `now`.
 */
export function mayMoveExpiry(
  inquiry: Pick<Inquiry, 'status' | 'expiresAt' | 'redactedAt'>,
  now: Date,
): boolean {
  return (
    inquiry.redactedAt === null &&
    OPEN.has(inquiry.status) &&
    inquiry.expiresAt.getTime() > now.getTime()
  );
}

/**
 * On a resume of an open inquiry, moves its expiry to `max(expires-at, now + after-resume)`, in `tx`
 * (the caller holds the inquiry's row lock). Answers the expiry in force.
 */
export async function extendExpiryOnResumeInTx(
  tx: Db,
  inquiry: Pick<
    Inquiry,
    | 'id'
    | 'environmentId'
    | 'inquiryTemplateVersionId'
    | 'status'
    | 'expiresAt'
    | 'redactedAt'
    | 'expirationAfterResumeSeconds'
  >,
  now: Date,
): Promise<Date> {
  const { expiresAt } = inquiry;
  if (!mayMoveExpiry(inquiry, now)) {
    return expiresAt;
  }
  const version = await getInquiryTemplateVersion(
    tx,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const window = resumeWindowSeconds(inquiry, versionExpirySettings(version?.settings));
  if (window === null) {
    return expiresAt;
  }
  const resumed = new Date(now.getTime() + window * 1000);
  if (resumed.getTime() <= expiresAt.getTime()) {
    return expiresAt;
  }
  await setInquiryExpiresAtInTx(tx, inquiry.environmentId, inquiry.id, resumed);
  return resumed;
}

/**
 * FE2 (K9-28, Workflow 9D): a start made outside the engine (`startInquiry`, under `openInquiry` and
 * `getFlowSession`'s fallback for a flow it cannot walk) applies the after-start window as the
 * engine's start does (`position.ts`): `started-at + window` when a window is in force and the
 * inquiry is not yet past its expiry, in `tx`. Answers the expiry in force.
 */
export async function applyStartWindowInTx(
  tx: Db,
  inquiry: Pick<
    Inquiry,
    | 'id'
    | 'environmentId'
    | 'inquiryTemplateVersionId'
    | 'status'
    | 'expiresAt'
    | 'redactedAt'
    | 'expirationAfterStartSeconds'
  >,
  startedAt: Date,
): Promise<Date> {
  if (!mayMoveExpiry(inquiry, startedAt)) {
    return inquiry.expiresAt;
  }
  const version = await getInquiryTemplateVersion(
    tx,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const window = startWindowSeconds(inquiry, versionExpirySettings(version?.settings));
  if (window === null) {
    return inquiry.expiresAt;
  }
  const expiresAt = new Date(startedAt.getTime() + window * 1000);
  await setInquiryExpiresAtInTx(tx, inquiry.environmentId, inquiry.id, expiresAt);
  return expiresAt;
}

/** `POST /inquiries`' `meta` (C151.10, public names). */
export type CreateInquiryMeta = NonNullable<CreateInquiryBody['meta']>;

/** What creation stores of the expiry windows: the expiry's distance and the three columns. */
export interface CreatedInquiryWindows {
  /** `expires-at` is the creation time plus this. */
  expiresInSeconds: number;
  expirationAfterStartSeconds: number | null;
  expirationAfterResumeSeconds: number | null;
  oneTimeLinkExpirationSeconds: number | null;
}

/**
 * The windows `POST /inquiries` stores: `expires-at`'s distance from `meta`'s creation window, else
 * the version's `inquiry-expiration-seconds`, and the inquiry's own three (`null`: its version
 * decides).
 */
export function createdInquiryWindows(
  meta: CreateInquiryMeta,
  settings: ResolvedTemplateSettings,
): CreatedInquiryWindows {
  return {
    expiresInSeconds:
      meta['expiration-after-create-interval-seconds'] ?? settings['inquiry-expiration-seconds'],
    expirationAfterStartSeconds: meta['expiration-after-start-interval-seconds'] ?? null,
    expirationAfterResumeSeconds: meta['expiration-after-resume-interval-seconds'] ?? null,
    oneTimeLinkExpirationSeconds: meta['one-time-link-expiration-seconds'] ?? null,
  };
}

/**
 * A one-time link's lifetime, in seconds: the request's `expires-in-seconds`, else the inquiry's
 * own window, else the version's `one-time-link-expiration-seconds`. The link still never outlives
 * its inquiry (`generateOneTimeLinkInTx`).
 */
export function oneTimeLinkLifetimeSeconds(
  inquiry: Pick<Inquiry, 'oneTimeLinkExpirationSeconds'>,
  settings: ResolvedTemplateSettings,
  requested: number | undefined,
): number {
  return (
    requested ??
    inquiry.oneTimeLinkExpirationSeconds ??
    settings['one-time-link-expiration-seconds']
  );
}
