# Theme sets

A theme set (`theset_…`) changes how the hosted, embedded and previewed verification flow looks: its
colours in a light and an optional dark palette, the corner radius, an operator font and a logo. Theme
sets are scoped to one environment, so a sandbox key, or an operator who holds only sandbox roles, can
never restyle production flows; promote copies a set by name (below). The API is
`/api/v1/theme-sets` (scopes `theme-sets:read` and `theme-sets:write`); the console's theme editor
comes in Workflow 9C.

This page covers C160 of `docs/plans/phase-9.plan.md` as built in Workflow 9B (`api-themes`).

## The styles tree

`styles` is sparse: an absent cell takes the documented default. An unknown or mistyped cell is
refused with 400 and JSON Pointers; a contradiction is 422.

| Cell | Values | Default (ours) |
|---|---|---|
| `settings.use-dark-theme` | `true`, `false` | `false`: the flow keeps the light look it had before Phase 9 |
| `settings.preferred-theme-variant` | `light`, `dark` | `light` |
| `light.palette.<token>`, `dark.palette.<token>` | `#rrggbb`, lower case | the built-in token (below) |
| `shape.radius` | 0 to 24 CSS px | 6, the stylesheet's `rounded-md` |
| `typography.font` | `{ "kind": "system" }` or `{ "kind": "uploaded", "asset-id": "tsa_…" }` | the system font |
| `branding.logo` | `{ "asset-id", "alt-key", "decorative" }` | no logo |
| `branding.logo-placement` | `header` | `header` |

The twelve tokens are the stylesheet's colour tokens: `primary`, `primary-hover`, `on-primary`,
`danger`, `danger-hover`, `surface`, `canvas`, `ink`, `ink-muted`, `line`, `control`, `focus`. Colours
are hex only: no names, alpha, `url()` or `var()`, so a value copied into a CSS custom property can
never make a request or inject a rule.

The 422 contradictions:
- `use-dark-theme` without a `dark` member (it may be `{}`, every cell built in);
- a logo that is not decorative without an `alt-key`;
- a logo or a font that names no asset of that kind in the set's environment;
- a contrast failure (next section), answered as `theme_contrast_insufficient`.

Every save (create, change, restore) writes an immutable revision; `GET /theme-sets/:id/revisions`
lists them newest first, and `POST /theme-sets/:id/restore` with `meta.revision` copies one as the
next revision. Each save writes an audit entry naming the revision number (never the name or a
colour). A saved set is live: every flow that resolves to it uses the new revision at its next session
load, and the session names the revision it rendered.

## The contrast gate

`packages/core/src/contrast/` holds the gate, a pure function the API runs on every save and the
console runs live:

- WCAG 2.2's relative luminance over 8-bit sRGB (the 0.04045 threshold, 0.2126, 0.7152 and 0.0722);
- the ratio `(L1 + 0.05) / (L2 + 0.05)`, **never rounded**, so 4.499 fails 4.5;
- vectors: `#000000` on `#ffffff` 21.000, `#767676` 4.542, `#949494` 3.033.

The pairs, checked in both palettes (the dark one too when the set does not use it yet, so a set never
stores a failing dark palette it may switch on later):

| Foreground | Background | Minimum | Warns below |
|---|---|---|---|
| `ink`, `ink-muted`, `danger` | `surface`, `canvas` | 4.5 | 7 |
| `on-primary` | `primary`, `primary-hover`, `danger`, `danger-hover` | 4.5 | 7 |
| `primary` (links, underlined) | `surface` | 4.5 | 7 |
| `control` (form outlines) | `surface`, `canvas` | 3 | no warning |
| `focus` (focus ring) | `surface`, `canvas`, `primary` | 3 | no warning |

`line` is for decorative separators only and has no pair; form controls are outlined with `control`.
A failure answers 422 `theme_contrast_insufficient` with `pairs[]`: each failing pair by its token
names (never a colour), the JSON Pointer of its foreground cell (also when that cell was absent and
took the built-in token) and its unrounded ratio. A pair below 7:1 is a warning: it never refuses a
save, and the template preview lists it (`contrast.findings[]` with `level: warn`).

**What the gate does not cover.** It proves the palette's pairs, not a screen. Outside it: text over
images, the logo's own contrast, thin fonts and anti-aliasing, forced colours (Windows high
contrast), the page around an embedded frame, and operator copy. The WCAG 2.2 AA audit (C171) checks
screens; nothing here claims conformance.

## The built-in palettes

`BUILTIN_PALETTES` (`@openverify/core`) is the one typed constant of both built-in palettes; the
stylesheet (`packages/ui/src/styles.css`) stores the same values as hex, and a test holds the two
equal and passes both through the gate. Phase 10 (C221.8) generates
`contracts/fixtures/theme/builtin-palettes.json` from it.

