# Conditions

Conditions are stored as JSONLogic. This dialect is ours, and the choice to use JSONLogic is ours: `packages/workflow-engine/src/expressions/` implements it, and `json-logic-js` is a dev-only oracle for the operators whose meaning we keep. Nothing an operator writes reaches `eval`, `Function`, a template compiler or a module loader.

## Operators

An allowlist, anything else refused at publish:

- logic and comparison: `and`, `or`, `!`, `!!`, `if`, `===`, `!==`, `<`, `<=`, `>`, `>=`, with the three-argument between form. `==` and `!=` are aliases of `===` and `!==`, so no condition coerces types;
- data: `var`, `missing`, `missing_some`. A `var` with a default is refused, because a default would turn an unknown into a value;
- arithmetic on finite numbers: `+`, `-`, `*`, `/`, `%`, `min`, `max`;
- strings and arrays: `in`, `cat`, `substr`, `merge`, `all`, `some`, `none`, `map`, `filter`, `reduce`, `count`, `first`, `last`, `includes`, `where`, `sort_asc`, `sort_desc`, `collect`, `length`, `trim`, `split`, `replace_all`, `replace_chars`, `email_domain`, `email_username`, `convert_to`;
- dates on ISO 8601 instants: `before`, `after`, `days_between`, `now` (the run's clock).

No `log`, no regular expressions, and no operator that reads outside its arguments. Past a [limit](limits.md#conditions) a condition is `expression_limit_exceeded`, never truthy or falsy.

## Paths

`{"var": "trigger.verification_government_id.country_code"}`. The roots are `trigger`, `inputs`, `vars`, `steps.<id>.output`, `loop.item` and `loop.index` inside a loop, `current_run` (`id`, `created-at`, `workflow-id`, `version-id`, `environment.kind`), and `event` in a wait filter. `current_case` is inert until Workflow 8B. No condition can read a secret. A step's output is in scope only where the step dominates; a branch's only after its join; a loop item only in its body.

### The trigger view

Event payloads are JSON:API documents, so `trigger` is a flat view: the resource's attributes at the top, each to-one relationship with its attributes, and to-many relationships as lists of `{ id, type }`. A closed alias table maps public names: `template` is the inquiry template, `token` an id, `country_code` a government ID's `country`, and `verification_<type>` the run's verification of that type. Other names read `_` as `-`. An unknown name is a publish error, and a run snapshots only what its version's paths need.

Signals flatten to one nullable member per registry name, read from the server API's view, so a run sees no more than an API client. With `expose-signals` off each reads `null`, and publish warns.

## Unknown is not false

A nullable path is one that can hold no answer: a signal, `get_list_match`'s `matched`, Run Report's `has-match`, Run Graph Query's `account-count`, an output of a step that can continue on error, an optional field.

- At publish a nullable path is refused as a direct operand of `!`, `!!`, `if`, `and`, `or` and `!==` (`nullable_in_boolean_position`).
- `=== null`, `missing` and `missing_some` test for it explicitly, and need nothing more: their null is the answer.
- Everything else that reads one declares `on-null`, with no default (`on_null_missing`).
- At run time only the explicit test with a literal `null` answers a boolean. `{"===": [x, true]}` with `x` null is an unknown and follows `on-null`, because a plain `false` would read unknown as no match.

| Position | `on-null` |
|---|---|
| A conditional route | `error` (`condition_input_null`), `route:<key>`, `skip-route` |
| Trigger criteria, recurring filter | `error`, `admit`, `skip` |
| Wait filter | `error`, `keep-waiting`, `accept` |
| `while` | `error`, `stop` |
| `where`, `filter`, `some`, `all`, `none` | an `on-null` argument: `error`, `include`, `exclude` |

Publish warns when a condition reads Calculate's `value` without `defaulted`, Run Report's result without `coverage.complete`, or `account-count` without `index-complete` and `node-limit-reached`.

## PII taint

A value is tainted when it is a `pii: true` variable, a PII attribute of a contract, or derived from one: an Evaluate Code output fed by one, a Calculate or Update Variable result, an HTTPS body with no schema marking its members non-PII, a loop item over a tainted list, a module output fed by tainted inputs. A variable given a tainted value must be declared `pii: true`.

At publish:

- a tainted value that leaves through HTTPS, email, SMS or Slack is an egress mark on the version, and needs the publisher's `pii:view` and the acknowledgement `egress:<step id>`. Each such send writes an audit entry with the step and the destination, never the values;
- taint into a plain sink is refused (`pii_into_plain_sink`): tag names, labels, enum fields, outputs and variables not declared `pii: true`;
- comparing a PII path with a string literal is refused (`pii_literal_in_condition`): identifiers of people never go into an immutable definition, so use `get_list_match`;
- a tainted value in a URL's path or query is refused (`pii_in_url`).
- PII-to-PII copies into another object are allowed, and the effect row records them for redaction.
