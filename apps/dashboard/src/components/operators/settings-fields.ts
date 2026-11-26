/**
 * The C16 retention, C42 face matching, C55.7 text message budget and C107.7 Phase 7 settings as
 * the settings page shows them.
 */
import {
  ANALYTICS_ASSIGNEE_RETENTION_MONTHS,
  ANALYTICS_RETENTION_MONTHS,
  ANALYTICS_SETTLE_DAYS,
  ANALYTICS_SUPPRESSION_THRESHOLD,
  API_KEY_AGE_WARNING_DAYS,
  AUDIT_LOG_RETENTION_DAYS,
  DEVICE_RECOGNITION_MODES,
  DEVICE_RETENTION_DAYS,
  FACE_SEARCH_MAX_TEMPLATES,
  FACE_TEMPLATE_RETENTION_DAYS,
  GRAPH_QUERY_RETENTION_DAYS,
  IP_RETENTION_DAYS,
  OTP_SMS_MAX_PER_HOUR,
  REPORT_RETENTION_DAYS,
  SESSION_INTEGRITY_MODES,
  SIGNAL_COMPONENT_RETENTION_DAYS,
  TRANSACTION_RETENTION_DAYS,
  CASE_RETENTION_DAYS,
  WORKFLOW_IN_FLIGHT_CAP,
  WORKFLOW_RUN_HISTORY_RETENTION_DAYS,
  WORKFLOW_RUN_RETENTION_DAYS,
  WORKFLOW_SETTING_LIMITS,
  type DashboardSettings,
  type EnvironmentKind,
} from '@openverify/contracts';
import { SETTINGS_COPY } from '../../lib/copy/settings';

/** The C42.4 and C42.6 face matching settings of the environment (C47). */
export type FaceSetting = 'face-template-retention-days' | 'face-search-max-templates';

/** The C55.7 SMS budget settings of the environment, which Workflow 5A Stage 1b serves. */
export type OtpSetting = 'otp-sms-max-per-hour' | 'otp-sms-budget-tripped-at';

/** C73.6: the report retention, which the API serves since Workflow 6A Stage 1b. */
export type ReportSetting = 'report-retention-days';

/**
 * C90.8, C91.7: the signal settings, which the API serves since Workflow 7A Stage 1b (S); the
 * console shows and edits them in Workflow 7C (C108).
 */
export type SignalSetting =
  | 'signal-collection'
  | 'expose-signals'
  | 'signal-component-retention-days'
  | 'ip-retention-days'
  | 'device-retention-days';

/**
 * C107.7: the handoff's organization display name, which the API serves since Workflow 7A Stage 1b
 * (H); the console shows and edits it in Workflow 7C (C108).
 */
export type HandoffSetting = 'organization-display-name';

/**
 * C97.4: the recorded basis for face and background lists, which the API serves since Workflow 7B
 * Stage 1b (L); the console shows and edits it in Workflow 7C (C108).
 */
export type BiometricListSetting = 'biometric-lists-basis';

/**
 * C105.5: the transaction retention, which the API serves since Workflow 7B Stage 1b (T); the
 * console shows and edits it in Workflow 7C (C108).
 */
export type TransactionSetting = 'transaction-retention-days';

/**
 * C101, C102.7: the graph settings, which the API serves since Workflow 7B Stage 1b (G); the console
 * shows and edits them in Workflow 7C (C108).
 */
export type GraphSetting =
  'graph-indexing' | 'graph-weak-kinds' | 'graph-components' | 'graph-query-retention-days';

/**
 * C143.7: the workflow settings, which the API serves since Workflow 8A Stage 1b (E); the console
 * shows and edits them in Workflow 8C (C141).
 */
export type WorkflowSetting =
  | 'workflow-run-retention-days'
  | 'workflow-run-history-retention-days'
  | 'workflow-in-flight-cap'
  | 'workflow-http-ports'
  | 'workflow-http-hosts'
  | 'workflow-http-private-cidrs'
  | 'workflow-email-recipients'
  | 'workflow-sms-recipients'
  | 'workflow-sms-countries'
  | 'workflow-link-hosts'
  | 'case-retention-days';

/**
 * C158.1: the embedding settings, which the contracts define in Workflow 9A Stage 1a (F); the
 * console shows and edits them in a later Phase 9 workflow.
 */
