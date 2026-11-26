/**
 * C151.1, C152.8 (Workflow 9A Stage 1b (S)): the closed vocabularies of the server flow engine's
 * stored records, kept here because `@openverify/db`'s CHECKs read only `@openverify/core`. The
 * contracts and flow-spec hold the same lists for their schemas (`FLOW_POSITION_STATES`,
 * `DEVICE_KINDS`), and a contracts test holds them equal to these.
 */

/** C151.1: where an inquiry's flow position stands (`inquiries.flow_state`). */
export const FLOW_RECORD_STATES = ['active', 'waiting', 'halted', 'ended'] as const;
export type FlowRecordState = (typeof FLOW_RECORD_STATES)[number];

/** C150.2: the device kind of the session that served the first step (`first_device_kind`). */
export const FLOW_RECORD_DEVICE_KINDS = ['desktop-web', 'mobile-web', 'native'] as const;
export type FlowRecordDeviceKind = (typeof FLOW_RECORD_DEVICE_KINDS)[number];

/** C150.2: the client platform of that session (`first_platform`). */
export const FLOW_RECORD_PLATFORMS = ['web', 'android'] as const;
export type FlowRecordPlatform = (typeof FLOW_RECORD_PLATFORMS)[number];

/** C147.1: the flow-spec version an inquiry's position walks (`flow_spec_version`). */
export const FLOW_RECORD_SPEC_VERSIONS = [1, 2] as const;
export type FlowRecordSpecVersion = (typeof FLOW_RECORD_SPEC_VERSIONS)[number];

/**
 * C152.2, C152.8: an action row's state. `running` while a `run_workflow` waits; `completed` takes
 * `next`; `errored` takes `error`, its `error_type` naming why (the run errored or was canceled, the
 * timeout, `workflow_grant_widened`).
 */
export const FLOW_ACTION_ROW_STATUSES = ['running', 'completed', 'errored'] as const;
export type FlowActionRowStatus = (typeof FLOW_ACTION_ROW_STATUSES)[number];

/**
 * C151.1, C152.8, C150.9: the form of a code a flow record stores (an exit port such as `next`,
 * `route:minor` or `button:help`, an outcome, a note, an action's error type): ids and codes only,
 * never a value.
 */
export const FLOW_RECORD_CODE_PATTERN = '^[a-z][a-z0-9_:-]{0,127}$';

/** C147.2: a flow step id (v1's pattern, kept by v2), as the position and the records store it. */
export const FLOW_RECORD_STEP_ID_PATTERN = '^[a-z][a-z0-9_-]{0,63}$';

/** C161.1, C154.1: the built-in locales a version may enable (base tags), `en` first, the source. */
export const TEMPLATE_RECORD_LOCALES = ['en', 'es', 'fr', 'de', 'ar'] as const;
export type TemplateRecordLocale = (typeof TEMPLATE_RECORD_LOCALES)[number];

/** C154.1, C154.7: who last changed a version or published one: a user or an API key. */
export const TEMPLATE_RECORD_ACTOR_TYPES = ['user', 'api-key'] as const;
export type TemplateRecordActorType = (typeof TEMPLATE_RECORD_ACTOR_TYPES)[number];

/**
 * C153.2 (Workflow 9A Stage 1b (F)): how a file was captured (`files.capture_method`), as the upload
 * body's `capture-method` names it: `upload` (a chosen file) or `camera`. The flow-spec's
 * `CAPTURE_METHODS` holds the same list, and a contracts test holds them equal.
 */
export const FILE_CAPTURE_METHODS = ['upload', 'camera'] as const;
export type FileCaptureMethod = (typeof FILE_CAPTURE_METHODS)[number];

/**
 * C206.2 (Workflow 10B Stage 1b): whether the shutter (`manual`) or the auto-capture (`auto`) took a
 * photo (`files.capture_trigger`), as the upload body's `capture-trigger` names it; client-reported,
 * never proven (C206.3). The contracts' `CAPTURE_TRIGGERS` holds the same list, and a contracts test
 * holds them equal.
 */
export const FILE_CAPTURE_TRIGGERS = ['auto', 'manual'] as const;
export type FileCaptureTrigger = (typeof FILE_CAPTURE_TRIGGERS)[number];

/**
 * C211.4 (Workflow 10B Stage 1b (I)): the `device-integrity` provider that decoded an inquiry's
 * verdict (`inquiry_integrity_verdicts.provider`): Play Integrity, or the deterministic sandbox. The
 * contracts' `DEVICE_INTEGRITY_PROVIDERS` holds the same list, and a contracts test holds them equal.
 */
export const INTEGRITY_VERDICT_PROVIDERS = ['play-integrity', 'sandbox'] as const;
export type IntegrityVerdictProvider = (typeof INTEGRITY_VERDICT_PROVIDERS)[number];

/**
 * C160.1, C160.6 (Workflow 9A Stage 1b (H)): a theme set's status, an asset's kind and the media
 * type of what is stored (a WebP logo is re-encoded to PNG). The contracts' `THEME_SET_STATUSES`,
 * `THEME_ASSET_KINDS` and `THEME_ASSET_MEDIA_TYPES` hold the same lists, and a contracts test holds
 * them equal.
 */
export const THEME_RECORD_STATUSES = ['active', 'archived'] as const;
export type ThemeRecordStatus = (typeof THEME_RECORD_STATUSES)[number];
export const THEME_RECORD_ASSET_KINDS = ['logo', 'font'] as const;
export type ThemeRecordAssetKind = (typeof THEME_RECORD_ASSET_KINDS)[number];
export const THEME_RECORD_ASSET_MEDIA_TYPES = ['image/png', 'image/jpeg', 'font/woff2'] as const;
export type ThemeRecordAssetMediaType = (typeof THEME_RECORD_ASSET_MEDIA_TYPES)[number];

/**
 * Workflow 9B Stage 1a, (F) (9A Stage 3 amendment 21, C151.10): the nullable `inquiries` column that
 * holds each window `POST /inquiries` sets in its `meta` beyond creation (`foundation-9b` (F) adds
 * them; `api-flow-carry` applies them). `meta.expiration-after-create-interval-seconds` needs none: it
 * sets `expires_at` at creation.
 */
export const INQUIRY_EXPIRY_OVERRIDE_COLUMNS = Object.freeze({
  'expiration-after-start-interval-seconds': 'expiration_after_start_seconds',
  'expiration-after-resume-interval-seconds': 'expiration_after_resume_seconds',
  'one-time-link-expiration-seconds': 'one_time_link_expiration_seconds',
} as const);

/**
 * Workflow 9B Stage 1a, (F) (9A Stage 3 amendment 31, C152.2): the version column that stores, at
 * publish, the grant and egress of each `run_workflow` step's target, `jsonb not null default '[]'`,
 * typed `FlowRunGrantRecord[]` (`foundation-9b` (F)).
 */
export const FLOW_RUN_GRANTS_COLUMN = 'flow_run_grants';

/**
 * C152.2: the grant and egress of one `run_workflow` step's target as the publish saw them, which a
 * template version stores with its publish acknowledgements, so that each entry can check that the
 * version it resolves is no wider.
 */
export interface FlowRunGrantRecord {
  stepId: string;
  workflowId: string;
  workflowVersionId: string;
  scopes: readonly string[];
  pii: boolean;
  /** The target's egress marks' step ids (C121.4), never a path's value. */
  egress: readonly string[];
}
