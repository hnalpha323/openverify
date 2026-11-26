# Templates and statuses

## Templates

A template (`ctmpl_`) has a `name` (1 to 80 characters), a `key` (`^[A-Z][A-Z0-9]{1,9}$`, unique in the environment and never changed), a `status` (`active` or `archived`) and `visible-to-roles`. A case's name is the key and a per-template counter: `KYC-6`. Archiving (`POST /case-templates/:id/archive`) refuses new cases (`case_template_archived`) and keeps the existing ones.

## Versions

A template's content lives in versions (`ctmplv_`): one draft at most, one published, the rest superseded. A published version never changes, and each case pins the version it was created on. Routes: `GET`, `POST /case-template-versions`, `GET`, `PATCH /case-template-versions/:id` (a draft only, else `case_template_version_not_draft`) and `POST /case-template-versions/:id/publish` (under the template's lock, `case-templates:publish`). A version holds:

- `field-schemas`: the field-schema union transaction types use, with `searchable` marks. A case refuses `file` (attachments carry files) and `json`, at any depth; `platform-file` keeps the transaction rule (writing one needs the file's read scope, plus `pii:view` for faces). A field key keeps its type across every version of a template (`field_type_changed`); a field dropped by a new version stays readable on cases pinned to an older one, and publishing fires `case-template.deleted-field` with `field-key` and `version-number`.
- `statuses`: each `{ key, label, category, pauses-sla, required-comment, status-tags, status-tag-required }`. Exactly one `initial`, at least one `end`. The defaults are `open` (Open, initial), `pending` (Pending, intermediate, pauses the SLA), `approved` (Approved, end) and `declined` (Declined, end). A status is a lower-case key; `meta.status` takes the key, never the label.
- `resolutions` (default `Approved`, `Declined`).
- `transitions`: a map from each status key to the keys it may move to; the default lets every status reach every other. Publishing refuses an `end` status no path from `initial` reaches.
- `default-queue-id`, `assignment-policy-id`, `sla-policy-id`, `sla-starts-on` (`created`, `entered-queue`, `assigned`).
- `held-object-types`, `attachment-policy` (at most 20 files, of `jpeg`, `png`, `webp`, `pdf`), `notify-on-create` (users who cannot read the template's cases are refused at publish; each listed user is emailed a link when a case is created, see [comments and notifications](comments.md#emails)) and `layout-modules`.

A publish refusal is a 422 whose `errors[]` carry a `code` and a JSON Pointer under `/data/attributes`: the field-schema codes, `initial_status_count`, `end_status_missing`, `status_repeated`, `transition_status_unknown`, `transition_to_itself`, `transition_repeated`, `end_status_unreachable` and `field_type_changed`.

## Statuses and transitions

`POST /cases/:id/set-status` takes `meta.status`, and `meta.resolution`, `meta.comment` and `meta.status-tag` where the status asks for them. The checks run in this order: the status exists, the version's map allows the move (`case_transition_refused`), the resolution (`case_resolution_invalid`), the status tag (`case_status_tag_required`), the comment (`case_comment_required`). Each answers with a pointer under `/meta`.

- **Into an `end` status:** `resolution` is `meta.resolution` when given (it must be one of `resolutions`), else the status's label when it is one of them, else null; `resolved-at` and the resolver are set. Events: `case.status-updated`, then `case.resolved`. A move between two `end` statuses resolves again without reopening.
- **Out of an `end` status:** `case.status-updated`, then `case.reopened`; `resolution`, `resolved-at` and the resolver are cleared (history keeps them), and the SLA follows its `on-reopen`.
- **The same status again** is no change, whatever `meta` holds.
- A required comment becomes a case comment, with `case-comment.created`.
- A status the map does not name has no exits.

Every change takes the case row `FOR UPDATE` and checks `meta.lock-version` when sent (`case_version_conflict`, 409, with the current `lock-version`). Resolving decides nothing else: approving or declining a held inquiry is the inquiry's own action, with its own scope, events and decision record. A workflow can carry a resolution into a decision (see [case workflows](workflows.md)).

## History

`GET /cases/:id/history` serves the timeline, newest first, paged by the row's number (`page[after]`). It is append-only (a database trigger refuses every update and every delete outside environment deletion and retention) and holds no value: field changes record keys, comments and attachments their ids, status changes their keys, assignments the strategy and its inputs. Actors are the case's actor types plus `case-assignment-policy` and `system`.

## Fields and tags

`fields` is a `{ type, value }` map per key, validated by the pinned version, sealed as one value per case and masked member by member without `pii:view` (a masked field reads `{ type, value: null }`). A change fires `case.updated-fields` with the changed keys only. A `searchable` field is keyed with an HMAC under the environment's blind-index subkey, labelled `identifier-case-field` with the template and field in the input, so equal values in different fields or templates never key alike; `pnpm --filter @openverify/api blind-index:rebuild` recomputes them after the transaction field keys. An install upgraded from before Workflow 8B Stage 4 runs it once, because earlier case keys were computed under the transaction label.

Tags: `add-tag` and `remove-tag` take `meta.tag-name` or `meta.tag-id` (OpenVerify's tags are names, so `tag-id` reads as the name), `set-tags` takes the arrays; at most 50; `case.updated-tags` carries `context.added-tags` and `context.removed-tags`.