export type EmbeddingSetting =
  'allowed-embed-origins' | 'allowed-redirect-origins' | 'default-theme-set-id';

/**
 * C174.6: the Workflow 9B platform settings (analytics, key age, mail sender, audit retention); the
 * console shows and edits them in Workflow 9C.
 */
export type PlatformSetting =
  | 'analytics-time-zone'
  | 'analytics-suppression-threshold'
  | 'analytics-retention-months'
  | 'analytics-settle-days'
  | 'analytics-assignee-retention-months'
  | 'api-key-age-warning-days'
  | 'mail-sender-name'
  | 'audit-log-retention-days';

/**
 * C232.1, C241.3 (Workflow 11A Stage 1a): Connect's environment settings, and C231.10's organisation
 * opt-in `connect-inbound`; the console shows and edits them on its Connect pages (`console-connect`).
 */
export type ConnectSetting =
  'share-token-max-seconds' | 'consent-proof-retention-days' | 'connect-inbound';

/**
 * C251.2, C253.4, C254.2 (Workflow 11B Stage 1a): the queue caps, the access export's lifetime and
 * the full-check window; Workflow 11B's own agents show and edit them, not the retention form.
 */
export type HardeningSetting =
  | 'queue-in-flight-caps'
  | 'account-export-ttl-days'
  | 'watchlist-full-check-hours'
  // C248.8 (Workflow 11B (A)): the organisation's sign-in name, shown on sso-oidc's SSO page.
  | 'organization-slug';

/** The C16 windows; the face template retention is a face matching setting. */
export type RetentionSetting = Exclude<
  keyof DashboardSettings,
  | 'require-mfa'
  | FaceSetting
  | OtpSetting
  | ReportSetting
  | SignalSetting
  | HandoffSetting
  | BiometricListSetting
  | TransactionSetting
  | GraphSetting
  | WorkflowSetting
  | EmbeddingSetting
  | PlatformSetting
  | ConnectSetting
  | HardeningSetting
>;

export interface RetentionField {
  readonly name: RetentionSetting;
  /** What is kept, such as "API logs"; the form labels it "API logs (days)". */
  readonly term: string;
  readonly description: string;
  /** Only finished inquiries may be kept forever (null). */
  readonly optional: boolean;
}

export const RETENTION_FIELDS: readonly RetentionField[] = [
  {
    name: 'inquiry-retention-days',
    term: 'Finished inquiries',
    description:
      'Redacted after this many days without a change. Leave it empty to keep them until someone redacts them. A template can set its own.',
    optional: true,
  },
  {
    name: 'api-log-retention-days',
    term: 'API logs',
    description: 'Deleted after this many days.',
    optional: false,
  },
  {
    name: 'webhook-delivery-retention-days',
    term: 'Webhook deliveries',
    description: 'Delivery attempts are deleted after this many days.',
    optional: false,
  },
  {
    name: 'event-retention-days',
    term: 'Events',
    description: 'Events a pending webhook delivery still needs are kept.',
    optional: false,
  },
];

export const ENVIRONMENT_NAMES: Readonly<Record<EnvironmentKind, string>> = {
  sandbox: 'Sandbox',
  production: 'Production',
};

/** A whole number as the console writes it ("50,000"). */
export const formatCount = (value: number) => value.toLocaleString('en-US');

export interface FaceField {
  readonly name: FaceSetting;
  /** What the read-only view calls it. */
  readonly term: string;
  /** The form's label. */
  readonly label: string;
  /** What one unit is: "days", "templates". */
  readonly unit: string;
  readonly description: string;
  /** The contract's range (`FACE_TEMPLATE_RETENTION_DAYS`, `FACE_SEARCH_MAX_TEMPLATES`). */
  readonly min: number;
  readonly max: number;
}

const range = (min: number, max: number) => `From ${formatCount(min)} to ${formatCount(max)}.`;

