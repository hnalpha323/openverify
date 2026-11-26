/**
 * Template version settings (contract C11). Every setting is optional when sent; reads apply
 * the defaults, so a client always sees the values in force.
 */
import { z } from 'zod';
import { hasDistinctValues } from './json-api.js';
import { shareVerificationTypeSchema } from './connect.js';

export const MIN_EXPIRATION_SECONDS = 5 * 60;
export const MAX_EXPIRATION_SECONDS = 30 * 24 * 60 * 60;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

const expirationSeconds = z.int().min(MIN_EXPIRATION_SECONDS).max(MAX_EXPIRATION_SECONDS);
/** Days to keep a finished inquiry before redaction; `null` defers to the environment (C16). */
export const retentionDaysSchema = z.int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS);
/** C91.5 (Phase 7): 1 to 100 sessions per inquiry, 25 by default. */
export const MAX_SESSIONS_RANGE = Object.freeze({ min: 1, max: 100 });
export const maxSessionsSchema = z.int().min(MAX_SESSIONS_RANGE.min).max(MAX_SESSIONS_RANGE.max);

/** C235.3 (decision 25): how old a cloned result's source decision may be, in days. */
export const ACCEPT_CLONED_RESULTS_MAX_AGE_DAYS = Object.freeze({ min: 1, max: 3650 });

/**
 * C235.3 (Phase 11, Workflow 11A; ours; orchestrator decision 22): the version relies on cloned
 * results of these verification types (a Connect clone's), each counting toward its step only when
 * it passed and its source decision is younger than `max-age-days` at this version's decision
 * (C235.4). Absent or `null`, off: a clone counts toward nothing. Publishing a version that sets it
 * needs the acknowledgement `cloned-results:<type>` per type, and `selfie` only with
 * `cloned-results-unbound` (C235.8).
 */
export const acceptClonedResultsSchema = z.strictObject({
  'verification-types': z
    .array(shareVerificationTypeSchema)
    .min(1)
    .refine(hasDistinctValues, 'must not contain duplicates'),
  'max-age-days': z
    .int()
    .min(ACCEPT_CLONED_RESULTS_MAX_AGE_DAYS.min)
    .max(ACCEPT_CLONED_RESULTS_MAX_AGE_DAYS.max),
});
export type AcceptClonedResults = z.infer<typeof acceptClonedResultsSchema>;

export const templateSettingsSchema = z.strictObject({
  /** An inquiry's `expires-at` is its creation time plus this. */
  'inquiry-expiration-seconds': expirationSeconds.optional(),
  /** Lifetime of a flow session token. */
  'session-expiration-seconds': expirationSeconds.optional(),
  /** Default lifetime of a one-time link. */
  'one-time-link-expiration-seconds': expirationSeconds.optional(),
  'retention-days': retentionDaysSchema.nullable().optional(),
  /**
   * C91.5 (Phase 7): the most sessions an inquiry may have, expired and canceled ones included;
   * one more is refused with 409 `session_limit_reached` (a resume, a one-time link or a handoff).
   */
  'max-sessions': maxSessionsSchema.optional(),
  /** C91.5: the refused attempt also expires the inquiry. */
  'expire-inquiry-on-session-limit': z.boolean().optional(),
  /**
   * C151.10 (public `meta` names, Workflow 9A): on `created -> pending` the expiry becomes
   * `started-at + value`; absent or `null` (as the resolved settings serve it, so a copied version
   * takes them back), the start changes nothing (ours: the public default is the creation window,
   * review H25).
   */
  'inquiry-expiration-after-start-seconds': expirationSeconds.nullable().optional(),
  /** C151.10: on a resume the expiry becomes `max(expires-at, now + value)`; 86,400 by default. */
  'inquiry-expiration-after-resume-seconds': expirationSeconds.optional(),
  /** C235.3 (Workflow 11A): see {@link acceptClonedResultsSchema}; `null` turns it off. */
  'accept-cloned-results': acceptClonedResultsSchema.nullable().optional(),
});
export type TemplateSettings = z.infer<typeof templateSettingsSchema>;

export const resolvedTemplateSettingsSchema = z.strictObject({
  'inquiry-expiration-seconds': expirationSeconds,
  'session-expiration-seconds': expirationSeconds,
  'one-time-link-expiration-seconds': expirationSeconds,
  'retention-days': retentionDaysSchema.nullable(),
  'max-sessions': maxSessionsSchema,
  'expire-inquiry-on-session-limit': z.boolean(),
  // C151.10 (Workflow 9A): optional, so settings served before it still parse; servers since send them.
  'inquiry-expiration-after-start-seconds': expirationSeconds.nullable().optional(),
  'inquiry-expiration-after-resume-seconds': expirationSeconds.optional(),
  // C235.3 (Workflow 11A): optional, so settings served before it still parse; servers since send it.
  'accept-cloned-results': acceptClonedResultsSchema.nullable().optional(),
});
export type ResolvedTemplateSettings = z.infer<typeof resolvedTemplateSettingsSchema>;

export const TEMPLATE_SETTINGS_DEFAULTS: Readonly<ResolvedTemplateSettings> = Object.freeze({
  'inquiry-expiration-seconds': 24 * 60 * 60,
  'session-expiration-seconds': 24 * 60 * 60,
  'one-time-link-expiration-seconds': 24 * 60 * 60,
  'retention-days': null,
  'max-sessions': 25,
  'expire-inquiry-on-session-limit': false,
  'inquiry-expiration-after-start-seconds': null,
  'inquiry-expiration-after-resume-seconds': 24 * 60 * 60,
  'accept-cloned-results': null,
});

/** The settings in force: the defaults, overridden by what the version sets. */
export function resolveTemplateSettings(settings: TemplateSettings = {}): ResolvedTemplateSettings {
  const defaults = TEMPLATE_SETTINGS_DEFAULTS;
  const retentionDays = settings['retention-days'];
  return {
    'inquiry-expiration-seconds':
      settings['inquiry-expiration-seconds'] ?? defaults['inquiry-expiration-seconds'],
    'session-expiration-seconds':
      settings['session-expiration-seconds'] ?? defaults['session-expiration-seconds'],
    'one-time-link-expiration-seconds':
      settings['one-time-link-expiration-seconds'] ?? defaults['one-time-link-expiration-seconds'],
    'retention-days': retentionDays === undefined ? defaults['retention-days'] : retentionDays,
    'max-sessions': settings['max-sessions'] ?? defaults['max-sessions'],
    'expire-inquiry-on-session-limit':
      settings['expire-inquiry-on-session-limit'] ?? defaults['expire-inquiry-on-session-limit'],
    'inquiry-expiration-after-start-seconds':
      settings['inquiry-expiration-after-start-seconds'] ??
      defaults['inquiry-expiration-after-start-seconds'] ??
      null,
    'inquiry-expiration-after-resume-seconds':
      settings['inquiry-expiration-after-resume-seconds'] ??
      defaults['inquiry-expiration-after-resume-seconds'],
    'accept-cloned-results':
      settings['accept-cloned-results'] ?? defaults['accept-cloned-results'] ?? null,
  };
}