**How the light palette was converted (review H29).** Until Workflow 9B the tokens were `oklch()`
values. Each was converted once by the conversion a browser performs: Chromium 156.0.8078.4 (the
Playwright build in this repository) filled a 1×1 2D canvas (`colorSpace: "srgb"`) with the `oklch()`
value and read the pixel back with `getImageData`, 8-bit sRGB. Chromium's computed style keeps
`oklch()`, so it could not be read there. Our own OKLab conversion (Björn Ottosson's matrices, rounded
to 8 bits) gave the same twelve values.

| Token | Former value | Hex |
|---|---|---|
| `primary` | `oklch(48.8% 0.243 264.376)` | `#1447e6` |
| `primary-hover` | `oklch(42.4% 0.199 265.638)` | `#193cb8` |
| `on-primary` | `oklch(100% 0 0)` | `#ffffff` |
| `danger` | `oklch(50.5% 0.213 27.518)` | `#c10007` |
| `danger-hover` | `oklch(44.4% 0.177 26.899)` | `#9f0712` |
| `surface` | `oklch(100% 0 0)` | `#ffffff` |
| `canvas` | `oklch(98.5% 0.002 247.839)` | `#f9fafb` |
| `ink` | `oklch(21% 0.034 264.665)` | `#101828` |
| `ink-muted` | `oklch(44.6% 0.03 256.802)` | `#4a5565` |
| `line` | `oklch(87.2% 0.01 258.338)` | `#d1d5dc` |
| `control` | `oklch(55.1% 0.027 264.364)` | `#6a7282` |
| `focus` | `oklch(54.6% 0.245 262.881)` | `#155dfc`, **replaced by `#000000`** |

**One change beyond the conversion: `focus`.** The converted `#155dfc` is 1.30:1 on `primary`
(`#1447e6`), below the 3:1 the gate asks of `focus` on `primary`. A colour with 3:1 on `primary` and
on white at once must be near black (relative luminance at most about 0.0012), so the built-in focus
ring is `#000000`: 3.07:1 on `primary`, 21:1 on `surface`, 20.1:1 on `canvas`. The console's focus
rings change from blue to black accordingly; nothing else in the console changes. (The rings are drawn
with a 2 px offset, so in today's components they sit on the page background; the pair is kept because
C160.4 lists it and an operator's component could put a ring on `primary`.)

The built-in light palette passes every pair; `danger` (6.42, 6.14), `on-primary` on `primary` and
`danger` (6.83, 6.42) and `primary` on `surface` (6.83) are below 7:1 and are warnings.

**The built-in dark palette (ours, review F13)** is chosen to pass the same gate: a light `primary`
for links on a dark surface with a dark label on it, and a white focus ring, the only colour with 3:1
on both the dark surface and the light primary.

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| `primary` | `#3b8bff` | | `surface` | `#101828` |
| `primary-hover` | `#8ec5ff` | | `canvas` | `#030712` |
| `on-primary` | `#030712` | | `ink` | `#f9fafb` |
| `danger` | `#ff6467` | | `ink-muted` | `#99a1af` |
| `danger-hover` | `#ffa2a2` | | `line` | `#364153` |
| `control` | `#6a7282` | | `focus` | `#ffffff` |

**The dark palette is scoped to the flow.** A `prefers-color-scheme` rule in the shared stylesheet
would switch the console to a dark look it was never designed or audited for, so the stylesheet
applies the built-in dark palette only under `:root[data-openverify-variant='dark']`, an attribute
only the flow's theme application sets. The console keeps its light look.

## Assets: logos and fonts

`POST /theme-sets/assets` (multipart, `theme-sets:write`, the `theme-assets` policy of 30 an hour per
environment, counted before anything else) takes the bytes in the part `file`, `kind` (`logo` or
`font`), a font's `unicode-range` and `meta[licence-attested]`.

- **A logo** is PNG, JPEG or WebP by its bytes (never the declared type), at most 256 KiB and 2,048 px
  a side (read from its header before any decoding). It is re-encoded **synchronously** through the
  vision service's rendition endpoint (Phase 8 C135.3): a JPEG stays JPEG at quality 90, a PNG or WebP
  becomes PNG, the ICC profile and every metadata chunk are dropped, an animation keeps its first
  frame. Only the rendition is stored, so no metadata reaches a browser, and the upload answers only
  once it is stored: no asset is ever pending. A busy rendition lane (one running, four queued) or an
  unreachable vision service answers **503 with `Retry-After: 10`** (provisional); a source vision
  cannot decode answers 415.
- **SVG is refused** (decision 28): 415 `asset_type_refused`, as anything else is. The API has no SVG
  sanitiser or DOM library in its runtime.
- **A font** is WOFF2 (`wOF2`, its header's length the file's), at most 512 KiB, uploaded by a user
  with `meta[licence-attested]=true`; the user and the time are recorded (`licence-attestation`). An
  API key cannot attest a licence, so it cannot upload a font (403). **OpenVerify ships no font**
  (decision 27): OFL-1.1 is not on the licence list, so the flow uses the system font stack unless an
  operator uploads a font whose licence allows web embedding.
- `unicode-range` is the operator's, held to a strict CSS pattern (`U+` code points, ranges or `?`
  wildcards), so it can only ever be a range.