/** C42.6 and C42.4: the face matching settings of the environment, in the API's order. */
export const FACE_FIELDS: readonly FaceField[] = [
  {
    name: 'face-template-retention-days',
    term: 'Face template retention',
    label: 'Face template retention (days)',
    unit: 'days',
    description: `Sealed face templates and their background rows are deleted after this many days, whatever the inquiry's own retention. ${range(FACE_TEMPLATE_RETENTION_DAYS.min, FACE_TEMPLATE_RETENTION_DAYS.max)}`,
    min: FACE_TEMPLATE_RETENTION_DAYS.min,
    max: FACE_TEMPLATE_RETENTION_DAYS.max,
  },
  {
    name: 'face-search-max-templates',
    term: 'Templates searched per selfie',
    label: 'Templates searched per selfie',
    unit: 'templates',
    description: `The most stored face templates one repeat check decrypts and compares, newest first; older ones are not searched. ${range(FACE_SEARCH_MAX_TEMPLATES.min, FACE_SEARCH_MAX_TEMPLATES.max)}`,
    min: FACE_SEARCH_MAX_TEMPLATES.min,
    max: FACE_SEARCH_MAX_TEMPLATES.max,
  },
];

/**
 * C55.7 (V08): the environment's text message budget, from 1 to the installation's ceiling,
 * which only the API knows (`OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING`); above it the API answers
 * 422 at `/otp-sms-max-per-hour`. The form's own bound is the contract's.
 */
export interface OtpField {
  readonly name: Exclude<OtpSetting, 'otp-sms-budget-tripped-at'>;
  /** What the read-only view calls it. */
  readonly term: string;
  /** The form's label. */
  readonly label: string;
  /** What one unit is. */
  readonly unit: string;
  readonly description: string;
  /** The contract's range (`OTP_SMS_MAX_PER_HOUR`); the installation's ceiling may be lower. */
  readonly min: number;
  readonly max: number;
}

export const OTP_FIELD: OtpField = Object.freeze({
  name: 'otp-sms-max-per-hour',
  term: 'Text messages per hour',
  label: 'Text messages per hour',
  unit: 'text messages',
  description: `The most one-time codes this environment sends by text message in an hour, across every inquiry; a step that allows several countries gives each country at most half. From ${formatCount(OTP_SMS_MAX_PER_HOUR.min)} to the installation's ceiling (OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING, ${formatCount(OTP_SMS_MAX_PER_HOUR.ceilingDefault)} unless the operator set another).`,
  min: OTP_SMS_MAX_PER_HOUR.min,
  max: OTP_SMS_MAX_PER_HOUR.max,
});

/** C55.7: the read-only time the budget last tripped (the latest audit entry). */
export const OTP_TRIPPED_TERM = 'Budget last tripped (UTC)';

/**
 * C73.6 (P14): how long the environment keeps its reports. Retention redacts a report, never
 * deletes it; `null` (empty) keeps reports as long as their inquiries are kept.
 */
export const REPORT_RETENTION_FIELD = Object.freeze({
  name: 'report-retention-days' as const,
  term: 'Reports',
  label: 'Reports (days)',
  description: `Reports are redacted, never deleted, this many days after they were created. Leave it empty to keep them as long as their inquiries. ${range(REPORT_RETENTION_DAYS.min, REPORT_RETENTION_DAYS.max)}`,
  min: REPORT_RETENTION_DAYS.min,
  max: REPORT_RETENTION_DAYS.max,
  /** The read-only view's words for `null`. */
  kept: 'Kept as long as their inquiries',
});

/**
 * C91.7, C102.7, C105.5 (Workflow 7C): a window of the environment, bounded by the contract's
 * range; an optional one (`null`, empty in the form) keeps its data as `kept` says.
 */
export interface WindowField {
  readonly name:
    | 'signal-component-retention-days'
    | 'ip-retention-days'
    | 'device-retention-days'
    | 'transaction-retention-days'
    | 'graph-query-retention-days';
  /** What the read-only view calls it. */
  readonly term: string;
  /** The form's label. */
  readonly label: string;
  readonly description: string;
  readonly min: number;
  readonly max: number;
  /** The read-only words for `null`, for a window that may be empty; `null` otherwise. */
  readonly kept: string | null;
}

const KEPT_WITH_INQUIRIES = 'Kept as long as their inquiries';

