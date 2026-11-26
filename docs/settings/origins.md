# Allowed origins: embedding and redirects

Two environment settings say which sites may frame the verification flow and where it may send the
person when it ends. Both are environment-level (`settings:write` in that environment), audited with
every settings change, and hold at most 50 origins each (`MAX_ORIGIN_ENTRIES`). This page covers
C158 of [the Phase 9 plan](../plans/phase-9.plan.md) as built in Workflows 9A and 9B; the flow-side
behaviour is in [embedding and redirects](../flows/embedding.md) and [the flow server](../flows/server.md).

| Setting                    | Default                          | What it allows                                            |
| -------------------------- | -------------------------------- | --------------------------------------------------------- |
| `allowed-embed-origins`    | `[]`: nothing may frame the flow | the origins sent as the embedded flow's `frame-ancestors` |
| `allowed-redirect-origins` | `null`: the embed origins        | the origins a completion redirect may go to               |

## The origin grammar

An entry is a CSP host-source, `https://host[:port]` or `https://*.host[:port]`:

- lower case, an internationalised domain in its `xn--` form;
- no path, query, fragment, user name or password, no IP literal, no bare `*` and no `*` port;
- in production, `https` only and never `localhost`; a sandbox also takes `http://localhost[:port]`
  and `http://127.0.0.1[:port]` (and refuses `https://127.0.0.1` as an IP literal).

A refused entry answers 422 `embed_origin_invalid`, with one error per refused entry at its pointer
(`/allowed-embed-origins/<i>` or `/allowed-redirect-origins/<i>`) saying which rule it broke. No
problem repeats the entry itself. The grammar and the matcher are one module with no imports,
[`packages/contracts/src/origin-pattern.ts`](../../packages/contracts/src/origin-pattern.ts), with
golden vectors in
[`contracts/fixtures/origin-pattern/vectors.json`](../../contracts/fixtures/origin-pattern/vectors.json);
the settings check, the API's embed policy, the flow server and the embed client all use it.

### Wildcards

`https://*.example.com` matches any subdomain of `example.com` at any depth, on a dot boundary, and
never `example.com` itself or `https://evilexample.com`. The scheme must match, and a port must match
with the scheme's default filled in. A wildcard:

- needs at least two labels after `*.` (`*.com` is refused);
- is refused over a suffix where every subdomain belongs to a different customer of a hosting
  service (`SHARED_HOSTING_SUFFIXES` in the module above, such as `github.io` or `vercel.app`, and
  second-level country suffixes such as `co.uk`). **That list is ours, short and incomplete by
  design**: the Public Suffix List is MPL-2.0 and cannot run in the API under our licence rules. A
  wildcard over a shared suffix that the list does not name is accepted, so check your own entries;
- in production, needs `meta: { "acknowledge-wildcards": true }` on the same settings change,
  otherwise 422 `embed_wildcard_unacknowledged` names each wildcard. The change is then audited as
  any other.

## A template version's own lists

A template version may narrow the environment's lists for its inquiries:

- `embed-origins`: a subset of the environment's `allowed-embed-origins`. Empty or absent means the
  environment's whole list. Each entry must be in the grammar and appear **exactly** on the
  environment's list (an entry covered by an environment wildcard does not count).
- `redirect-uri`: where the flow goes at the end, unless the inquiry names its own.
- `redirect-uri-schemes`: custom schemes a redirect may use, such as an app's `myapp`. Each must
  match `^[a-z][a-z0-9+.-]*$` and is refused for `javascript`, `data`, `vbscript`, `file`, `blob`,
  `about`, `filesystem`, `intent`, `http` and `https` (`REDIRECT_SCHEME_DENYLIST`).
- `redirect-include-status`: whether the redirect carries `status` (default `false`).

These members are stored as sent when a draft is saved, and checked at publish (and by
`POST /inquiry-template-versions/:id/validate` in publish mode): an entry outside the grammar or off
the environment's list is 422 `embed_origin_invalid` at `/data/attributes/embed-origins/<i>`; a
`redirect-uri` off the allowed redirect origins or schemes, or a scheme the denylist refuses, is 422
`redirect_uri_not_allowed` at its pointer. No problem echoes an origin or a URI.

**Checked again on every use.** A version's lists never widen the environment's: the frame
ancestors served for an inquiry are the version's entries that the environment still allows (or the
environment's list), each held to the grammar again, so removing an origin from the environment
stops it everywhere, for published versions and existing inquiries alike. The flow server caches each
inquiry's answer for 60 seconds, so a removal reaches the header within a minute.

## Embedding rules

- An inquiry embeds only while its template is active. An unknown inquiry and an inactive template
  get the same answer: `frame-ancestors 'none'`.
- Drafts never embed: inquiries pin published versions, and the preview is the only draft surface.
- The embed client checks that the inquiry in the frame's path is the session's own inquiry, as the
  server says, and otherwise shows its link error.

## Redirects

A redirect URI (an inquiry's `redirect-uri` on `POST /api/v1/inquiries`, else its version's) is
allowed when:

- it is an absolute URI of at most 2,048 characters with no user name or password; and
- for `http` and `https`, its origin matches an allowed redirect origin (`allowed-redirect-origins`,
  else `allowed-embed-origins`) that is itself valid for the environment: exactly (scheme, host, and
  port with its default) for a plain entry, on a dot boundary for a wildcard; or
- for any other scheme, the version lists it in `redirect-uri-schemes` and the denylist leaves it.

An inquiry's own `redirect-uri` is checked when the inquiry is created (422
`redirect_uri_not_allowed` at `/data/attributes/redirect-uri`). Every redirect is checked again
against the current lists whenever the flow's session answers, so removing an origin also stops the
redirects of inquiries already created: the flow then shows its final screen and does not navigate.

When the flow completes or fails, the session's `completion.redirect-url` is the URI with only
`inquiry-id` appended, plus `status` when the version sets `redirect-include-status: true`; a value
of either that the URI already carried is replaced. **`status` is a hint, not a result**: anyone can
type a URL with `status=approved`, so read the inquiry through the API or a webhook before acting.
It is off by default because a status in a landing page's query string reaches its logs, analytics
scripts and later referrers. No reference id or field value is ever appended. The flow announces the
outcome and shows a Continue button that performs the redirect; it never navigates on a timer.

## What an allowlist does not stop

- A site on the list that is itself compromised can frame the flow.
- A copy of the hosted page served at the top level of another domain is not framed, so
  `frame-ancestors` does not apply to it.
- A browser that ignores CSP ignores `frame-ancestors`. Browsers ignore it in a `<meta>` tag, so the
  flow server's response header is the only control, and a static host cannot serve the embedded
  flow.
- A wildcard trusts every subdomain, including ones created later by someone else on a shared
  suffix our list does not know.