Every asset is stored through `FileStorage`, envelope-encrypted under its own id and rewrapped by
`kek:rewrap`. Theme assets are not personal data.

Reads:
- `GET /theme-sets/assets/:id/content` (`theme-sets:read`, the caller's environment): the stored bytes
  as an attachment, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, for the
  theme editor and the preview (which receives them from the console, never from the network);
- `GET /api/v1/flow/theme-assets/:id` (the session token, the session's environment):
  `Cache-Control: private, max-age=3600`, `nosniff`.

## Which theme a flow renders

An inquiry's `theme-set-id` (`POST /inquiries`), else its template version's `theme-set-id`, else the
environment's `default-theme-set-id` setting, else the built-in tokens, each only while it names an
**active** set of the inquiry's environment.

- **Archiving** (`DELETE /theme-sets/:id`) detaches a set: flows that resolved to it fall back to the
  next in that order, and published versions are never rewritten. The environment's default cannot be
  archived (409 `theme_set_default`); change the default first.
- A version names only an active set of its environment at publish; `default-theme-set-id` and an
  inquiry's `theme-set-id` are held to the same rule (422 at the member's pointer).
- The session's `theme` member is `{ theme-set-id, revision, mode, light, dark, radius, font, logo,
  placement }`. It is absent for the built-in tokens: the flow's stylesheet holds them. `mode` is
  `auto` (follow the device) when the set uses its dark theme and `light` otherwise; `dark` is `null`
  for a set without one; an uploaded font is `platforms: ["web"]`, because browsers pass font bytes
  through the OpenType Sanitizer and Android does not load WOFF2, so native clients use the system
  font until Phase 10 decides otherwise (review P18).
- The template preview resolves a version's theme without an inquiry, the built-in theme included,
  with the gate's findings; unsaved styles from the theme editor replace the set's, so a change is
  previewed on real screens before it is saved, failing palettes included.

## In the flow

`apps/flow/src/theme/` applies the session's theme:

- each colour token, the radius scale (`--radius-sm` to `--radius-xl` around the theme's radius),
  `color-scheme` and the font stack with `setProperty` on one rule, `:root:root:root`
  (`THEME_RULE_SELECTOR`; specificity (0,3,0), unlayered), added at the end of the page's own
  same-origin stylesheet (an adopted constructed sheet when the page has none; nothing applied when
  neither exists). It is never `cssText`, a style attribute or the root element's inline style:
  WebKit checks CSSOM writes to an element's inline style against `style-src-attr` (found in CI and
  fixed in Workflow 9C, plan S9C-1), while CSSOM changes to a stylesheet are outside the CSP, so the
  flow's CSP needs no `'unsafe-inline'`. The rule outranks Tailwind's layered tokens and the
  stylesheet's `:root[data-openverify-variant='dark']`. Every value is checked again (a hex colour, a
  radius of 0 to 24) before it is set;
- the variant: the hosted URL's or the embed option's `style-variant` (`light`, `dark`) when the theme
  has it, else `auto` follows `prefers-color-scheme` and its changes, else light;
- with no theme, `style-variant=dark` sets the flow-only attribute of the built-in dark palette;
- an uploaded font is read from the flow asset route, sniffed as WOFF2 and loaded with `FontFace` from
  its bytes (no URL is fetched, so `font-src` is not widened), before the system stack; until it
  loads, and if it fails, the system stack;
- the logo is shown from a `blob:` URL (the flow's `img-src` allows `blob:`) after its bytes sniff as
  PNG, JPEG or WebP; a decorative logo has an empty alt and the organisation's display name shows as
  text beside it.

`apps/flow/e2e/theme-csp.spec.ts` runs the built flow under its production CSP and fails on any
`securitypolicyviolation`, and checks that `<html>` carries no style attribute. CI runs it in
Chromium, Firefox and WebKit. Locally the flow's Playwright config keeps Firefox or WebKit only when
the engine is installed and starts (`launches`, plan S9C-2), so a machine without WebKit's host
libraries runs Chromium and Firefox.

## Promote

When a template version is promoted to another environment of the organisation, its `theme-set-id` is
re-resolved **by name** among the target environment's active sets. One match is used. With none, the
promote copies the set (its current name and styles, as revision 1) and its logo and font into the
target, only when the promoting user holds `theme-sets:write` there; the promote's answer and audit
entry say a set was copied. Otherwise, and when more than one set of that name is active in the
target, the promote is refused with `promote_unresolved` naming `/data/attributes/theme-set-id`.

## Limits and open items

- The gate covers palette pairs only (above); per-component colour overrides (C160.7) are not built
  yet, because flow-spec 2 has no per-component colour member.
- An operator font is proven to load only by its bytes' signature and `FontFace` in the browser: no
  permissively licensed WOFF2 generator is in the repository's lockfiles, so no test renders a real
  font (carried).
- Fonts render on the web only (review P18).