/** C91.7: the signal windows, under `settings:write`. */
export const SIGNAL_WINDOW_FIELDS: readonly WindowField[] = [
  {
    name: 'signal-component-retention-days',
    term: 'Collector components',
    label: 'Collector components (days)',
    description: `The collector's sealed integrity and recognition readings are deleted after this many days; the behaviour totals stay with the inquiry. ${range(SIGNAL_COMPONENT_RETENTION_DAYS.min, SIGNAL_COMPONENT_RETENTION_DAYS.max)}`,
    min: SIGNAL_COMPONENT_RETENTION_DAYS.min,
    max: SIGNAL_COMPONENT_RETENTION_DAYS.max,
    kept: null,
  },
  {
    name: 'ip-retention-days',
    term: 'IP addresses',
    label: 'IP addresses (days)',
    description: `Session and network addresses, and list matches on them, are deleted after this many days; the country and network facts stay. Leave it empty to keep them as long as their inquiries. ${range(IP_RETENTION_DAYS.min, IP_RETENTION_DAYS.max)}`,
    min: IP_RETENTION_DAYS.min,
    max: IP_RETENTION_DAYS.max,
    kept: KEPT_WITH_INQUIRIES,
  },
  {
    name: 'device-retention-days',
    term: 'Devices',
    label: 'Devices (days)',
    description: `A device not seen for this many days is deleted with its fingerprints. ${range(DEVICE_RETENTION_DAYS.min, DEVICE_RETENTION_DAYS.max)}`,
    min: DEVICE_RETENTION_DAYS.min,
    max: DEVICE_RETENTION_DAYS.max,
    kept: null,
  },
];

/** C105.5: the transaction retention, under `settings:write`. */
export const TRANSACTION_RETENTION_FIELD: WindowField = Object.freeze({
  name: 'transaction-retention-days',
  term: 'Transactions',
  label: 'Transactions (days)',
  description: `Transactions are redacted this many days after they were created. Leave it empty to keep them until someone redacts them. ${range(TRANSACTION_RETENTION_DAYS.min, TRANSACTION_RETENTION_DAYS.max)}`,
  min: TRANSACTION_RETENTION_DAYS.min,
  max: TRANSACTION_RETENTION_DAYS.max,
  kept: 'Kept until redacted',
});

/** C102.7: the graph query retention, under `settings:write`. */
export const GRAPH_QUERY_RETENTION_FIELD: WindowField = Object.freeze({
  name: 'graph-query-retention-days',
  term: 'Graph query results',
  label: 'Graph query results (days)',
  description: `Stored graph query parameters and results are redacted this many days after the query. ${range(GRAPH_QUERY_RETENTION_DAYS.min, GRAPH_QUERY_RETENTION_DAYS.max)}`,
  min: GRAPH_QUERY_RETENTION_DAYS.min,
  max: GRAPH_QUERY_RETENTION_DAYS.max,
  kept: null,
});

export const WINDOW_FIELDS: readonly WindowField[] = [
  ...SIGNAL_WINDOW_FIELDS,
  TRANSACTION_RETENTION_FIELD,
  GRAPH_QUERY_RETENTION_FIELD,
];

/** C90.8: the collection tiers in words. */
export const SESSION_INTEGRITY_LABELS: Readonly<
  Record<(typeof SESSION_INTEGRITY_MODES)[number], string>
> = Object.freeze({ on: 'On', off: 'Off' });

export const DEVICE_RECOGNITION_LABELS: Readonly<
  Record<(typeof DEVICE_RECOGNITION_MODES)[number], string>
> = Object.freeze({
  off: 'Off',
  consent: 'With the optional consent tick',
  exempt: 'Exempt, on a recorded basis',
});

/** C101, C101.2, C101.6 (`settings:privacy`): the graph switches. */
export const GRAPH_SWITCHES: readonly {
  readonly name: 'graph-indexing' | 'graph-weak-kinds' | 'graph-components';
  readonly label: string;
  readonly description: string;
}[] = [
  {
    name: 'graph-indexing',
    label: 'Index the graph',
    description:
      'Writes the keyed attributes accounts share, so graph queries can find links. Off, nothing is indexed and every result says the index is incomplete.',
  },
  {
    name: 'graph-weak-kinds',
    label: 'Weak kinds',
    description:
      'Also writes the weak kinds (IP address, browser fingerprint, device class, name, birthdate, postal code, email domain), which many unrelated people share.',
  },
  {
    name: 'graph-components',
    label: 'Components (beta)',
    description:
      'Computes the connected components over the strong kinds each night. A heuristic, in beta.',
  },
];

/** C107.7, C96.1: the organization display name, under `settings:write`. */
export const DISPLAY_NAME_FIELD = Object.freeze({
  name: 'organization-display-name' as const,
  label: 'Organization display name',
  max: 100,
  description:
    'The name the phone shows the end user on the handoff context screen. A handoff step cannot be published without it. Up to 100 characters; leave it empty to clear it.',
  unset: 'Not set: a handoff step cannot be published until it is',
});

