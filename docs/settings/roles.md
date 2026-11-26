# Roles per environment

An operator holds roles, and since Workflow 9B each role is assigned either **organisation-wide**
(every current and future environment) or in a list of named environments, so a contractor can hold
a role in the sandbox only. This page covers C167 of [the Phase 9 plan](../plans/phase-9.plan.md) as
built (`api-access`). The console's role editor comes in Workflow 9C.

## Assignments

`PUT /api/v1/dashboard/users/:id/roles` (`users:write`) replaces a user's assignments:

```json
{
  "assignments": [
    { "role-id": "role_…", "environment-ids": null },
    { "role-id": "role_…", "environment-ids": ["env_…"] }
  ]
}
```

- 1 to 50 assignments, each role once; `environment-ids` is `null` (organisation-wide) or 1 to 20
  environments of the organisation.
- Existing assignments became organisation-wide when the column was added, so nobody lost access.
- `PATCH /api/v1/dashboard/users/:id` with `role-ids`, and an invitation's roles, keep their earlier
  meaning: each role organisation-wide.

A session's permissions are the union of the roles that reach its environment.

Two reads (Workflow 9D, K9-22; `users:read`) show where a user's roles apply and what they give:

- `GET /api/v1/dashboard/users/:id/roles` answers the assignments as `PUT` stored them
  (`user-role-assignments`); the console's role dialog starts from them.
- `GET /api/v1/dashboard/users/:id/permissions` answers `user-effective-permissions`: the
  organisation-level permissions (`users:*`, `roles:*`) once, as `organization`, since they count only
  through an organisation-wide assignment, and for each environment of the organisation its
  environment-level permissions and `may-enter` (a role there and, in production,
  `environments:production` held there). Each list is in `PERMISSIONS` order; the built-in admin in a
  narrower assignment gives nothing. The console's users page shows it per user.

Both are 404 for a user of another organisation.

## Organisation-level permissions

Users and roles belong to the organisation, not to an environment, so `users:read`, `users:write`,
`roles:read` and `roles:write` are **organisation-level** (`ORGANIZATION_LEVEL_PERMISSIONS` in
[`packages/core/src/permissions.ts`](../../packages/core/src/permissions.ts)). Every other permission,
`settings:write` and `environments:production` included, is environment-level.

- An organisation-level permission takes effect only through an organisation-wide assignment. The
  API refuses one in a narrower assignment with 422 `role_scope_invalid`.
- The built-in `admin` role is assignable organisation-wide only (422 `role_scope_invalid`
  otherwise): there is no admin of one environment.
- Changing an organisation setting (`require-mfa`) needs `settings:write` held organisation-wide; a
  `settings:write` held in one environment still changes that environment's own settings. See
  [how settings are changed](README.md#how-settings-are-read-and-changed).

## What an operator may grant

Nobody grants what they do not hold, and that rule is now checked **per environment**:

- assigning a role in an environment needs the operator to hold each of its permissions in that
  environment; organisation-wide, through their own organisation-wide assignments;
- taking permissions away is checked the same way, for every environment the change reaches;
- editing a role's permissions needs the editor to hold each added or removed permission in every
  environment where the role is assigned, and adding an organisation-level permission to a role
  assigned narrower than organisation-wide is 422 `role_scope_invalid`;
- removing the last active organisation-wide admin is refused with 409;
- a refusal is 403 naming the environment and the permissions the operator lacks there; a role or
  environment of another organisation is 422 at its pointer.

`GET /api/v1/dashboard/roles/grantable` (`roles:read`) answers, for every environment (oldest
first) and then for an organisation-wide assignment, each permission and role with `grantable` and,
when it is not, a `reason`: `not-held`, `organization-level` or `admin-organization-wide`. It is
what the console's editor offers, so it never offers a grant the API would refuse.

An API key holds at most what its creator holds in the key's environment.

## Signing in and switching environments

Sign-in opens the first environment the user may enter: sandbox environments first, then
production, oldest first within a kind. A user may enter an environment where an organisation-wide
assignment reaches, or a narrower one grants at least one permission; production also needs
`environments:production` held there. A user who may enter none gets 403 `no_environment_role`,
answered only once the password and, for a user with a second factor, that factor have passed, so a
stolen password alone does not learn it. `PUT /api/v1/dashboard/sessions/current/environment` refuses an environment without a role
(403 `no_environment_role`) and production without `environments:production` there (403).

## Where the per-environment rules apply

- Every route checks the permissions of the session's environment.
- A workflow promote and an inquiry template promote check the operator's permissions in the
  target environment too, from their stored assignments, so a role narrowed to the source never
  carries a promote; a theme set is copied along with a template only for an operator who holds
  `theme-sets:write` in the target environment.
- Phase 8's case rules (template visibility, queue membership, case-notification recipients) read
  the role assignments that reach the case's environment.
- Organisation-level actions are audited in **every** environment of the organisation, so
  `audit-logs:read` in any one environment shows them: `user.invited`, `user.updated`,
  `user.roles-assigned`, `user.invitation-resent`, `user.reactivated`, `user.mfa-reset`,
  `user.mfa-reset-notified`, `role.created`, `role.updated` and `role.deleted`.

## Organisation settings

A change of an organisation-level setting (`SETTING_LEVEL`, today `require-mfa`) is audited as
`settings.updated` in the session's environment with every change made, and in each other
environment of the organisation with the organisation keys only, in the same transaction.

## Built-in roles and the 9B permissions

The built-in roles are kept in step with `BUILTIN_ROLES` in `@openverify/core`. Workflow 9B added
`analytics:read` (held by `admin`, `developer`, `reviewer` and `viewer`; counts and styles hold no
personal data) and one export permission per object type (`inquiries:export`,
`verifications:export`, `accounts:export`, `reports:export`, `lists:export`,
`transactions:export`), held by `admin` only, since an export copies personal data out of the
system; none of them is a `:read`, so the viewer never holds one. A custom role may hold any of
them.

## Not built

Per-template constraints on a role and "assigned to me" scoping, a finer split of `pii:view`, SSO,
SCIM and an unused-permission review are not built.
