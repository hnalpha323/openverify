# Steps and components (plan C147.3, C148, C149)

## Step types and ports

- **The v1 types**, with their v1 members: `consent`, `government_id`, `selfie`, `document`, `phone_otp`, `email_otp`, `database`, `aamva`, `nfc`, `crypto_wallet`, `database_business`, `business_website`, `completion`, `failure`, and Phase 7's `device_handoff`. v2 adds optional members: `captureMethodsByDevice` (keys `desktop-web`, `mobile-web`, `native`), `onFallback` (`review` or `continue`), `prefillFrom`, and on `failure` `decisionBasis`, `contestRoute` and `biometricBasis`.
- **`screen`**: components a person reads and fills in, submitted to the server.
- **`branch`**: ordered routes and a catch-all, evaluated on the server ([branching](branching.md)).
- **`action`**: one of five closed-list actions ([actions](actions.md)).

A v1 `form` is not a v2 type; the migration turns it into a `screen`.

| Port | On |
|---|---|
| `next` | every non-terminal step but `branch`; required on screens, consent, handoff and verification steps |
| `exhausted` | a verification step, optional: taken when its attempts end without passing (a fallback) |
| `button:<key>` | a screen's extra submit buttons |
| `route:<key>`, `else` | a branch; `else` is required |
| `error` | an action, required (`action_error_edge_missing`) |

Each port takes exactly one edge; any edge may target any step, backwards included, within the cycle rule. `completion` and `failure` have no ports.

## The screen step (C148)

A screen holds components, at most 40 (nested ones counted) and containers at most 3 deep. Display components: `text` (`title`, `body`, `caption`), `image` (a theme asset), `spacer`, `stepper`, `container`, `footer`. Form components, each bound to a template field (`field`) with a `labelKey`, an optional `hintKey` and `required`: `text_input`, `text_area`, `masked_text`, `number`, `date`, `email`, `phone`, `url`, `checkbox`, `select`, `radio_group`, `multi_select`, `checkbox_group`, `country_select`, `address` (bound to `street1`, `street2`, `city`, `subdivision`, `postalCode`, `country`). A `button` has `action` `submit`, `cancel` or `link` (`help-url`, `privacy-url`); a submit button with a `port` leaves through `button:<key>`, the primary one through `next`. A confirmed `cancel` stops for now: the inquiry stays resumable with the same link, and an embedding page hears `cancel`.

Every visible string is a copy key, resolved through the catalogs and the version's operator copy ([i18n](../i18n/README.md)). A component's own texts are overridden on `<step id>.<component id>.<attribute>` (`label`, `hint`, `title`, ...); a `text` component whose `copyKey` is that key shows the override.

**Visibility** (`visibleWhen`) is the only thing a client evaluates, and only through `@openverify/flow-spec`'s strict visibility evaluator over the values of the same screen: a rule outside its subset throws `VisibilityRuleError` (publish refuses it as `visibility_rule_invalid`; a client shows the screen as unavailable, never a guess). **Patterns** run only on the linear-time matcher of `compilePattern` / `matchPattern` (a Pike VM over code points; the restricted grammar of C148.3; the whole value must match; input capped at 10,000 characters, `PATTERN_INPUT_LIMIT`; programs at 2,048 instructions). A quantifier on a group that already holds one is refused (`nested_quantifier`), which also refuses `\d{5}(?:-\d{4})?`; relaxing it is an owner decision. Arabic-Indic and Eastern Arabic-Indic digits are normalised to ASCII as they are typed (`normalizeDigits`).

**Submitting** a screen is `POST /api/v1/flow/screens/:stepId/submit` with `values` by field key and an optional `button`. Only the current step takes a submission (409 `flow_step_not_current`). A value for a field the screen does not bind, or a hidden one, is discarded; an empty optional value writes nothing; lengths count code points; `email` and `phone` use Phase 5's validators; a `url` must be `https`; a date is `YYYY-MM-DD` within its bounds. A refusal is a 422 at `/values/<field>` or `/button`, never echoing the value. A resubmission of a step already left answers the session with 200. The answer is the session at the next position.

## Template fields and prefill (C149)

A version's `field-schemas` declare its fields: a key (immutable once published, `field_type_changed`), one of ten public types, a label, a PII mark, `max-length`, a `default`, `write-once`, `strip-html` and `choices`; at most 1,000 (`MAX_TEMPLATE_FIELDS`). Every write path (inquiry create and `PATCH`, a screen submission, `copy_extractions`) runs the same rules (`validateInquiryFieldsWrite`): `fields_too_large` past 256 KiB with its size and limit, `fields_too_many`, and with field schemas `field_unknown`, `field_write_once`, `field_type_invalid`, `field_too_long`. Prefill comes from the API only: the customer's server creates the inquiry with its `fields`, and the session's `values` carry, for the current screen, only the fields that screen binds (a `masked_text` or write-once value is sent as `{ "set": true }`). A verification step's `prefillFrom` names the field it starts from (one key on `phone_otp` and `email_otp`; a map from input to field key on `database` and an AAMVA `form`). The session serves a one-key `prefillFrom` under the field key, and a map under each input's name as the web flow reads it, with `-` read as `_` (a database input `name_first` stays `name_first`; an AAMVA input `name-first` is served as `name_first`), so an input whose name differs from its field key is filled; an unset field is `null`, a write-once one `{ "set": true }`. The two inquiry-comparison checks compare with a field's initial value when there is one, through `comparisonSourceFor`.

## Device classes and capture methods (C150.2, C153.2)

`deviceKindOf` maps a session's parsed device to `desktop-web`, `mobile-web` or `native`, and `captureMethodsByDevice` picks the capture methods per class. Every upload reports its `capture-method` (`camera` or `upload`), stored as `files.capture_method` and labelled client-reported.