/** C97.4 (`settings:privacy`): the recorded basis for face and background lists. */
export const BIOMETRIC_BASIS_FIELD = Object.freeze({
  name: 'biometric-lists-basis' as const,
  label: 'Biometric lists basis',
  max: 500,
  description:
    'Your recorded lawful basis for face and selfie background lists, up to 500 characters. Until it is set, such a list cannot be created. Clearing it redacts every face and background list and its items.',
  unset: 'Not set: face and background lists cannot be created',
});

/** C143.7: a number of the workflow settings, bounded by the contract's range. */
export interface WorkflowNumberField {
  readonly name:
    | 'workflow-run-retention-days'
    | 'workflow-run-history-retention-days'
    | 'workflow-in-flight-cap'
    | 'case-retention-days';
  readonly label: string;
  readonly description: string;
  readonly min: number;
  readonly max: number;
  /** The read-only words for `null`, for a setting that may be empty; `null` otherwise. */
  readonly kept: string | null;
}

export const WORKFLOW_NUMBER_FIELDS: readonly WorkflowNumberField[] = [
  {
    name: 'workflow-run-retention-days',
    label: 'Run values (days)',
    description: `A finished run's inputs, outputs, variables and step values are emptied this many days after it ends; its history stays. ${range(WORKFLOW_RUN_RETENTION_DAYS.min, WORKFLOW_RUN_RETENTION_DAYS.max)}`,
    min: WORKFLOW_RUN_RETENTION_DAYS.min,
    max: WORKFLOW_RUN_RETENTION_DAYS.max,
    kept: null,
  },
  {
    name: 'workflow-run-history-retention-days',
    label: 'Run history (days)',
    description: `A finished run's record (its steps, statuses and timings) is deleted this many days after it ends. An unfinished run is never deleted. ${range(WORKFLOW_RUN_HISTORY_RETENTION_DAYS.min, WORKFLOW_RUN_HISTORY_RETENTION_DAYS.max)}`,
    min: WORKFLOW_RUN_HISTORY_RETENTION_DAYS.min,
    max: WORKFLOW_RUN_HISTORY_RETENTION_DAYS.max,
    kept: null,
  },
  {
    name: 'workflow-in-flight-cap',
    label: 'Steps in flight at once',
    description: `The most workflow steps of this environment running or queued at once; more wait their turn. ${range(WORKFLOW_IN_FLIGHT_CAP.min, WORKFLOW_IN_FLIGHT_CAP.max)}`,
    min: WORKFLOW_IN_FLIGHT_CAP.min,
    max: WORKFLOW_IN_FLIGHT_CAP.max,
    kept: null,
  },
  {
    name: 'case-retention-days',
    label: 'Resolved cases (days)',
    description: `A resolved case is redacted, never deleted, this many days after it was resolved. Leave it empty to keep cases until someone redacts them. ${range(CASE_RETENTION_DAYS.min, CASE_RETENTION_DAYS.max)}`,
    min: CASE_RETENTION_DAYS.min,
    max: CASE_RETENTION_DAYS.max,
    kept: 'Kept until redacted',
  },
];

/** C143.7: a list of the workflow settings, typed one entry per line. */
export interface WorkflowListField {
  readonly name:
    | 'workflow-http-ports'
    | 'workflow-http-hosts'
    | 'workflow-http-private-cidrs'
    | 'workflow-email-recipients'
    | 'workflow-sms-recipients'
    | 'workflow-sms-countries'
    | 'workflow-link-hosts';
  readonly label: string;
  readonly description: string;
  /** Ports are numbers; every other entry is text the contract checks. */
  readonly numbers: boolean;
  /** For a list whose `null` means something: the box that turns the list on, and what off means. */
  readonly toggle: { readonly label: string; readonly off: string } | null;
  /** C124.3: needs `settings:privacy` as well. */
  readonly privacy: boolean;
}

