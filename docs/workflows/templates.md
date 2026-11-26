# Templates

A string leaf of a config may hold `{{ path }}`, with the [path grammar](conditions.md#paths). A leaf that is exactly one reference takes the value with its JSON type; other leaves interpolate strings. There is no logic, filter or helper, and no template library: conditions belong in conditional steps. Templates are values, so the sink serialises the built value once and nothing can break out of a JSON string.

The sink picks the encoding, never the author:

| Sink | Encoding |
|---|---|
| HTTPS URL | Each interpolation percent-encoded as one path segment or query value. The scheme, host and port are literal |
| Header value | CR, LF and NUL refused |
| JSON body (HTTPS, Slack) | Built as a value |
| Email HTML | HTML-escaped |
| Email and SMS text | Inserted as text |
| Slack text | `&`, `<` and `>` escaped, so `<!channel>` typed by an end user pings nobody |
| Tags, comments, fields | Text, within each target's limits |

A missing value is `template_variable_missing`, never an empty string. An unknown reference is a publish error. A member that decides a grant or a gate takes a literal alone: `object-type`, `decision-basis`, `contest-route`, `biometric-basis`, an adverse `status`, `timeout-seconds`, a request's `method`. An Evaluate Code `source` is code, not a template: `{{` in it stays as written.

## Variables

Declared in `variables` with a small type DSL: `string`, `number`, `integer`, `boolean`, `datetime`, `id<prefix>`, `enum<…>`, `list<T>`, `object{…}`, `file`, each optionally `pii`. An object member can read `name?: type pii`. Update Variable does `set`, `unset`, `push` and `remove`, scoped to one run and read-only in a module. Reading one that holds nothing is `variable_unset`. Run variables are capped in all.

Each action's output is parsed by its schema before it reaches a scope, so a step cannot smuggle untyped data into a later expression.
