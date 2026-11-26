# Recipes

A recipe is a documented workflow you install as a disabled draft: `GET /workflow-recipes`, then `POST /workflow-recipes/:key/install`. A draft passes every publish rule before it can run, and a placeholder reference fails `reference_unknown` until you name your own object. `seed:dev` installs the recipes as paused drafts in the sandbox environment, so nothing runs by itself.

| Key | What it does |
|---|---|
| `rescreen-on-account-field-change` | On `account.updated-fields`, re-screens each monitored report of the account whose query reads a field that changed, with the current value |

**How the re-screen recipe chooses.** Its one step, `rescreen_account_reports`, reads the account's monitored reports (recurring, not paused, not redacted). A report's query member reads the account field of the same name with `-` as `_` (`name-last` reads `name_last`), as the report engine's query sources do. For each report whose query holds a value the account now holds otherwise, it creates a new report from the same template with the current value (`origin: workflow`) and waits for each; the old report and its monitoring stay as they are. It names nothing, so it installs ready to publish. Its output lists the new reports with `status` and `has-match`; `any-match` is `null` unless every new report is `ready`, and `null` when nothing changed, never `false`. More than 100 monitored reports is the step error `report_selector_limit`.

Custom-list re-screening needs no recipe: the report engine answers `list.updated` itself, so a monitored report never keeps reading "no match" against an old list version. "Review on report match" holds a case, so it joins with cases.

The stopgap rules stay, off by default, for installs without workflows: `on-report-match`, `on-list-match` and `on-signal`. Workflows are the preferred route. A workflow reacting to `.matched` sees an inquiry the rule already moved to `needs_review` and reads `no_change`, never a double transition.
