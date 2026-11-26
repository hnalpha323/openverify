/**
 * `dashboard-settings`' console strings (C155.9, decision 33): the console CSP (C170), roles and
 * team (C167, C168), keys, webhooks and notifications (C169) and the settings form (C174.6), in
 * English, so translating the console later is a data change. Plain text only.
 */
import { defineCopy } from './catalog';

export const SETTINGS_COPY = defineCopy({
  csp: {
    bannerLabel: 'Script policy',
    bannerTitle: 'Script policy not enforced.',
    bannerNote:
      'The console reports Content Security Policy violations but does not block them (OPENVERIFY_DASHBOARD_CSP_MODE=report-only).',
  },
  notifications: {
    title: 'Notification settings',
    description:
      'How you hear about each kind of notification in this console. These choices are yours alone and apply in every environment.',
    tableCaption: 'Notification channels by kind',
    kindColumn: 'Notification',
    consoleColumn: 'In the console',
    emailColumn: 'By email',
    kinds: {
      assigned: 'A case is assigned to you',
      'sla-breached': 'A case you can see misses its SLA',
      mentioned: 'Someone mentions you in a case comment',
      'webhook-failure': 'A webhook’s failure alert fires (needs webhooks:read)',
    },
    consoleLabel: (kind: string) => `${kind}: in the console`,
    emailLabel: (kind: string) => `${kind}: by email`,
    emailNote:
      'Emails hold a link to the console only, never the case or the failed delivery, and are sent only when this installation has a mailer.',
    // K9-26 (Workflow 9D): Phase 8's case notifications follow the choices too.
    appliedNote:
      'Case notifications and webhook failure alerts follow these choices. A case template’s list of people emailed when a case is created is the template’s, not yours.',
    save: 'Save notification settings',
    saving: 'Saving…',
    saved: 'Notification settings saved.',
  },
  users: {
    refusals: {
      step_up_required:
        'Confirm it is you first: enter a current code from your authenticator app below, then try again. An operator without a second factor of their own cannot do this.',
      user_more_privileged:
        'This user holds permissions you do not hold in an environment they can enter, so you cannot act on them.',
    },
    codeInvalid: 'That code is not valid. Enter the current code from your authenticator app.',
    codeFormat: 'Enter the six digits your authenticator app shows, or leave it empty.',
    reactivateRefusals: {
      409: 'Only a deactivated user can be reactivated.',
      502: 'The new invitation could not be emailed, so the user was not reactivated. Try again later.',
      503: 'This installation cannot send email, so no new invitation could be sent and the user was not reactivated.',
    },
    resetRefusals: {
      409: 'This user has no second factor to reset.',
    },
    resendLimited: 'This invitation was resent 5 times in the last hour. Try again later.',
    resendRefusals: {
      409: 'Only an invitation that was not accepted yet can be sent again.',
      502: 'The new invitation could not be emailed. Try again later.',
      503: 'This installation cannot send email, so no invitation could be sent.',
    },
    resetOwn: 'You cannot reset your own second factor here. Use the Security page.',
    // C245.3 (Workflow 11B): an administrator ends another user's sessions.
    endSessionsOwn:
      'You cannot end your own sessions here. Use Account, Sessions to end your other sessions.',
    reactivateThroughRoute:
      'Reactivate a deactivated user with the Reactivate button: it sends a new invitation and gives no role back.',
    userIdHint: 'Choose a user from the list.',
    stepUpKey: 'Use a security key or passkey',
    stepUpKeyPending: 'Waiting for the security key or passkey…',
    stepUpKeyReady: 'Security key or passkey ready. Confirm to continue.',
    stepUpKeyNoResponse: 'The security key or passkey did not respond. Try again, or enter a code.',
    stepUpKeyRefused:
      'The security key or passkey was not accepted. Try it again, or enter a code.',
    stepUpKeyMalformed:
      'The security key’s answer could not be read. Try it again, or enter a code.',
    stepUpLabel: 'Code from your authenticator app',
    stepUpDescription:
      'Needed when you have not confirmed a second factor in the last 10 minutes. Paste or type the six digits.',
    factorKinds: { totp: 'authenticator app', webauthn: 'security key or passkey' },
    lastSignInColumn: 'Last sign-in (UTC)',
    never: 'Never',
    reactivateLabel: (label: string) => `Reactivate ${label}`,
    reactivateTitle: (label: string) => `Reactivate ${label}?`,
    reactivateDescription:
      'They get a new invitation by email, valid 7 days, and keep their history. No role comes back: grant their roles again once they accept.',
    reactivateConfirm: 'Send a new invitation',
    reactivated: (label: string) => `${label} was sent a new invitation.`,
    resetLabel: (label: string) => `Reset the second factor of ${label}`,
    resetTitle: (label: string) => `Reset the second factor of ${label}?`,
    resetDescription:
      'Removes their authenticator apps, security keys and recovery codes and signs them out everywhere. If the organization requires a second factor, they add a new one at their next sign-in.',
    resetConfirm: 'Reset the second factor',
    resetDone: (label: string) => `The second factor of ${label} was reset.`,
    endSessionsLabel: (label: string) => `End the sessions of ${label}`,
    endSessionsTitle: (label: string) => `End every session of ${label}?`,
    endSessionsDescription:
      'Signs them out in every browser at once. They can sign in again; to stop that, deactivate the user.',
    endSessionsConfirm: 'End sessions',
    endSessionsDone: (label: string) => `Every session of ${label} was ended.`,
    roleScopeInvalid:
      'A role with the admin role or an organisation-level permission can only be granted in every environment.',
    scopesLegend: 'Where each role applies',
    scopesNote:
      'The environments of the current assignments are not shown here yet: choose them again when you save.',
    // K9-22 (DS8): the dialog reads the current assignments when it opens.
    scopesReading: 'Reading where each role applies today…',
    scopesNoteCurrent: 'Each role starts where it applies today.',
    scopesNoteUnread:
      'The environments of the current assignments could not be read: choose them again when you save.',
    scopeSeveral: (role: string) =>
      `${role} applies today in several environments, which one choice cannot say: choose where it applies.`,
    // K9-22 (DS8): a user's effective permissions on /users.
    effectiveLink: 'Effective permissions',
    effectiveTitle: (label: string) => `Effective permissions of ${label}`,
    effectiveDescription:
      'What their roles give them now: the user and role permissions count organisation-wide only, every other permission in each environment where a role reaches.',
    effectiveOrganisation: 'Organisation-wide',
    effectiveEntry: (environment: string, mayEnter: boolean) =>
      `${environment}: ${mayEnter ? 'can enter' : 'cannot enter'}`,
    effectiveNone: (scope: string) => `${scope}: holds no permission here.`,
    effectiveClose: 'Hide effective permissions',
    scopeLabel: (role: string) => `Where ${role} applies`,
    scopeChoose: 'Choose…',
  },
  sessions: {
    title: 'Your sessions',
    description:
      'Where your account is signed in to this console. A session ends after 12 hours, when you sign out, or when you end it here.',
    deviceColumn: 'Device',
    createdColumn: 'Signed in (UTC)',
    lastSeenColumn: 'Last seen (UTC)',
    amrColumn: 'Sign-in methods (identity provider)',
    amrNone: 'None stated',
    unknownDevice: 'Unknown device',
    current: 'This session',
    revokeLabel: 'Sign out this session',
    revokeAccessible: (device: string, id: string) => `Sign out this session (${device}, ${id})`,
    revokeTitle: 'Sign out this session?',
    revokeDescription: 'It ends at once; whoever uses it must sign in again.',
    revokeConfirm: 'Sign out',
    revoked: 'The session was signed out.',
    othersLabel: 'Sign out every other session',
    othersTitle: 'Sign out every other session?',
    othersDescription:
      'Every session but this one ends at once, on any device. This one stays signed in.',
    othersConfirm: 'Sign out the others',
    othersDone: 'Your other sessions were signed out.',
    enrolmentNote: 'Adding a second factor on the Security page signs out your other sessions.',
    sessionIdHint: 'Choose a session from the list.',
    securityLink: 'See and end your sessions',
  },
  audit: {
    ipSearchLabel: 'Find entries from one IP address',
    ipLabel: 'IP address',
    ipDescription:
      'One exact IPv4 or IPv6 address. It is sent to the console by post and never appears in the page address.',
    ipSubmit: 'Find entries',
    ipSearching: 'Finding…',
    ipInvalid: 'Enter one IPv4 or IPv6 address, such as 203.0.113.9.',
    ipResultsCaption: 'Audit log entries from this address',
    ipNone: 'No audit entry came from this address.',
    ipSome: (count: number) =>
      count === 1
        ? 'One entry came from this address.'
        : `${String(count)} entries came from this address.`,
    ipMore:
      'The newest 25 entries from this address are shown; more exist. Narrow the search with the filters above.',
    ipUnavailable:
      'This installation has no blind-index key, so audit entries cannot be found by address.',
    ipNeedsPii:
      'Finding entries by IP address needs pii:view, because an address can identify a person.',
    prefixLabel: 'Action prefix',
    prefixDescription: 'Every action starting with this, such as settings. or inquiry.',
  },
  keys: {
    rotate: 'Rotate',
    rotateTitle: 'Rotate this API key?',
    rotateDescription:
      'A new key gets the same scopes, allowed IP ranges, API version, note and attribute blocklist, and a new token. The old token keeps working until the time you choose, so you can switch your systems over.',
    rotateConfirm: 'Rotate key',
    rotating: 'Rotating…',
    previousLabel: 'The old token keeps working',
    previousChoices: {
      0: 'No longer: it stops now',
      3600: 'For 1 hour',
      86400: 'For 1 day',
      604800: 'For 7 days',
      2592000: 'For 30 days',
    },
    newName: 'Name of the new key',
    newNameDescription: 'Leave empty to keep this key’s name.',
    rotatedTitle: 'API key rotated',
    rotatedLabel: 'New token',
    rotatedUntil: (time: string) =>
      `The old token keeps working until ${time} (UTC). This is the only time the new token is shown: copy it now.`,
    choiceInvalid: 'Choose how long the old token keeps working from the list.',
    note: 'Note',
    noteDescription: 'What the key is for, up to 255 characters. Leave empty for none.',
    noNote: 'No note',
    blocklist: 'Attribute blocklist',
    blocklistDescription:
      'Attribute names this key never receives, one per line, such as name-first or birthdate. Ids, types and relationships stay.',
    noBlocklist: 'Every attribute is served',
    ageWarning: (days: number) =>
      `${String(days)} days old: older than the age warning this environment sets. Rotate it and switch your systems to the new token.`,
    ageTerm: 'Age',
    ageDays: (days: number) => (days === 1 ? '1 day' : `${String(days)} days`),
  },
  webhooks: {
    name: 'Name',
    nameDescription: 'How this webhook is called in the console, up to 200 characters.',
    nameRequired: 'Give the webhook a name.',
    description: 'Description',
    descriptionHint: 'What the receiver does with the events, up to 1,000 characters.',
    alertLegend: 'Failure alert',
    alertEnabled: 'Alert when first attempts fail',
    alertThreshold: 'Failed first attempts',
    alertWindow: 'Within (minutes)',
    alertNote:
      'Counts failed first attempts in the window, not retries. Notifies, at most once a window, the users with webhooks:read who chose webhook failure notifications.',
    thresholdInvalid: 'Enter a whole number of failed first attempts from 1 to 10,000.',
    windowInvalid: 'Enter a whole number of minutes from 5 to 1,440.',
    alertOff: 'Off',
    alertOn: (threshold: number, minutes: number) =>
      `On: after ${String(threshold)} failed first attempts within ${String(minutes)} minutes`,
    alertSwitchedOff: (threshold: number, minutes: number) =>
      `Off (set to ${String(threshold)} failed first attempts within ${String(minutes)} minutes)`,
    previousSecret: (time: string) =>
      `The previous signing secret keeps signing until ${time} (UTC). Until then every delivery carries a signature for each secret, so receivers must accept either.`,
  },
  platformView: {
    embedOrigins: 'Allowed embed origins',
    noEmbedOrigins: 'None: no site may frame the flow',
    redirectOrigins: 'Allowed redirect origins',
    redirectSameAsEmbed: 'The embed origins above',
    noRedirectOrigins: 'None: a flow sends no one back to a site',
    defaultThemeSet: 'Default theme set',
    noDefaultThemeSet: 'None: the built-in look',
    timeZone: 'Reporting time zone',
    threshold: 'Suppression threshold',
    retentionMonths: 'Analytics retention',
    settleDays: 'Settle window',
    assigneeMonths: 'Per-reviewer analytics retention',
    keyAge: 'API key age warning',
    auditRetention: 'Audit log retention',
    auditKeptForever: 'Every entry is kept',
    senderName: 'Sender name',
    installationSender: 'The installation’s own',
    months: (count: string) => `${count} months`,
    days: (count: string) => `${count} days`,
  },
  platform: {
    organizationLevel:
      'An organisation setting: only an operator whose settings:write comes from an organisation-wide role can change it.',
    noMfa:
      'This organisation does not require a second factor: an operator can sign in with a password alone.',
    embedding: (environment: string) => `Embedding and redirects in ${environment}`,
    embedOrigins: 'Allowed embed origins',
    embedOriginsHint:
      'One origin per line, such as https://shop.example.com or https://*.example.com. A wildcard needs two labels after *. and never covers a shared-hosting suffix; production refuses http: and localhost; sandbox also accepts http://localhost and http://127.0.0.1. At most 50.',
    redirectOwn: 'Use a redirect list of its own',
    redirectOwnHint: 'Unticked, a flow may send a person back only to the embed origins above.',
    redirectOrigins: 'Allowed redirect origins',
    redirectOriginsHint:
      'One origin per line, in the same form. An entry without a wildcard matches its scheme, host and port exactly.',
    acknowledgeWildcards: 'I accept wildcard origins in production',
    acknowledgeHint:
      'A wildcard lets every site under it frame the flow or receive the person back. Needed for each production change that holds one.',
    allowlistLimits:
      'An allowlist decides which sites may frame the flow and where it may send a person back afterwards. It does not stop a compromised allowed site, a copy of the hosted page on another domain, or a browser that ignores Content Security Policy.',
    analytics: (environment: string) => `Analytics in ${environment}`,
    timeZone: 'Reporting time zone',
    timeZoneHint:
      'Whole local days of this zone make every analytics day. Changing it rebuilds the days still open.',
    threshold: 'Suppression threshold',
    thresholdHint:
      'Counts below it show as "fewer than" the threshold. The floor of 11 is never lowered.',
    retentionMonths: 'Analytics retention (months)',
    settleDays: 'Settle window (days)',
    settleHint:
      'A day is recomputed for this many days, then frozen. Raising it reopens closed days.',
    assigneeMonths: 'Per-reviewer analytics retention (months)',
    assigneeHint: 'The per-reviewer figures are employees’ personal data, kept for this long.',
    keysAuditMail: (environment: string) => `Keys, audit log and mail in ${environment}`,
    keyAge: 'API key age warning (days)',
    keyAgeHint: 'Keys older than this are marked in the key list.',
    auditRetention: 'Audit log retention (days)',
    auditRetentionHint: 'Leave it empty to keep every entry.',
    senderName: 'Sender name',
    senderNameHint:
      'The display name of the console’s emails from this environment, up to 100 characters. The address stays the installation’s. Leave it empty for the installation’s own.',
    invalid: {
      'analytics-suppression-threshold':
        'Enter a whole number from 11 to 100. The floor of 11 is never lowered.',
      'analytics-retention-months': 'Enter a whole number of months from 13 to 60.',
      'analytics-settle-days': 'Enter a whole number of days from 1 to 90.',
      'analytics-assignee-retention-months': 'Enter a whole number of months from 1 to 60.',
      'api-key-age-warning-days': 'Enter a whole number of days from 1 to 3,650.',
      'audit-log-retention-days':
        'Enter a whole number of days from 30 to 3,650, or leave it empty to keep every entry.',
      'analytics-time-zone':
        'Enter an IANA time zone name, such as Europe/Paris or UTC; offsets are refused.',
      'mail-sender-name':
        'Enter a display name of up to 100 characters, without control characters, <, >, @ or ".',
    },
    refusals: {
      embed_wildcard_unacknowledged:
        'A wildcard origin in production needs your acknowledgement: tick “I accept wildcard origins in production” and save again.',
      embed_origin_invalid: 'An origin is not allowed. Each refused entry is named at its field.',
    },
  },
});
