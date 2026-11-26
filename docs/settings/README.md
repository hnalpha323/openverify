# Settings, access, keys and webhooks

These pages describe the organisation and environment settings that Workflow 9B of
[the Phase 9 plan](../plans/phase-9.plan.md) added or changed, as built, with what each one does and
does not do:

| Page                                                     | Covers                                                                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Allowed origins](origins.md)                            | `allowed-embed-origins`, `allowed-redirect-origins`, wildcards, a template version's own lists (C158)                      |
| [Roles per environment](roles.md)                        | environment-scoped role assignments, organisation-level permissions, sign-in, grants (C167)                                |
| [MFA, sessions and acting on users](mfa.md)              | MFA by default, the console MFA reset, the step-up, reactivation, invitations, sessions, the users list (C168.1 to C168.5) |
| [The audit log](audit-log.md)                            | the audit explorer's filters, the IP index, `audit-log-retention-days` (C168.6)                                            |
| [API keys](api-keys.md)                                  | one-call rotation, the note, the age warning, the attribute blocklist (C169.1 to C169.4)                                   |
| [Webhooks and notifications](webhooks.md)                | name and description, attempt headers, failure alerts, notification preferences (C169.5 to C169.7)                         |
| [Searching deliveries](webhooks.md#searching-deliveries) | the delivery search: by event, status, time and object id, without a payload (C169.7)                                      |
| [The sender name](sender-name.md)                        | `mail-sender-name` (C169.8)                                                                                                |

The analytics settings are on [the analytics page](../analytics/README.md#settings), and theme
sets on [the themes page](../themes/README.md).

## How settings are read and changed

`GET /api/v1/dashboard/settings` (`settings:read`) answers the organisation's and the session
environment's settings, each with its default when it was never set. `PATCH
/api/v1/dashboard/settings` (`settings:write`) changes the keys it names and leaves the others. The
change is checked before anything is written, written in one transaction, and recorded as one
`settings.updated` audit entry in the session's environment with the changed keys as its metadata.
These are dashboard routes: an API key cannot change settings.

Every setting is **environment-level** except those `SETTING_LEVEL` names
([`packages/core/src/permissions.ts`](../../packages/core/src/permissions.ts)), today only
`require-mfa`, which is **organisation-level**:

- an environment-level setting is changed by a user holding `settings:write` in that environment,
  even when that role is assigned in that environment only;
- an organisation-level setting is changed only by a user holding `settings:write` through an
  organisation-wide assignment (one whose `environment-ids` is `null`); anyone else gets 403.

See [roles per environment](roles.md) for assignments. A few older settings also need
`settings:privacy`; none of the 9B settings does.

## The 9B settings

| Setting                               | Level        | Default                                        | Bounds                                              | Page                                                                              |
| ------------------------------------- | ------------ | ---------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `allowed-embed-origins`               | environment  | none (`[]`)                                    | at most 50 origins, in the origin grammar           | [origins](origins.md)                                                             |
| `allowed-redirect-origins`            | environment  | `null`: the embed origins                      | at most 50 origins, in the origin grammar           | [origins](origins.md)                                                             |
| `analytics-time-zone`                 | environment  | `UTC`                                          | an IANA zone name the runtime and the database know | [analytics](../analytics/README.md#the-reporting-time-zone)                       |
| `analytics-suppression-threshold`     | environment  | 11                                             | 11 to 100                                           | [analytics](../analytics/README.md#suppression)                                   |
| `analytics-settle-days`               | environment  | 30                                             | 1 to 90                                             | [analytics](../analytics/README.md#freshness-the-settle-window-and-the-live-day)  |
| `analytics-retention-months`          | environment  | 13                                             | 13 to 60                                            | [analytics](../analytics/README.md#redaction-and-retention)                       |
| `analytics-assignee-retention-months` | environment  | 13                                             | 1 to 60                                             | [analytics](../analytics/README.md#employee-notice-the-per-reviewer-case-figures) |
| `api-key-age-warning-days`            | environment  | 90                                             | 1 to 3,650                                          | [API keys](api-keys.md#age)                                                       |
| `mail-sender-name`                    | environment  | `null`: the install's From name                | 1 to 100 characters, a display name only            | [sender name](sender-name.md)                                                     |
| `audit-log-retention-days`            | environment  | `null`: kept                                   | 30 to 3,650                                         | [audit log](audit-log.md#retention)                                               |
| `require-mfa`                         | organisation | `true` for organisations created since Phase 9 | `true` or `false`                                   | [MFA](mfa.md#mfa-by-default)                                                      |

Every default and bound is ours and provisional
([`packages/contracts/src/dashboard-api.ts`](../../packages/contracts/src/dashboard-api.ts)). The
console's settings pages for them come in Workflow 9C.