export const WORKFLOW_LIST_FIELDS: readonly WorkflowListField[] = [
  {
    name: 'workflow-http-ports',
    label: 'Extra HTTPS ports (one per line)',
    description: `Ports an HTTPS step may reach besides 443. A port browsers refuse is refused here too. At most ${String(WORKFLOW_SETTING_LIMITS.ports)}.`,
    numbers: true,
    toggle: null,
    privacy: false,
  },
  {
    name: 'workflow-http-hosts',
    label: 'HTTPS hosts (one per line)',
    description: `With the box ticked, an HTTPS step may reach only these hosts. At most ${String(WORKFLOW_SETTING_LIMITS.hosts)}.`,
    numbers: false,
    toggle: {
      label: 'Allow HTTPS steps only to listed hosts',
      off: 'Off: any public host',
    },
    privacy: false,
  },
  {
    name: 'workflow-http-private-cidrs',
    label: 'Private networks HTTPS steps may reach (one CIDR per line)',
    description: `Only inside private (RFC 1918, fc00::/7) or CGNAT blocks; each change is audited. At most ${String(WORKFLOW_SETTING_LIMITS.cidrs)}.`,
    numbers: false,
    toggle: null,
    privacy: true,
  },
  {
    name: 'workflow-email-recipients',
    label: 'Email recipients allowed (one address or domain per line)',
    description: `Besides a person's confirmed address, a message may go only to these. At most ${String(WORKFLOW_SETTING_LIMITS.recipients)}.`,
    numbers: false,
    toggle: null,
    privacy: false,
  },
  {
    name: 'workflow-sms-recipients',
    label: 'SMS numbers allowed (one E.164 number per line)',
    description: `Besides a person's confirmed number, a message may go only to these. At most ${String(WORKFLOW_SETTING_LIMITS.recipients)}.`,
    numbers: false,
    toggle: null,
    privacy: false,
  },
  {
    name: 'workflow-sms-countries',
    label: 'SMS countries (one ISO code per line)',
    description: `With the box ticked, a workflow text message may go only to these countries. At most ${String(WORKFLOW_SETTING_LIMITS.countries)}.`,
    numbers: false,
    toggle: {
      label: 'Choose the SMS countries here',
      off: "Off: the countries the inquiry template's phone step accepts",
    },
    privacy: false,
  },
  {
    name: 'workflow-link-hosts',
    label: 'Link hosts (one per line)',
    description: `Hosts a message link or a contest route may point to, besides the flow's own. At most ${String(WORKFLOW_SETTING_LIMITS.hosts)}.`,
    numbers: false,
    toggle: null,
    privacy: false,
  },
];

/** The workflow settings' names, for the read-only view and the form's test of what is served. */
export const WORKFLOW_SETTING_NAMES: readonly WorkflowSetting[] = [
  ...WORKFLOW_NUMBER_FIELDS.map((field) => field.name),
  ...WORKFLOW_LIST_FIELDS.map((field) => field.name),
];

const PLATFORM_COPY = SETTINGS_COPY.platform;

/** The numbers of the 9B settings, each with its contract bounds (C174.6). */
export const PLATFORM_NUMBER_FIELDS = [
  {
    name: 'analytics-suppression-threshold',
    label: PLATFORM_COPY.threshold,
    hint: PLATFORM_COPY.thresholdHint,
    bounds: ANALYTICS_SUPPRESSION_THRESHOLD,
    group: 'analytics',
  },
  {
    name: 'analytics-retention-months',
    label: PLATFORM_COPY.retentionMonths,
    hint: undefined,
    bounds: ANALYTICS_RETENTION_MONTHS,
    group: 'analytics',
  },
  {
    name: 'analytics-settle-days',
    label: PLATFORM_COPY.settleDays,
    hint: PLATFORM_COPY.settleHint,
    bounds: ANALYTICS_SETTLE_DAYS,
    group: 'analytics',
  },
  {
    name: 'analytics-assignee-retention-months',
    label: PLATFORM_COPY.assigneeMonths,
    hint: PLATFORM_COPY.assigneeHint,
    bounds: ANALYTICS_ASSIGNEE_RETENTION_MONTHS,
    group: 'analytics',
  },
  {
    name: 'api-key-age-warning-days',
    label: PLATFORM_COPY.keyAge,
    hint: PLATFORM_COPY.keyAgeHint,
    bounds: API_KEY_AGE_WARNING_DAYS,
    group: 'keys',
  },
  {
    name: 'audit-log-retention-days',
    label: PLATFORM_COPY.auditRetention,
    hint: PLATFORM_COPY.auditRetentionHint,
    bounds: AUDIT_LOG_RETENTION_DAYS,
    group: 'keys',
  },
] as const;
