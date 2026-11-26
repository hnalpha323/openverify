# @openverify/dashboard

The operator console: a Next.js 16 App Router app (React 19, Tailwind 4) that is also the
dashboard's backend for frontend (BFF). Operators sign in here; the dashboard calls the
OpenVerify API on their behalf, from the server only.

## Running it

| Command | What it does |
|---|---|
| `pnpm --filter @openverify/dashboard dev` | `next dev`. No client address reaches the API (see below), which is fine on a laptop |
| `pnpm --filter @openverify/dashboard build` | `next build` into `.next` |
| `pnpm --filter @openverify/dashboard start -- --hostname 127.0.0.1 --port 3001` | The production server: `node server.ts` (defaults: `127.0.0.1:3001`; `--dev` for dev mode) |

Always serve a production build with `server.ts`, never with `next start`: only `server.ts`
records the operator's address (C21).

Settings, read on the server only:

| Variable | Meaning |
|---|---|
| `OPENVERIFY_API_URL` | The API the BFF calls, for example `http://127.0.0.1:3000` (`http://api:3000` in compose) |
| `OPENVERIFY_DASHBOARD_BFF_TOKEN` | Shared secret sent as `x-openverify-bff-token`; the API's own `OPENVERIFY_DASHBOARD_BFF_TOKEN`. Without it the API ignores the forwarded address |
| `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS` | Reverse proxies in front of the dashboard that append `X-Forwarded-For` (0-32, default 0) |
| `OPENVERIFY_DASHBOARD_INSECURE_COOKIES` | `true` drops `Secure` from cookies in a production build served over plain http (never in production) |
| `OPENVERIFY_DASHBOARD_DIST_DIR` | Unset, or `.next/e2e`: the e2e stack's own build output (`tsconfig.e2e.json`) |
| `OPENVERIFY_FLOW_PUBLIC_URL` | The hosted flow's public URL (Workflow 9C). Its origin is the preview frame's `src` and the only `frame-src` of the console's script policy; unset, not http(s), or holding credentials, a query or a fragment, the policy sends `frame-src 'none'` and the preview says it cannot be shown |
| `OPENVERIFY_DASHBOARD_CSP_MODE` | The console's script policy (Workflow 9C, C170): `report-only` (exactly, around whitespace) reports violations without blocking and shows a banner on every page; anything else, unset or unknown, enforces |
| `OPENVERIFY_MODE` | Read by the console for one thing only (Workflow 9D, K9-15): exactly `development`, as the e2e stack runs, makes `/error-probe` throw for a signed-in operator so the real-header CSP spec reaches the error page; any other value, or none (the compose dashboard is given none), makes it the 404 page |

## How the BFF works (contract C21)

```
browser ──▶ server.ts ──▶ Next.js: proxy.ts, server components, server actions ──▶ src/lib/api ──▶ API
            sets x-openverify-peer-ip            (session cookie, /dashboard/me)     bearer ovu_ token
            from the socket                                                         x-openverify-client-ip
                                                                                    x-openverify-bff-token
```

- **Server side only.** Pages are server components, mutations are server actions. The `ovu_`
  session token lives in the httpOnly cookie `__Host-openverify_session` (Secure, `Path=/`, no
  `Domain`; `openverify_session` only under `next dev` or `OPENVERIFY_DASHBOARD_INSECURE_COOKIES=true`,
  where it cannot be Secure, KP11-78) and never reaches browser JavaScript, a URL or a log. Every module under `src/lib/api/` imports `server-only`.
- **One API layer** (`src/lib/api/`):
  - the server API through `@openverify/node` (`getApiClient()`), authenticated with the session
    token (C12 accepts it as a bearer), never retried;
  - any server or dashboard API endpoint through `apiRequest({ method, path, query, body, schema })`,
    parsed with its `@openverify/contracts` schema, with the same errors as the node client
    (`OpenVerifyApiError`, `OpenVerifyConnectionError`);
  - the routes that take no session (login, MFA, invitations) through `publicApiRequest()`.
- **The operator's address** (F003, F007). Next.js keeps a client-sent `X-Forwarded-For` and
  loses the socket peer, so `server.ts` deletes any incoming `x-openverify-peer-ip` and sets it
  from `req.socket.remoteAddress`. With `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS=0` the address is
  that peer; with N it is the Nth `X-Forwarded-For` entry from the right; anything missing or
  malformed means no address, and the BFF sends no `x-openverify-client-ip`. Under `next start` or
  `next dev` the peer header is never believed (`src/lib/api/client-address.ts`). Behind Docker's
  port publishing the peer is the bridge gateway: put a proxy that appends `X-Forwarded-For` in
  front and set the hop count.
- **Who the operator is.** `getSession()` (`src/lib/api/me.ts`) reads `GET /dashboard/me` once
  per request (React `cache`): user, environment, permissions, MFA state. Navigation and buttons
  without a permission are hidden; that is UX only, the API enforces.
- **Failures.** 401 sends the operator to `/login`; 401 `mfa-required` to `/account/security`;
  403 renders the "You do not have access" panel (pages) or problem (forms); 404 renders not
  found; any other problem shows its `title` and `detail`, never a stack.
- **Secrets shown once** (API key tokens, webhook secrets, TOTP secrets, recovery codes,
  one-time links) go from the action's result into `OneTimeSecretDialog` and are dropped when it
  closes. Never put one in a URL, `localStorage`, `sessionStorage` or a log.
- **Sign-in** (C22): `/login`, then `/login/mfa` when the user has a second factor (the
  `mfa-token` stays in an httpOnly, SameSite=Strict cookie scoped to `/login`), `/account/security`
  for factors, `/accept-invitation` for invitation links (the token is read from the fragment in
  the browser, which then clears it). The challenge cookie counts no attempts: the API does, and
  its 401 says what happened (C25.1). `mfa_code_invalid` keeps the operator on `/login/mfa`;
  `mfa_attempts_exhausted` returns to `/login?reason=mfa-attempts` and `mfa_token_invalid` (the
  token expired, was used or was revoked, perhaps in another tab) to `/login?reason=mfa-invalid`,
  both with the cookie cleared. The page hides a refusal while the next code is checked, so the
  refusal on screen is always that code's.

## How to add a page

A page of section `/accounts` (C23). Every name below exists today; keep the imports as they are.

**1. The section's layout** puts the page in the console (banner, header, navigation, which
already links every C23 route):

```ts
// src/app/accounts/layout.tsx
export { ConsoleLayout as default } from '../../components/console-layout';
```

**2. API calls.** Server API endpoints come from the node client that `renderPage` and
`runAction` hand you (`api.accounts.list(...)`). Dashboard API endpoints (users, roles, settings,
audit logs) go in a resource module of your own, `src/lib/api/<resource>.ts`:

```ts
// src/lib/api/users.ts
import 'server-only';
import { userListDocumentSchema } from '@openverify/contracts';
import { apiRequest } from './client';

export function listUsers(query: { after?: string | undefined }) {
  return apiRequest({
    method: 'GET',
    path: '/dashboard/users',
    query: { 'page[after]': query.after, 'page[size]': '25' },
    schema: userListDocumentSchema,
  });
}
```

`apiRequest` also reaches a server endpoint the node client has no method for. Encode IDs from
a URL with `encodeURIComponent`.

**3. The page** is a server component that renders through `renderPage`. Lists keep their
filters and cursor in the URL query:

```tsx
// src/app/accounts/page.tsx
import type { Metadata } from 'next';
import { EmptyState } from '../../components/empty-state';
import { MaskedValue } from '../../components/masked-value';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';

export const metadata: Metadata = { title: 'Accounts' };

export default async function AccountsPage({ searchParams }: PageProps<'/accounts'>) {
  const params = await searchParams;
  const after = parseCursor(params.after, 'acc');
  return renderPage({ permissions: ['accounts:read'] }, async ({ api, session }) => {
    const page = await api.accounts.list({ page: { size: 25, ...(after ? { after } : {}) } });
    const masked = !hasPermission(session, 'pii:view');
    return (
      <PageMain>
        <PageHeader title="Accounts" description="People and businesses, with their inquiries." />
        {page.data.length === 0 ? <EmptyState title="No accounts yet" /> : /* a DataTable */ null}
        <Pagination path="/accounts" query={{}} after={after} nextCursor={cursorFromNextLink(page.links.next, 'acc')} />
      </PageMain>
    );
  });
}
```

`renderPage(guard, render)` reads the session, sends a session that must pass MFA to
`/account/security`, shows the forbidden panel without calling anything when a permission is
missing, and maps API failures (above). Detail pages call `notFound()` for a malformed ID;
`renderPage` maps the API's 404. Show PII through `<MaskedValue value={...} masked={masked} />`:
"Hidden" when the API masked it, an em dash when it is missing.

**4. Loading and error states**, next to the page:

```tsx
// src/app/accounts/loading.tsx
import { PageLoading } from '../../components/page-loading';
export default function Loading() {
  return <PageLoading label="Loading accounts…" />;
}

// src/app/accounts/error.tsx
'use client';
import { PageError, type PageErrorProps } from '../../components/page-error';
export default function AccountsError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The accounts could not be loaded." />;
}
```

**5. Mutations** are server actions built with `runAction`, which returns
`{ ok: true, data } | { ok: false, problem }` and never a stack:

```ts
// src/app/actions/accounts.ts  (your own file)
'use server';
import { idSchema } from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { formString, parseInput, runAction } from '../../lib/api/action';

const redactSchema = z.strictObject({ 'account-id': idSchema('acc') });

export async function redactAccount(_previous: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:redact'] }, async ({ api }) => {
    const body = parseInput(redactSchema, { 'account-id': formString(formData, 'account-id') });
    await api.accounts.redact(body['account-id']);
    revalidatePath(`/accounts/${body['account-id']}`);
    return undefined;
  });
}
```

Validate input with the contract's request schema (`parseInput`): its issues come back as field
errors by JSON Pointer. On the client:

- a confirmed action: `<ConfirmActionButton label="Redact" title="Redact this account?"
  confirmLabel="Redact account" action={redactAccount} fields={{ 'account-id': id }}
  successMessage="The account was redacted." />` (`components/confirm-action-button.tsx`);
- a form: `const form = useFormAction(action, { onSuccess })` (`components/use-form-action.ts`),
  spread `{...form.formProps}` on the `<form>`, and give `<SubmitButton pending={form.pending}>`
  its state. Show `<ProblemDisplay problem={withoutFieldErrors(form.problem, pointers)} />`
  (`components/field-errors.ts`) so every refusal is announced, and
  `<FormField error={fieldErrorOf(form.problem, '/name')}>` for selects and text areas (`Field`
  and `Input` from `@openverify/ui` for text inputs). Never `useActionState` with
  `<form action>` directly: React 19 resets such a form after every run, so a refused submission
  would lose what the operator typed. `useFormAction` keeps the server action on the form (a
  submission made before hydration is held and replayed, never a GET with the values in the
  URL), handles the submit event so nothing is reset after a refusal, empties the form after a
  success only with `resetOnSuccess`, and keeps no action state, so a secret an action returns
  lives only where `onSuccess` puts it. `ConfirmActionButton`, `SecretActionButton` and
  `FormDialogButton` use it already (Workflow 2D K003). The two sign-in forms are the only
  exceptions: their own state keeps the email (`login-form.tsx`), and a one-time code is meant
  to be typed again (`mfa-login.tsx`);
- a form that works in the session's environment without naming one of its resources (settings,
  a creation): render `<EnvironmentField environmentId={session.environment.id} />` in it and
  pass the form to `runAction({ ..., environmentForm: formData }, ...)`, so a switch in another
  tab saves nothing (Workflow 2D F002);
- a secret the action returns once: keep it in state, show it in `<OneTimeSecretDialog>`, drop
  it in `onClose`;
- a row action, such as Remove in a table: give `ConfirmActionButton` an `accessibleLabel` that
  starts with the visible label and names the target ("Remove the spouse relation to acc_…"), and
  a dialog `title` that names it too (WCAG 2.4.6, 2.5.3; Workflow 2E F014);
- a control that disappears while it has focus (Edit note opening the editor, Cancel or Save
  closing it, a removed row): move focus to a control that remains, in an effect after the render
  that removed it (`note-editor.tsx`, `custom-headers-editor.tsx`; WCAG 2.4.3, Workflow 2E F012);
- a toast after an action: `useToast().show({ tone: 'success', message })`;
- JSON documents: `<JsonEditor label="Flow" name="flow" defaultValue={...} errors={problem?.errors} />`.
  Give it the errors by their path inside the document (the account type forms strip
  `/data/attributes/fields-schema`); its description names each error's path and detail (F013).
  A document that replaces a whole value (an account type's fields schema, C25.3) starts from the
  current value, and the API is the judge of the change: show its 422 by path rather than
  checking the change in the dashboard.

Client components import types from `src/lib/action-state.ts`, never from `src/lib/api/`.

**6. Tests** (React Testing Library and user-event in jsdom; test behaviour and roles):

```ts
import { meDocument, mockApi } from '../../testing/api-mock';      // scripted API, records requests
import { fakeRequest } from '../../testing/fake-request';          // cookies() and headers()
import { expectNotFound, redirectTarget } from '../../testing/next-errors';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const api = mockApi();                              // in beforeEach; api.restore() in afterEach
fakeRequest.cookies.set(SESSION_COOKIE, `ovu_${'S'.repeat(43)}`); // the name outside production
api
  .replyTo('GET /dashboard/me', 200, meDocument({ permissions: ['accounts:read'] }))
  .replyTo('GET /accounts', 200, { data: [], links: { next: null } });
render(await AccountsPage({ searchParams: Promise.resolve({}) }));
```

`replyTo` answers only that method and path; `reply` answers whatever comes next. `restore()`
fails the test when an answer was never used or a request found none (Workflow 2D F021). A stub
of a server action answers through `later()` (`src/testing/later.ts`), and a test waits for what
the answer changes (`findBy…` with the expected name, description or text), never reads it once
right after the click (Workflow 2D F019).

## Shared components

| Component | File |
|---|---|
| `ConsoleLayout`, `switchableEnvironments` | `components/console-layout.tsx` |
| `NAV_GROUPS`, `visibleNavGroups`, `homePath` | `components/nav-items.ts` |
| `PageMain`, `PageHeader`, `PageLoading`, `PageError`, `EmptyState`, `ForbiddenPanel` | `components/page-main.tsx`, `page-header.tsx`, `page-loading.tsx`, `page-error.tsx`, `empty-state.tsx`, `forbidden-panel.tsx` |
| `DataTable`, `Pagination`, `Detail`, `Timestamp`, status badges | `components/data-table.tsx`, `pagination.tsx`, `detail.tsx`, `timestamp.tsx`, `status-badge.tsx` |
| `Dialog`, `ConfirmDialog`, `ConfirmActionButton`, `OneTimeSecretDialog`, `CopyButton` | `components/dialog.tsx`, `confirm-dialog.tsx`, `confirm-action-button.tsx`, `one-time-secret-dialog.tsx`, `copy-button.tsx` |
| `MaskedValue`, `HiddenValue`, `EmptyValue` | `components/masked-value.tsx` |
| `FormField`, `controlClassName`, `JsonEditor`, `SubmitButton`, `ActionFeedback`, `ProblemDisplay` | `components/form-field.tsx`, `json-editor.tsx`, `submit-button.tsx`, `action-feedback.tsx`, `problem-display.tsx` |
| `useFormAction`, `withoutFieldErrors`, `EnvironmentField` | `components/use-form-action.ts`, `field-errors.ts`, `environment-field.tsx` |
| `ToastProvider` (in the root layout), `useToast` | `components/toasts.tsx` |
| `VerificationCard` (`title`, `linked`), `VerificationImage`, `verificationTitles` (retries numbered "Government ID, attempt 2", F015), `VerificationView` | `components/verification-card.tsx`, `verification-view.tsx` |
| `AccountTypeForm`, `AccountTypeEditForm` | `components/lifecycle/account-type-form.tsx` |
| `RateLimitPanel`, `PiiMasked` | `components/integrations/rate-limit-panel.tsx`, `api-keys-table.tsx` |
| `CheckResults` (`checks`, `label`, `status`, `detailed`): a verification's checks, what needs the operator first (C37), each with its category and whether it is required or advisory (C66) | `components/check-results.tsx` |
| `VerificationEvidence`, `EVIDENCE_COMPONENTS`, `isPhase5Verification`: a Phase 5 verification's evidence through its type's view (C54.5, C66) | `components/evidence/index.ts` |
| `PersonalValue`, `NotRecorded`, `Code`, `Words`, `PassMeans`: the pieces every evidence view shares | `components/evidence/parts.tsx` |
| `ExtractionTable` (`verification`, `state`: `visible`, `hidden`, `redacted`): a government ID's extraction (C31.5) | `components/extraction-table.tsx` |
| `reasonText`, `REASON_WORDS` (check reasons in words); `groupChecks`, `sendsToReview`, `countByStatus` | `lib/check-reasons.ts`, `lib/check-groups.ts` |
| `describeConfigPointer` (a verification config pointer in words) | `components/lifecycle/verification-config-pointers.ts` |
| `rscPayloadOf` (tests: what a server tree sends to the browser) | `testing/rsc-payload.ts` |
| `defineCopy`, `CopyCatalog`: the typed English catalog each area's strings live in (Workflow 9C) | `lib/copy/catalog.ts` |
| `TemplateTabs`, `templateTabHref`: a template's section tabs | `components/template-tabs.tsx` |
| `GraphAdapter`, `GraphCanvas`, `OutlineTree`, the undo history and edit menu: the editor the workflow editor and the flow builder share | `components/graph-editor/` |
| `SchemaForm`: a form generated from a contract schema, each value judged by the contract as it is typed | `components/schema-form/schema-form.tsx` |
| `apiRequestWithHeaders`: `apiRequest` with request headers (such as `If-Match`) and the answer's headers | `lib/api/client.ts` |

## Pages added in Workflow 2E

| Route | API | Notes |
|---|---|---|
| `/verifications/[id]` | `GET /verifications/:id` (`verifications:read`); with `inquiries:read`, `GET /dashboard/inquiries/:id` for the files' kinds and the redaction | Status, checks with reasons and metadata, files ("Hidden" without `pii:view`, or without `inquiries:read`, naming the missing permission; "Redacted" after a redaction). Without the inquiry, the breadcrumb and the Inquiry detail link nothing, and a 403 on it shows a forbidden panel naming `inquiries:read` in Files (Workflow 2E E001). Linked from the inquiry page's verification cards and its timeline |
| `/account-types/[id]` | `GET /account-types/:id`, `PATCH /account-types/:id` (C25.3) | The fields, and an edit form bound to its environment (`EnvironmentField`). The fields schema is the whole new schema; a removed or retyped key shows the API's 422 at its path |

The inquiry page names its pinned template version (C25.4) and reads its timeline with
`GET /events?filter[inquiry-id]=` (C25.7), so verification and session events show, verification
events linking their page. It offers no resume: `POST /inquiries/:id/resume` hands a session token
to a client integration, and the console hands an inquiry off with a one-time link instead.
`/api-keys` creates a key with its expiry in one call (`expires-in-seconds`, C25.5, from an offered
time or a date and time in UTC), says whether each key sees personal data masked (`pii-masked`,
C25.6), and shows the caller's rate limit (`GET /rate-limits`, `readRateLimits` in
`lib/api/api-keys.ts`, which shows "not available" rather than failing the page). `/api-logs`
filters by `user-id` (C25.9). `/roles/[id]` reads `GET /dashboard/roles/:id` (C25.2).

## Government ID results (Phase 3, Workflow 3B, C37)

- **Check results** (`CheckResults`, on the verification card and the verification page). A
  government ID runs about 32 checks, so the list leads with what needs the operator: required
  failures, then required checks without evidence (pending, or not applicable for a reason other
  than `feature_absent` and `not_requested`: these send it to review, C30.1), then advisory
  failures, in the table "<title> checks needing attention". The rest (passed, non-blocking not
  applicable, advisory and pending) fold into a native `<details>` whose summary counts them by
  status ("Other checks: 26 passed, 4 not applicable"). A verification in `needs_review` names the
  required checks that sent it there in a note ("Why it needs review"). Each result shows its
  status; a "Beta" badge (text, `data-stage="beta"`) for a beta result; "Confidence 0.58" only for
  a non-null confidence; its reasons in words with the code beneath (`lib/check-reasons.ts`; a
  code without words shows as the code; `provider_not_configured` reads "Not configured", with "No
  provider is bound to this check in this environment.", ADR 0002 §3e); on the page, its metadata;
  and its provenance in a per-check disclosure (implementation version, models with the first 12
  hex characters of the SHA-256, provider with "(sandbox)", thresholds). Everything is text.
- **Needs review** has a badge tone of its own (`review`, violet), for inquiries and
  verifications, never shared with "Requires retry".
- **Extraction** (`ExtractionTable`, the verification page of a government ID): every attribute of
  `GOVERNMENT_ID_EXTRACTION_ATTRIBUTES`, in words, with the value exactly as `GET
  /verifications/:id` sent it (dates are `YYYY-MM-DD` strings, never parsed), "Hidden" without
  `pii:view` (the API sends `null`), "Redacted" after the inquiry's redaction, and the sources that
  agreed in words ("Machine-readable zone, Visual zone"). No other answer feeds it: the page test
  checks with `rscPayloadOf` that no masked value reaches the RSC payload, even when the inquiry
  document carries one.
- **The template editor** shows each verification config error the API (or the same contract
  schema in the server action) answers by pointer, with the check and setting, or the allowlist
  entry, in words (`describeConfigPointer`): "Government ID, check id_blur_detection, setting
  min-blur-score". Nothing validates the config in the browser.
- **API keys** (E003): a new key with a bad expiry and bad attributes is refused once, with every
  field error.

## Phase 5 verifications in the console (Workflow 5C, C66)

Nine more verification types (C50.1) show on the inquiry page's cards and on the verification
page with an "Evidence" section of their own, beside the checks and the files.

**How a type's evidence is built.** One view per type, `components/evidence/<type>.tsx`, which
`components/evidence/index.ts` maps by resource type; each module exports only its component. A
view gets `EvidenceProps`: the verification answer, its title ("Phone number, attempt 2"), the PII
state (`visible`, `hidden` without `pii:view`, `redacted` after the inquiry's redaction) and, when
the card or page knows them, the verification's own files with how their images may show (a
document's preview, a chip portrait). Beside it:
- `lib/<type>-evidence.ts` reads what the view shows from the answer only: its attributes and its
  checks' metadata and provenance. Metadata is `unknown` in the contract, so a value of the wrong
  shape counts as not recorded, never as a pass.
- `lib/<type>-words.ts` says each value in words, and holds the type's "What a pass means" line.
  Its test reads every value an evaluator can record from `packages/checks/src`
  (`testing/checks-source.ts`) and checks the line against the type's `docs/checks` page
  (`testing/check-docs.ts`), so a new value without words, or a line the docs no longer say,
  fails it.
- `lib/reason-words/<type>.ts` words every C51.2 reason of the type's checks for operators;
  `reasonText(code, check)` reads it before the shared words. Its test iterates the contracts'
  list first (`checkReasonsOfType`, `testing/phase5-reasons.ts`).
- `testing/fixtures/<type>.ts` builds synthetic answers on the golden API fixtures
  (`testing/phase5-fixtures.ts`), with the metadata the evaluators write.

**The rules every view keeps.**
- The view reads only the verification answer and never unmasks: a personal value the API masked
  arrives as `null` and reads "Hidden" (its description names `pii:view`), "Redacted" after a
  redaction. The page tests check with `rscPayloadOf` that no masked value reaches the browser,
  even when the inquiry document carries it.
- It is one `role="group"` named "<title> evidence", its terms directly in one `<dl>`, so a page
  (and `e2e/tests/support/phase5.ts`'s `evidenceValue`) reads a value by its term.
- A value the console has no words for shows as its code; a check that has not run says "Not
  recorded yet".
- Nothing is conveyed by colour alone, and no image's alt text names the person.

**The check rows** (`CheckResults`, every type): each row says its category (Biometrics, Fraud,
User action required, Validity; C50.8) and whether the template requires it. An advisory check
that failed says "Does not decide the verification" (C30.1); a `not_applicable` result is never
shown as a pass, and a required one without evidence is named in "Why it needs review".

**The people types** (`dashboard-people`):

| Type | Evidence | What a pass means (from `docs/checks`) |
|---|---|---|
| Phone number | the number; Confirmed (UTC) or "Not confirmed"; sends; failed attempts; the channel; the sender ("Sent through", the sandbox sender labelled as sending nothing); "Refused by" and the limit in words when a limit refused the user (C55.6) | the user could read messages sent to that number at that moment, not who they are |
| Email address | the same, plus what the disposable-domain lists matched and how far above the address, and how the mail-domain check found its answer (MX records, a null MX, the address records, NXDOMAIN, a reserved sandbox name) | the user could read mail sent to that address at that moment, not who they are |
| Crypto wallet | the claimed and expected addresses; the chain and the signature scheme in words with their codes; the address type; the checksum ("Absent": a single-case EVM address carries no EIP-55 checksum); the flags raised: high-s, a loose BIP-137 header, a contract wallet (ERC-1271), the ed25519 curve, an unwrapped Solana off-chain message; the EVM RPC asked about a contract wallet ("Contract checked by", the sandbox one labelled) | whoever answered controlled the address's key at signing time, not who they are; a contract wallet proves control of a contract |

The phone and email views share `components/evidence/otp-details.tsx` and `lib/otp-words.ts`.

**The records types** (`dashboard-records`):

| Type | Evidence | What a pass means (from `docs/checks`) |
|---|---|---|
| Database | `components/evidence/database.tsx`: the source the record came from, labelled sandbox, and what its authority means for a miss; each match field's entered values beside its level, methods and flags (an address also its components); each match group's met, unmet or undecidable result, and the group fields the step did not collect; the inquiry comparison and the PO box patterns | The values the user entered match a record the bound source holds, well enough for at least one configured match group. A sandbox or other non-authoritative source cannot say that a person does not exist: a miss there goes to review. It does not show that the person entering the values is the person the record describes. |
| AAMVA | `components/evidence/aamva.tsx`: where the values came from (the AAMVA form the user filled, or the inquiry's government ID, copied by the server for the silent step); the provider, labelled sandbox, and the identity result; each value beside how the issuing jurisdiction's record answered it (never "no difference" for a field the answer does not name); the ignored fields, and what the template does when the jurisdiction does not take part | The issuing jurisdiction's records hold a license or ID card with these details. It does not show that the card is in the user's hands. |
| Business registry | `components/evidence/database-business.tsx`: the register, labelled sandbox, and what its authority means for a miss; the register's record id, legal name and status, and how the status was read; the entered business beside each match field's level, methods and flags, and the LEI; each match group's result; the associated persons entered and how many the register lists (advisory); the country allowlist and whether a register covers the country | A public register holds an active business whose name matches the one entered, together with its registration number, or with its address (by default). It does not mean the user acts for that business: unless the step collects associated persons and they match, anyone who knows a company's public details can enter them. |
| Business website | `components/evidence/business-website.tsx`: the URL and host entered (personal data: a personal site can name its owner); the resolution, the required core, and how it was read (the sandbox rule for reserved names, or the DNS answer as address counts, never an address); the domain's registration day and its age against the template's minimum, or why it is unavailable; the malicious-website listings and the backlinks, or that the template does not run them; each result's provider, labelled sandbox | The website's host resolves to a public internet address. That is the required core. Neither says who runs the site, that it belongs to the business, or that it is safe: the malicious-website check (disabled by default) needs the operator's own feeds. |

`src/readme-records.test.ts` checks that each row's pass line says only what the view's own line
(`lib/<type>-words.ts`) says. `dashboard-documents` (document, government ID chip, the trust
store) describes its views in each file's header.

**Settings** (`/settings`, C55.7): "Text message codes in <environment>" holds the environment's
text message budget (`otp-sms-max-per-hour`, from 1 to the installation's ceiling,
`OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING`, 1,000 by default) and, read-only, when it last tripped
(from the `environment.otp-sms-budget-tripped` audit entry). Only a role with `settings:write`
gets the field; the API refuses a budget above the ceiling with a 422 at `/otp-sms-max-per-hour`,
which shows on the field.

**Navigation:** "Chip trust store" (`/trust-anchors`, `settings:read`, the scope of
`GET /dashboard/trust-anchors`) sits under Organization after Settings.

**Tests for a type's page** answer the page's two reads with that area's mock routes
(`testing/routes/<area>.ts`, such as `servePeopleVerification` in `testing/routes/people.ts`) on
`routeApi`. The full-stack spec of each area is `e2e/tests/ui-<area>.spec.ts`, with its helpers in
`e2e/tests/support/<area>.ts`.

## Reports in the console (Phase 6, Workflow 6B, C86)

The "Reports" navigation group links Reports (`/reports`, `reports:read`), Report templates
(`/report-templates`, `report-templates:read`) and Watchlist sources (`/watchlist-sources`,
`watchlists:read`), each for the scope of the API route behind it. The template and sources pages
are `dashboard-report-config`'s and describe themselves in their files' headers.

**Honesty first** (ADR 0002, ADR 0005, C69.4). The console says what the API recorded, in words:
- A status is about processing; the result is said beside it: "Match", "No match" only beside
  `ready`, "Not screened" for an errored report (never "no match"), "Match; not fully screened"
  for a partial run that kept its matches, "Fields computed" for a type without review
  (`lib/report-result.ts`). The coverage and each of its limits sit beside the result.
- Each error is said in words and names its source (`reportErrorText`, `lib/report-words.ts`); a
  field nobody could compute reads "Unavailable" with its reason, never "No".
- Every result shows its tiers with the registry's tier note, its stage ("Beta" badge, text) and
  "What this result means" for its state (`lib/report-type-words.ts`, checked against
  `docs/reports/` by `testing/report-docs.ts`). An H-tier value shows its confidence and reasons.
- A sandbox provider is labelled "(sandbox provider)"; an imported list "Imported from a file (not
  the publisher's download)".

**Pages.**

| Route | API | What it shows |
|---|---|---|
| `/reports` | `GET /dashboard/reports`; `GET /report-templates` with `report-templates:read` | the environment's reports newest first: type, status, result, coverage, template version, origin, tags, creation; filters on type, template, status, result, tag, account and inquiry in the URL (`lib/report-query.ts`; "No match (ready reports only)" is `filter[has-match]=false`); cursor paging; "Create report" with `reports:write` |
| `/reports/new` | `GET /report-templates?filter[status]=active`, `POST /reports` | choose an active template (a GET form), then the query of its type, one field per `REPORT_QUERY_FIELDS` member, each with its member's own length limit from the contract (`queryMaxLength`, `lib/report-query-limits.ts`; owner decision 24), up to three additional names, an account with `accounts:read` and a new one only when asked; a 422 shows on its field by JSON Pointer |
| `/reports/[id]` | `GET /dashboard/reports/:id` | the result (status, result, coverage, errors, what it means, notices, unavailable fields, tiers, stage, provider, matcher version, thresholds); the matches and the ignore list (types with review); what the type found; the query with where each value came from; the sources with their provenance and staleness; details; tags; monitoring; the history |
| inquiry and account pages | `GET /dashboard/reports?filter[inquiry-id]=` / `filter[account-id]=` | a "Reports" section (no tab primitive exists), at most 25 with a link to the full list; on the inquiry page a completion report whose run found the inquiry decided says "Decided before this report finished" (C84.3) |

**What each type found** (`components/reports/report-results.tsx`): the matched lists and their
entries, each with the other lists it is on and their programmes, never read as an SDN-level block
(owner decision 9); the listed crypto addresses, the address format, the exposure block (no risk
score is synthesised) and each entry's other lists; the PEP persons with positions, relatives, a
relative's class of the PEP it relates to (owner decision 9) and their Wikidata sources; the media
articles as plain links only (the title is the link text, `rel="noopener noreferrer nofollow"`,
nothing fetched, previewed or embedded) with each confidence, its beta stage and the provider's
citation; the email, phone and address fields (`lib/report-field-words.ts`), the email domain's
kind beside a masked domain (P15).

**Matches and review** (`report-matches.tsx`, `match-dialogs.tsx`). Each match shows the subject's
name and the list's name side by side, the name level, methods, match types, qualifiers with their
score change, the score with its preset and minimum; an open match the last run did not find says
it stays open until a person dismisses it (C75.8). Review and dismissal need `reports:review`
**and** `pii:view` (the matches are personal data; nobody decides blind), in the console and in
the API (owner decision 16), never on a pending or redacted report; a refusal for either says so
in words (`REVIEW_NEEDS_PII_VIEW`). Each dialog moves focus in and back, and requires its reason: a dismissal's
reason, a review's comment (the API asks one of a false positive only; the console asks it of
every review). A refusal shows on its field, tied to it, and is titled by its problem code
(`describeReportProblem`, `lib/report-problem-words.ts`).

**Monitoring** (recurrable types): Pause (a recurring report), Resume (a paused one) and Run now
(also while paused), only with `reports:write`. The history lists runs and actions newest first,
every run note in words, and who acted: a user or an API key by its id, or the system; a
redaction by the system is an inquiry's or account's cascade or the retention setting (owner
decision 12).

**Coverage** (owner decision 6): beside complete coverage, a watchlist, business watchlist or PEP
report says what it does not promise: romanisations outside the variant groups and ICAO's
tables, unknown spellings, or typos beyond the budget (`COMPLETE_COVERAGE_WORDS`, checked against
`docs/reports/watchlist.md`).

**Masking** (C70.3). The pages read only the masked dashboard documents: without `pii:view` the
query (member by member), the matches, the ignore list and every PII result read "Hidden", and a
redacted report's "Redacted". `app/reports/rsc-payload.test.tsx` checks that the RSC payload of
every report page, the index and both sections holds none of a report's personal values for such
an operator, with a control that finds them when the API shows them.

**Words.** Every report event (`eventWords`), problem code, error, run note, coverage limit,
unavailable reason, notice and match value has words; each words test iterates the contracts'
list first, so a value added there without words fails.

**Settings** (`/settings`, C73.6): "Reports (days)" in the retention group redacts (never deletes)
reports that many days after creation, from 1 to 3,650; empty keeps them as long as their
inquiries. A refusal shows on the field at `/report-retention-days`.

**Tests** build reports on the golden API fixtures with `testing/report-fixtures.ts` (masked as
the API masks them). The full-stack spec is `e2e/tests/ui-reports.spec.ts`, with its helpers in
`e2e/tests/support/ui-reports.ts`.

## Signals, lists, graph and transactions in the console (Phase 7, Workflow 7C, C108)

The "Risk" navigation group links Lists (`/lists`, `lists:read`), Graph (`/graph`, `graph:read`,
which viewers never hold), Transactions and Transaction types (`/transactions`,
`/transaction-types`, `transactions:read`; editing a type needs `transaction-types:write`). Network
sources (`/network-sources`, `settings:read`) sits under Organization. The lists and transactions
pages are `dashboard-lists-transactions`', the graph explorer `dashboard-graph`'s; each describes
itself in its files' headers. The rest is `dashboard-signals`':

**Honesty first** (ADR 0002, ADR 0006, C90). The console shows what the API recorded, in words, and
nothing in it declines, passes or fails anything:
- a `null` value reads "Not evaluated" with its reason, never "no" (`notEvaluatedText`,
  `lib/signal-words.ts`); `false` reads "Checked: not found", and appears only where the data is
  exhaustive;
- a low bot score reads "no automation artefacts found", a low threat level "no listed risk found",
  never "human" or "safe"; an H-tier value shows its tier, the "Beta" badge, its confidence, its
  reasons and its thresholds in words;
- "Not computed yet" while `signal-details.computed-at` is `null`, and the review cause and rules
  in words when the signals job recorded one;
- an unscreened list reads "Not screened" with its reason and a list the subject had no value for
  "No value to compare"; a pending, partial or errored screening never reads "no match", and a
  screening that found the inquiry decided says "Decided before the list screening finished"
  (`lib/list-match-words.ts`);
- a sandbox network source is labelled "Sandbox"; every network-derived value names its sources
  with their sync, publication time and SHA-256;
- every surface that shows an IP location or a distance computed from one carries the line "IP
  geolocation by DB-IP", linking `https://db-ip.com` (`DbIpAttribution`, C92.8).

**Pages and sections.**

| Surface | API | What it shows |
|---|---|---|
| inquiry, Sessions | `GET /inquiry-sessions?filter[inquiry-id]=`, then `GET /inquiry-sessions/:id?include=device,network` per session | one card per session: times, address and user agent (masked without `pii:view`), consent, the collection tiers collected ("Nothing collected" for none), the parsed device and the recorded device (fingerprints masked, the device class always shown: it is not PII), the network facts with their tier, reasons and provenance, how the address was resolved, and the handoff that created a phone session, linked to the session it came from (a `null` fact reads "Unknown", never "No") |
| inquiry, Signals | the dashboard inquiry read (`CONSOLE_SIGNAL_VIEW`, whatever `expose-signals` says) | the values grouped by layer, one table per layer |
| inquiry, List matches | the screening from `signal-details['inquiry/list_match_count']`; `GET /list-matches?filter[inquiry-id]=` with `lists:read` | the screening's state and every selected list's, then each match with its list, the value compared (masked), method, tier, confidence or score or distance and "approximate"; dismissal with a required reason under `lists:write` (`POST /list-matches/:id/dismiss`; 409 `list_match_not_open` in words) |
| account | the account's inquiries (`inquiries:read`), `GET /list-matches?filter[account-id]=` (`lists:read`) | the signals of the latest five inquiries, the list matches, then the two slots `AccountGraphSection` (`graph:read`) and `AccountTransactionsSection` (`transactions:read`), each called as a function with `{ accountId, permissions }`, inside its own section, its 403 the section's forbidden panel |
| template versions | `GET`/`PATCH /inquiry-template-versions/:id` | `signal-config` and `list-config` as JSON documents beside the flow, verification config and settings, read-only on other versions; a publish refusal titled by its code, each error naming its document and path (`describeVersionProblem`, `lib/version-problem-words.ts`) |
| `/network-sources` | `GET /dashboard/network-sources` | each source with its state, staleness, last check, last applied sync, publication, SHA-256, origin, last refusal, attribution with its link-back and terms; the recent syncs; the pinned ASN seeds with their commit and counts. Read-only: the operator syncs with `network:sync` |
| `/settings` | `GET`/`PATCH /dashboard/settings`; `GET /dashboard/audit-logs?filter[action]=settings.updated` with `audit-logs:read` | the C107.7 settings, and the trail of collection tier changes |
| custom-list report | `GET /dashboard/reports/:id` | each matched item with its evidence, every list searched (screened, not screened with its reason, or no value to compare), and each list's provenance (version, normaliser version, item count, screening time; a list has no sync) |

**Settings** (C107.7). The collection tiers (`signal-collection`), the biometric lists basis and the
graph switches need `settings:privacy`; without it they show read-only and the form never posts
them, because the API refuses the whole save. Everything is compared by value, so an unchanged
`signal-collection` is never sent. Clearing the biometric lists basis asks first: it redacts every
face and background list and its items. `exempt` without a basis is the API's 422
`basis_required`, shown on the basis field. Each window is bounded by its contract range; an empty
IP or transaction retention keeps them.

**The audit pages** read a served `actor { type: "system", id: null }` (K7A-8) as "System", with no
id and no "Entries by this actor" link (`ServedAuditActor`, `components/operators/audit-actor.tsx`).

**Masking.** The pages read only the masked documents the API returns, and never unmask on their
own: `testing/rsc-payload-signals.test.tsx` checks that, without `pii:view`, the RSC payload of the
inquiry, account, custom-list report and network sources surfaces holds no address, coordinate,
fingerprint, user agent, list value, compared value or dismissal reason, and keeps the device class.

**Words.** Every event (`lib/event-words.ts`, tested over `EVENT_NAMES`), every signal null and
evidence reason and review cause (`lib/signal-words.ts`), every list screening status, unscreened
and not-applicable reason, review cause, match method, tier and probe source
(`lib/list-match-words.ts`), the network facts, address sources, collection tiers, device types,
handoff methods and sync outcomes (`lib/network-words.ts`), and the signal and version problem codes
(`lib/version-problem-words.ts`); each test iterates the contracts' list first.

## Workflows and cases in the console (Phase 8, Workflows 8C and 8D, C141 to C143)

The "Cases" navigation group links Cases, Case templates, Queues and Case settings; "Automation"
links Workflows (`workflows:read`) and Secrets (`secrets:read`). Each link shows only with its
route's read scope. The editor (`/workflows/[id]/draft`, its outline, canvas, palette and step
forms) and the run page (`/workflows/runs/[id]`) describe themselves in their files' headers; the
case pages in `components/cases/`.

**Honesty first** (ADR 0002, ADR 0007). The console shows what the API recorded, in words, and
decides nothing about a person without a button, a confirmation and the inquiry's own route:
- a run "completed with N step errors (M outcomes unknown)" says so; a masked value reads "Hidden
  without pii:view", a purged one "Purged by retention", a redacted one "Redacted", never empty;
- a recorded sandbox message reads "Recorded (sandbox)", never "sent" or "delivered";
- a decision record says whether a person took part ("Not declared by the caller" for `null`),
  its basis and its contest route with the URL's host first;
- a draft's grant reads "Derived at publish"; a version with no egress mark "No personal data
  leaves"; a list's purpose, a transaction type's adverse statuses and both types' contest routes
  say what is adverse and how a person contests it ("Not declared" for none);
- trusting a device says it changes no check and no signal: only a workflow condition reads it.

**Pages and sections.**

| Surface | API | What it shows and does |
|---|---|---|
| `/workflows` | `GET /workflows`, `GET /workflow-recipes` | the workflows, the create form (an empty draft, or a review-first decision template from `components/workflows/decision-templates.ts`, C128.5, saved as the draft and never published), the recipes, and links to the bindings |
| `/workflows/[id]` | `GET /workflows/:id`, `/workflow-versions`, `/workflow-runs`, `/workflow-trigger-deliveries` | status, pause, activate, archive, publish with acknowledgements, rollout finish and undo, restore, promote (C112.2: a draft in another environment, never a replace, never a publish), cancel older runs (C116.2: effects already made stay made), the runs filtered by status, version, subject id and step errors, the version history with each grant and egress mark, the deliveries, manual runs from ids or a CSV (C118.5; each refusal by row and code, never a value), each list paged by its own cursor (`versions-after`, `runs-after`, `deliveries-after`) |
| `/workflows/[id]/test-runs` | `POST /workflows/:id/test-runs`, `GET /workflow-runs/:id/steps`, the sandbox message searches | the sandbox test-run panel (C120.7): version, trigger object (an id or a synthetic payload), step range, output overrides, allowed hosts, acknowledgements; the started run's steps with their output and console lines (served to the run's creator only); the recorded messages found by a recipient posted in a form, never a URL, with bodies only with `pii:view`. `?start-step=<id>&end-step=<id>` on one Evaluate Code step is that step's test. A production environment says "Sandbox only" |
| `/secrets` | `GET`, `POST`, `PATCH /workflow-secrets`, the value routes | keys, descriptions, hosts, placements, the last four of this environment's value; create, edit (description, hosts, placements; refused by pointer), set, rotate, delete. A value goes out once and is never shown |
| `/account-actions`, `/case-actions` | `GET`, `POST`, `PATCH /account-actions`, `/case-actions` | each binding with its workflow and target; binding a running workflow; its label, status and parameter form prefill (one `account.fields.*` or `case.fields.*` path per trigger input, never a value) |
| inquiry, Sessions | `POST /devices/:id/trust` with `devices:write` | each recorded device's trust mark, and trust with a snake_case reason or remove the mark |
| `/settings` | `PATCH /dashboard/settings` | the C143.7 workflow settings; `workflow-http-private-cidrs` only with `settings:privacy`, never posted without it |
| `/webhooks` | the webhook form | the `workflow-ids`, `case-template-ids` and `list-ids` filters, refused by pointer |

**Masking.** The RSC payload tests of the run page, the test-run panel and the case pages check
that, without `pii:view`, no step value, console line, message body, field value, comment or
filename reaches the browser; a control test with `pii:view` shows each can.

## The console of Phase 9 (Workflow 9C, C153 to C173)

Workflow 9C built the console side of Phase 9 on the API that Workflows 9A and 9B built: the
console's script policy, the flow builder, the template forms, preview and simulate, themes and
copy, analytics with saved views and exports, the settings pages, and the case and report
completions. Each area's pages describe themselves in their files' headers, its record is
`docs/tdd/phase9-dashboard-<area>.tdd.md`, and what the API does is in the docs pages linked below.

**Honesty first** (ADR 0002, ADR 0005 to ADR 0008; the plan's rule 10). The console shows what the
API recorded, in words, never more certain than the API:
- an unknown is said as unknown with its reason, never "no", "0" or "passed"; a check that never ran
  reads "not run"; a step-derived figure before the environment's first step record reads "no step
  data";
- every analytics figure states its definition, denominator, time zone and freshness, and every
  caption, table and chart is drawn only from the suppressed answer;
- every fact a flow branch reads shows its tier, stage and source ("Self-asserted" for what a person
  typed, "Client-reported" for what their device said), and a beta heuristic its badge;
- every enabled locale shows its review status, and a machine-drafted catalog says so;
- a simulated path is labelled simulated, and the preview lists what it does not do;
- the contrast table proves the palette's pairs, not a screen;
- the role editor never offers a grant the API would refuse, and says why;
- a rotated key's old token is shown working until the end the operator chose;
- a printout says whether it holds personal data, and that only the Print button's prints are
  recorded.

**Strings.** Phase 9's new console strings live in the typed English catalog under `lib/copy/`
(C155.9): each area owns `lib/copy/<area>.ts`, made with `defineCopy` (`lib/copy/catalog.ts`, which
freezes it at every depth); a message that takes values is a function of them and returns plain
text. The shared words are `lib/copy/console.ts`, and the editor's library strings (`@xyflow/react`'s
`ariaLabelConfig`) are `lib/copy/graph-editor.ts`, so translating the console later is a data change.

**Navigation added in 9C** (`components/nav-items.ts`, each link shown only with its scope): Theme
sets (`/theme-sets`, `theme-sets:read`) under Verifications; a new group, Insights, with Analytics
(`/analytics`, `analytics:read`) and Exports (`/exports`, shown to a holder of any of the six
`:export` permissions, through `NavItem.anyOf`); Bulk reports (`/exports/bulk-reports`,
`reports:write`) under Reports; and "Notification settings" (`/notifications`) in the header, since it
needs a session only. Only the most specific matching link is marked as the current page
(`currentNavHref`). A template's pages share section tabs (`TemplateTabs`,
`components/template-tabs.tsx`): Overview, Flow, Settings, Translations, Theme and Preview. The tabs
show with `inquiry-templates:read`, and each page checks its own permissions.

### The console's script policy (C170)

`src/proxy.ts` sends every page a script policy with a fresh nonce, built by `consoleCsp` in
`src/lib/csp/policy.ts`:

```
default-src 'self'; script-src 'self' 'nonce-<nonce>' 'strict-dynamic'; style-src 'self' 'nonce-<nonce>';
img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src <flow origin or 'none'>;
worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
report-uri /csp-reports; report-to csp
```

- **One nonce per request.** `createNonce()` draws 128 random bits. The proxy hands the nonce and the
  policy to the render as request headers (`x-nonce`), deleting any policy header a client sent, and
  Next.js puts the nonce on its scripts; `'strict-dynamic'` lets the scripts they load run. The
  policy goes on every response the proxy matches, redirects included, with `Reporting-Endpoints:
  csp="/csp-reports"`. `next dev` alone adds `'unsafe-eval'`, which React needs there.
- **Every page renders per request.** The root layout awaits `connection()`, so no page is
  prerendered with a stale nonce. The only exception is Next.js's own `/_global-error`, the fallback
  shown when the root layout itself fails: it reads no request, and under `'strict-dynamic'` its
  scripts do not run, so it is static HTML.
- **One policy header.** On the routes the proxy runs on, its policy (which holds
  `frame-ancestors 'none'` itself) is the response's policy; `next.config.ts`' static
  `Content-Security-Policy: frame-ancestors 'none'` stays for the routes the proxy skips (build assets,
  `favicon.ico`, the case attachment upload).
- **No inline script, style or event handler, and no `eval`.** Libraries that set inline styles
  (`@xyflow/react` in the editors, Cytoscape in the graph explorer) and the analytics charts render in
  the browser only, after hydration, with their stylesheets bundled; an SVG's presentation attributes
  are attributes, not inline styles.
- **The mode.** `OPENVERIFY_DASHBOARD_CSP_MODE=report-only` sends `Content-Security-Policy-Report-Only`
  instead, and every page shows a "Script policy not enforced." banner (`CspModeBanner`,
  `components/csp/csp-mode-banner.tsx`, a status region named "Script policy"). Any other value
  enforces, so a typo never switches the policy off. The static `frame-ancestors 'none'` stays
  enforced in either mode.
- **`POST /csp-reports`** (`app/csp-reports/route.ts`, `lib/csp/reports.ts`) is public, because
  browsers often send reports without the session cookie. It takes only `application/csp-report` and
  `application/reports+json` (else 415), at most 16 KiB (413, refused from the declared length before
  reading and again while streaming), 60 reports a minute per client address, each report of a batch
  counting (429 with `Retry-After: 60`; the address comes from the console's own helpers, never a raw
  `X-Forwarded-For`, and the limiter lives in the server process's memory). It answers 204 and logs
  one warn line per violation, `{ msg: "csp-violation", effective-directive, blocked-origin }`: the
  directive, and the blocked resource's scheme and host only, never a path, a query or the page.
- **Tests.** `e2e/tests/ui-csp.spec.ts` reads the real header on the full stack, on every page of the
  build without a dynamic segment (derived from the build's route manifest, never listed by hand),
  `/login` and the 404 page: the exact policy, a fresh nonce on every server script, and no violation.
  Every 9C UI spec fails on any `securitypolicyviolation`. The policy's flow origin is the preview's
  (below).

### The flow builder (C154, C155)

`/templates/[id]/flow` (`inquiry-templates:read`) edits the template's draft. A published version is
never edited: without a draft, the page points to the overview's "New draft". Editing needs
`inquiry-templates:write`, publishing `inquiry-templates:publish`. The flow format, its ports and its
rules are in [docs/flows](../../docs/flows/README.md).

**One editor, two documents.** Phase 8's workflow editor now sits in `components/graph-editor/`
behind a `GraphAdapter` (`graph-adapter.ts`): the canvas (`GraphCanvas`, `@xyflow/react`, client
only), its gesture changes, the dagre layout, the undo history (100 entries), the edit menu and the
outline tree (`OutlineTree`). Two adapters describe the documents: `WORKFLOW_ADAPTER`
(`components/workflows/editor/workflow-adapter.ts`, held equal to Phase 8's rules by a test) and
`FLOW_ADAPTER` (`components/flow-builder/flow-adapter.ts`, flow-spec 2).

**The outline first** (`flow-outline-model.ts`). The builder's main view is an APG tree from the
entry along `next`: the path a person takes, read as a list. Every other port (a route, `else`,
`exhausted`, an error, a further button) is a group holding its target's chain; a step met again is a
"Go to" item, never drawn twice; steps the entry does not reach are grouped last. Up and Down move,
Right and Left open and close a group, Home and End jump, Enter selects. Every edit is reachable
from the outline's menus by keyboard, and an option the format would refuse is shown with its reason
in words, never left out silently. The canvas beside it draws the same graph and offers the same
connections (one rule, `connectionProblem`, with the format's cycle rule): a node is moved by
dragging, a connection drawn between handles goes through the same rule as the outline's "Connect
to" list, and nothing is deleted from the canvas, only through the outline's confirmed delete.

**The builder** (`components/flow-builder/flow-builder.tsx`):
- **Steps.** The palette offers every flow-spec 2 step type (a v1 `form` migrates to a screen, so it
  is not offered) and refuses a second step of one verification type, in words. Step ids are opaque
  (`s_` and 8 base32 characters; C151.8: ids are visible to the person, so a name lives in `name`).
- **The step panel** shows the step's own form, generated from its schema
  (`components/schema-form/step-schema-form.tsx`, with capture methods per device class as checkboxes
  labelled client-reported guidance), then the step-panel slot, where a verification step shows its
  check panels (below), and a JSON fallback for the whole step.
- **Branches** (`branch-routes.tsx`) edit each route's condition with the shared condition builder (one
  path against one value, AND groups, OR between groups; a nullable path offers only "is" and "is
  unknown"), the flow's own `onNull` choices (skip the route, another route, `else`, review) with
  no default, and every fact the routes read with its type, source, tier and stage. No `lists.*`
  path and no signal that is not flow-provisional is offered, and the panel says why.
- **The format's rules run in the browser** on every edit (`checkFlowGraph` from `@openverify/flow-spec`,
  the code the API runs): errors on each step and in a Problems panel announced politely. Warnings
  never count as a step's errors. The API stays the authority at save and publish.
- **Autosave** 1,500 ms after the last edit (provisional), with the draft's `If-Match` ETag and
  `meta.allow-invalid`, so a draft with problems is stored and says so. A 412 opens "reload the latest
  draft", listing what changed on the server since this editor last saved.
- **Publish** saves first, then runs `validate` in publish mode: its errors, and every
  acknowledgement with its kind's reason, each needing a ticked box, and a publish note.
- **A flow-spec 1 draft** is shown migrated, with a notice.
- **Theme and languages.** The builder shows the theme picker and the languages panel of the themes
  and copy area (below).

**The template page** (`/templates/[id]`) gains: compare two versions (a `GET` form, `?compare=` and
`?against=`; the diff as a list, every consequence the API flags said in words and never folded into
"layout only"; a viewer may compare), "used by" (workflows, report templates and case templates by
name, with the ones the reader cannot see counted, and the embed origins), the deployment history
(with `deployments:read`) and restore on each published version (with `inquiry-templates:write`).

**Clients.** `@openverify/node` neither sends `If-Match` nor reads headers, so the template version
reads and saves, validate, diff, restore, copy, promote and used-by go through `apiRequest`
(`lib/api/inquiry-template-versions.ts`, `inquiry-templates.ts`, `deployments.ts`); `ApiCall.headers`
and `apiRequestWithHeaders` carry the headers, and the BFF's own headers always win.

### Template settings and report template forms (C153)

**One form engine** (`components/schema-form/`): `SchemaForm` renders one labelled control per member
of a contract schema's JSON Schema, and the contract judges each value as it is typed: a refusal is
said at its field, and the form sends nothing while a value is refused. A nullable member offers
"none" as a value of its own, distinct from leaving the member out; a member the form cannot type is
edited as JSON, and the whole member's raw JSON is one click away. Tests hold that every contract
member is rendered, for the template's members, every report type and every flow-spec 2 step type.

**`/templates/[id]/settings`** (`inquiry-templates:read`; `?version=itmplv_…`, else the draft, else the
current version read-only) has a form per member: `settings`, the links (`help-url`, `privacy-url`,
`embed-origins`, `redirect-uri`, `redirect-uri-schemes`, `redirect-include-status`, `description`),
the verification checks, `report-config`, `signal-config` and `list-config`. Each saves to the draft
alone with `If-Match` and `allow-invalid`; a 412 is said in words, and the stored draft's publish
problems show at their fields. A settings member left empty is left out, so its default (stated beside
it) applies; a link left empty keeps its stored value, and "none" clears it. The four windows that
limit a person's time (`inquiry-expiration-seconds`, `session-expiration-seconds`, and the after-start
and after-resume windows) are warned below 20 hours (WCAG 2.2.1); `list-config` uses a list picker
that reads every active list of the environment.

**The check panels** (`components/check-panels/`, shown in the settings tab and in the builder's
step panel) give each check its tier, type, stage (a beta badge in words) and default requirement
from the registry, its run and require switches, its settings generated from the registry's config
schema, and what its result does: decides, runs without deciding (ADR 0002 §3c), is read by a branch
(the branch routes that read it are listed), or does not run.

**Report templates** (`/report-templates`): a structured form above the draft's JSON editor, which
stays as the fallback, and a create form at `/report-templates/new` (`report-templates:write`, linked
from the list for writers).

### Preview and simulate (C156)

`/templates/[id]/preview` (`inquiry-templates:read`; `?version=itmplv_…`, which must be the template's,
else the newest draft among the 25 newest versions, else the newest version) shows the banner, the
preview frame and the simulate panel. The protocol and the flow server's side are in
[docs/flows/preview-and-simulate.md](../../docs/flows/preview-and-simulate.md).

- **The frame** (`FlowPreviewFrame`, `components/flow-preview/flow-preview-frame.tsx`) frames
  `{flow origin}/preview` with `sandbox="allow-scripts allow-same-origin"`, no referrer and no inline
  style. The flow origin is `OPENVERIFY_FLOW_PUBLIC_URL`'s, read by the same function as the policy's
  `frame-src`, so the two always name one origin. The flow server lets only the console's origin
  (its own `OPENVERIFY_DASHBOARD_PUBLIC_URL`) frame `/preview`. **The frame must not share the
  console's origin**, or `allow-same-origin` would hand it the console's: the frame renders in the
  browser only, compares the flow origin with the page's own `window.location.origin`, and refuses in
  an alert when they match or when the flow URL is missing.
- **Messages.** The console posts nothing until the preview says `ready`, posts only to the flow
  origin, and reads only messages from the flow origin and the frame's own window that parse and fit
  in 1 MiB: `preview-document` (the preview answer), `select-step`, `set-outcome`, `set-viewport`,
  `set-scheme` and `preview-assets` out; `ready`, `navigated` and `error` in.
- **The theme's logo and font** are read by the console route
  `GET /templates/[id]/preview/assets/[assetId]`, which reads the API's asset content with the
  session and passes on only PNG, JPEG or WOFF2 of at most 1 MiB (`private, no-store`, `nosniff`).
  The browser posts them to the frame as transferred buffers, at most 1 MiB in all. Without
  `theme-sets:read` the page says the logo or font could not be read and previews without them.
- **Controls:** width (320, 375 or 768 px), light, dark or automatic, the version's locales plus the
  pseudo-locales `en-XA` and `ar-XB`, a step, and, for a step that creates a verification (drawn as a
  placeholder), its simulated outcome. The preview is resolved in the browser through a server action,
  at most once every 600 ms (`PREVIEW_MIN_INTERVAL_MS`, provisional: the `template-preview` policy
  allows 120 a minute, shared with validate and simulate); a later change replaces a pending call, a
  429 is said in words, and nothing retries by itself. A 422 at `/meta/locale` shows beside the
  language menu, every other pointer in a labelled problems list.
- **The banner** ("What differs from a live flow") says what a preview does not do: no camera and no
  uploads, no checks and no provider (every outcome simulated), none of the server-side validations
  (patterns, field writes, consent digests), and nothing stored (no inquiry, run or step record).
- **Simulate** (`SimulatePanel`) walks the version over values the operator sets, sending only what
  was set, with `null` for an unknown fact: each verification's status, check overrides and extracted
  values; the flow-provisional signals; the lists the routes read; device kind and platform; each
  `run_workflow` step's result; tags; and fields. The answer is a list labelled **Simulated**: each
  step with its port, its route with the condition's result and any `onNull` used, waits and notes,
  and each fact with its tier, stage and source and a "Beta heuristic" badge where it is beta; then
  the outcome, fallbacks, flags, halts and paths that stop early.
- **Presets.** The 22 built-ins (`builtin:<type>-passed|failed`) and any preset whose values the API
  hides (no `pii:view`) are simulated by id and never shown or offered for editing. The operator's
  own presets load into the form, save and delete (after a confirmation); every preset reads
  "synthetic values only".
- **The test run overlay** (C156.6, `components/workflows/overlay/run-overlay.tsx`):
  `/workflows/[id]/test-runs?run=<id>` draws the run's path over Phase 8's read-only canvas and as a
  list ("Test run path, step by step"); a step whose output the test overrode reads "✎ Overridden".

### Themes and copy (C160 to C162)

The API side is in [docs/themes](../../docs/themes/README.md) and [docs/i18n](../../docs/i18n/README.md).

| Surface | API | What it shows and does |
|---|---|---|
| `/theme-sets` (`theme-sets:read`) | `GET /theme-sets`, `POST /theme-sets` | the sets with a status filter, cursor paging and the default mark; a create form with `theme-sets:write` |
| `/theme-sets/[id]` | `GET`/`PATCH`/`DELETE /theme-sets/:id`, revisions, restore, `POST /theme-sets/assets` | the editor of the twelve tokens of the light and dark palettes (lower-case hex; an empty cell keeps the built-in value), the radius, the font (system, or an uploaded WOFF2 with its licence attestation) and the logo (decorative, or with an alt text key); live contrast; the revisions newest first with restore (`?before=` pages them); rename, duplicate (a new set named "<name> (copy)" with the current styles) and archive; the default set with `settings:write` (through `PATCH /dashboard/settings`). An archived set is read-only |
| `/templates/[id]/theme` (`inquiry-templates:read` and `theme-sets:read`) | the draft's `theme-set-id` | the draft's theme picker, saved with `If-Match`; a published version is read-only |
| `/templates/[id]/translations` (`inquiry-templates:read`) | `GET`/`POST .../translations`, `.../translations.csv` | each enabled locale with its review status and the locale form; the editor per key and locale; the CSV export and import; the draft's copy problems |
| the flow builder | as the two tabs | the theme picker (`BuilderThemePanel`) and the languages panel (`BuilderCopyPanel`) |

- **Live contrast** (`ContrastTable`) computes, in the browser, every pair of `CONTRAST_PAIRS` with
  `contrastRatio` from `@openverify/core`, the same code as the API's gate: each pair's unrounded
  ratio, its required minimum and its result in words and an icon (pass, warn, fail); the line colour
  is stated as decorative. The page says what the gate does not cover: it proves the palette's pairs,
  not a screen. The swatches are SVG drawn with presentation attributes. A save answers the new
  revision, or the API's refused pairs at their pointers. With `inquiry-templates:read`, unsaved
  styles are shown on a template's real screens through the preview frame; without it the swatches
  stand in, and the page says so.
- **Asset uploads** say each refusal in words: a missing scope or a font sent by an API key (403), a
  file over its kind's limit (413), SVG (415 `asset_type_refused`), a logo over 2,048 px or a
  re-encoded logo over 256 KiB (422), the `theme-assets` policy (429), and a busy image service (503,
  try again). There is no route that lists assets: the editor knows an asset from its upload in the
  same visit or from the styles that name it, and says so.
- **Review status** (C161.5). Every enabled locale shows its status from `LOCALE_REVIEW_STATUS`
  (`@openverify/flow-spec`) in words and an icon: source, machine-drafted, partly reviewed (naming the
  texts that changed after the review) or reviewed (by whom and when). A locale without a record is
  shown machine-drafted, never reviewed.
- **The translations editor** shows, for each key, its maximum length, placeholders, line rule and
  legal or consent mark, and offers the keys the copy does not hold yet (the built-in keys and the
  component keys of the version's screens). Only changed cells are sent; a refusal is said at its
  cell, by code, never echoing the text. An import never deletes, so an override is removed in the
  builder. Neither import publishes, and both say so. The consent-copy rule and its acknowledgements
  are shown.
- **CSV** goes through the console route `GET`/`POST /templates/[id]/translations/csv`, not a server
  action, because a server action takes 1 MB and the file may hold 2 MiB. The route checks the
  request's origin and refuses a body over 2 MiB; it answers `{ imported }` or `{ problems: [{ row,
  column, code }] }`, shown by row and column, and never passes on the API's problem or a value.

### Analytics, saved views and exports (C164.9, C165, C166)

**Analytics** (`/analytics` for the overview, `/analytics/[view]` for `funnel`, `verifications`,
`checks`, `cases` and `signals`; `analytics:read`) reads one answer of `GET /analytics/<report>` per
view. The definitions, suppression and freshness are the API's, in
[docs/analytics](../../docs/analytics/README.md).

- **Tables first.** Every figure is in a table, the default for keyboard and screen-reader users.
  Beside it, a chart (`components/analytics/analytics-charts.tsx`) is a `figure` whose caption states
  its finding in words, generated from the suppressed answer only, and whose SVG is `role="img"` with
  a name. The charts are `d3-scale` and `d3-shape` with React SVG (owner decision B9 (b)), drawn in
  the browser only; series differ by solid against striped or dashed marks as well as colour, with
  direct labels; nothing is shown on hover only. A caption states this window's figures only, never a
  comparison with another window, which would need a second answer.
- **Suppression in words.** A small count reads "fewer than <threshold>", a complementary cell
  "hidden", and a hidden cell is drawn hatched, never as a value. Each rate shows its numerator,
  denominator and unit; a rate the answer leaves undefined reads "not defined". A check that never ran
  reads "not run"; a step figure before the environment's first step record reads "no step data"; a
  beta signal shows its badge.
- **What a figure means** (`analytics-about.tsx`, on every view): the reporting time zone (a range
  that mixes zones is marked), the window, the freshness (rolled up through, open days' outcomes as
  of), the live day with created and started only, the settle window, the threshold and the number
  of hidden cells, what suppression does not cover, and every metric's definition in
  `ANALYTICS_METRICS`' own words.
- **Filters** are offered per view, only those its answer takes; a platform or device filter on the
  funnel, verifications or checks is refused in words before asking. With no window in the URL the
  console asks for the 30 local days ending today in the reporting time zone, which only the answer
  names, so it asks once more when that zone's today differs from UTC's.
- **Per-reviewer case figures** show only for a reader who also holds `users:write`, as the API
  serves them.

**Saved views** (C165) are offered on all nine lists (inquiries, accounts, reports, cases,
transactions, API logs, events, audit logs, and a webhook's deliveries) through one line each list
page carries, `<SavedViewsSlot list="…" />` (`components/saved-views/`). The slot reads the page's
own URL for its filters and the views from the console route `GET /exports/saved-views?list=<list>`,
which sends the list's name only, never a filter value. Changes are the owner's; a shared view is
copied to be changed; a personal-data filter is refused in words and never put in a form. Each list
maps its URL to the view's API filters (`saved-view-lists.ts`): a page parameter it does not know is
named as not kept when the view is saved (reports' `result`, the audit log's `from` and `to`, and
events' `simulated` are not kept), and a view whose filters the page cannot show, or that its list no
longer accepts, is not applied, so a list is never wider than its view. A transaction field filter
counts as personal data, so a view holding one is refused (fail closed).

**The new list filters** (C165.3): the inquiry list filters by list match, list, check with its
status, and the next step (offered only with `pii:view`); the transaction list by a chosen type's
filterable top-level fields, at most ten, string fields only with `pii:view`. The inquiry list reads
the server API's `GET /inquiries`, which applies these filters.

**Exports** (`/exports`) and **bulk reports** (`/exports/bulk-reports`): the export form per type with
personal data only after a confirmation, the exports list with the 24-hour and redaction notes, the
download route and the bulk upload route are described with the API on
[the exports page](../../docs/analytics/exports.md#in-the-console) and
[the bulk reports page](../../docs/reports/bulk.md#in-the-console).

### The settings pages (C167 to C169, C174.6)

The API side is in [docs/settings](../../docs/settings/README.md).

| Surface | API | What it shows and does |
|---|---|---|
| `/roles/new`, `/roles/[id]` | `GET /dashboard/roles/grantable` | the role editor: a permission the editor may not grant in every environment is disabled, with the environments where it is not held named; organisation-level (`users:*`, `roles:*`) and sensitive permissions (`pii:view`, `settings:privacy`, `environments:production`, every `:redact` and `:export`, `secrets:*`) are marked; a change that removes permissions is confirmed, naming them and how many users hold the role (counted from up to five pages of 100 users, else "every user with this role"; skipped without `users:read`) |
| `/users` | `PUT /dashboard/users/:id/roles`, `.../reactivate`, `.../reset-mfa`, `POST /dashboard/invitations/:id/resend` | where each role applies ("Where <role> applies": every environment, or one), choosing only the scopes the API would grant, with the reason for the rest; MFA factors and the last sign-in for `users:write`; reactivate (a new invitation, no role back: AC2; the console never sends `PATCH status: active`); reset another user's second factor (never one's own); resend an invitation (5 an hour); each refusal in words |
| `/account/sessions` | `GET /dashboard/sessions`, `.../:id/revoke`, `.../revoke-others` | the operator's own sessions with their device summaries; sign out one, or every other; linked from `/account/security` |
| `/audit-logs` | `GET /dashboard/audit-logs` | an action prefix filter (`filter[action-prefix]`); the search by one IP address, offered only with `pii:view` and posted to a server action, so an address never appears in a URL (one page, "more exist" past 25; a 503 without a blind-index key said in words) |
| `/api-keys/[id]` | `POST /api-keys/:id/rotate`, `PATCH /api-keys/:id` | rotation in one dialog: the old token keeps working now, or for 1 hour, 1 day, 7 days or 30 days, and the new token is shown once with the time the old one stops; the note and the attribute blocklist (one per line or comma-separated); the key's age in days and, when the API sets `age-warning`, that the environment's age limit passed. An expired key is offered no rotation |
| `/webhooks`, `/webhooks/[id]`, its edit page | the webhook routes | a name (required on create), a description, the failure alert (threshold 1 to 10,000 failed first attempts within 5 to 1,440 minutes), and, while it lasts, the previous secret's end with the sentence that receivers must accept either signature |
| `/webhooks/deliveries` (`webhooks:read`) | `POST /webhook-deliveries/search` | the delivery search builder ([its page](../../docs/settings/webhooks.md#searching-deliveries)) |
| `/notifications` (a session) | `GET`/`PUT /dashboard/notification-preferences` | each kind's console and email channels; the page says that only the webhook failure alert follows them today and that emails hold a link only |
| `/settings` | `GET`/`PATCH /dashboard/settings` | the 9A and 9B settings where the server reports them: the allowed embed and redirect origins (redirects use the embed list unless "Use a redirect list of its own" is ticked; a production wildcard needs the acknowledgement box, and the page says what an allowlist does not stop), the reporting time zone (a select of the server's zones), the suppression threshold, analytics retention, the settle window, the per-reviewer retention, the key age warning, audit log retention and the sender name, each checked against its contract bounds before the API, and each refusal at its field in words. `require-mfa` is said to be an organisation setting, and, when off, that operators sign in with a password alone |

- **Step-up.** Reset and reactivate carry an optional code field (one-time code autocomplete, paste
  allowed): the action verifies it through `POST /dashboard/sessions/current/step-up` first, and a
  refused code is said at the field with nothing else called. `step_up_required` and
  `user_more_privileged` are said in words. There is no passkey step-up in these dialogs yet.
- **The sign-in's User-Agent.** The BFF forwards the browser's `User-Agent` (at most 1,024
  characters) on the sign-in, MFA and invitation-accept calls, so the API can summarise the device in
  "Your sessions"; every other call sends the server's own.
- **Masking.** `e2e/tests/ui-settings.spec.ts` reads the server HTML of `/users` and `/audit-logs` as
  an auditor holding `audit-logs:read` and `users:read` without `pii:view` (or `users:write`), and
  finds no address, MFA factor or last sign-in time.

### Case and report completions (C172, C173)

The API side is in [docs/cases/templates.md](../../docs/cases/templates.md) and
[docs/reports](../../docs/reports/README.md).

- **The layout editor** (a draft's page, `/case-templates/[id]/versions/[versionId]`;
  `components/cases/layout/`): buttons first, for every move (up, down, to a column, add, remove),
  with dragging doing the same moves as an alternative, and every move announced. The layout, the
  checklists and the preset comments are saved alone, each as a `PATCH` naming only its own member; a
  checklists and preset comments editor holds them as JSON documents. A published version shows its
  layout, checklists, preset comments and each status's required fields in words.
- **The case page** (`/cases/[id]`) arranges its modules by the version's layout (a version without
  one keeps Phase 8's arrangement); a collapsed module sits behind a disclosure, open when printed.
  It reads `GET /cases/:id/checklist` only when the version has a checklist: each item says who
  checked it and when, and is checked or unchecked by its own button, sent with the case's lock
  version. The status switcher names the fields and the unchecked items the chosen status needs
  first, and `case_checklist_incomplete` and `case_fields_required` are said in words. Each available
  case action shows in its placement (the header, the status switcher or the module it names); one
  placed where the reader's page shows nothing falls back to the header. A preset comment is inserted
  into the comment box and edited there; nothing is posted until the operator adds the comment.
- **Reports.** Every name-screening "Complete" coverage carries what it does not promise (K20); the
  latest run's notes are said in words; the inquiry's reports section reads its 25 reports from the
  masked list and the newest 10 completion reports in full, judges the rest by `latest-run-notes`,
  and says that only the newest were read in full.
- **Verifications.** The verification page reads `include=files` (a second read with `selfies` for a
  selfie verification, since the route takes one include) and shows a "File metadata" table and the
  verification's own `redacted-at`, so a reader without `inquiries:read` still sees a redaction.
- **Print views** (C173.3): the inquiry, report and verification pages each have their own `print.css`,
  every rule inside `@media print` and scoped to the page's own mark. The Print button
  (`components/print/object-print.tsx`) records the print through `POST /dashboard/print-audits`
  before the browser's dialog opens. The printed footer gives the environment, the object, the
  operator and the time, says "Contains personal data." only to a reader with `pii:view` (else
  "Personal data is masked on this printout."), and that **only prints from the button are recorded**:
  a print from the browser's own menu or shortcut writes nothing.
- **The inquiry's expiry windows** show read-only, an unset one as "The template’s default"
  ([the rules](../../docs/flows/engine.md#expiry-windows-c15110)).
- **The trust store** (`/trust-anchors`) shows `refresh-enabled` and `icao-crls-allowed` read-only, as
  it has since Phase 5.
- **The graph explorer** (`/graph/[id]`) expands a shared value with an explicit Expand button (never
  on render or hover), through a server action calling `expandNode` synchronously, and merges the
  result onto the node within the 2,000-node limit. A person-identifying kind is offered only with
  `pii:view`, and each refusal is said in words.

### Tests and specs of Workflow 9C

Each area keeps its console route fixtures in `testing/routes/<area>.ts` and its strings in
`lib/copy/<area>.ts`. Each area's full-stack spec runs `expectAccessible` (axe) at each state of each
page it opens and fails on any CSP violation under the real header; none sends a one-time code from
`127.0.0.1` (`ui-cases-reports` sends its two from a documentation address of its own).

| Spec (`e2e/tests/`) | Covers |
|---|---|
| `ui-csp.spec.ts` | the real header on every static page, `/login` and the 404 page |
| `ui-settings.spec.ts` | a sandbox-only role refused in production and the role editor's refusals; key rotation, a failure alert, the operator's sessions and a refused origin; the audit IP search and masking without `pii:view` |
| `ui-flow-builder.spec.ts` | keyboard-only authoring through the outline with undo, redo and autosave; the 412 reload; publish with every acknowledgement, then the diff of two versions |
| `ui-template-forms.spec.ts` | a settings window warned below 20 hours and saved with the ETag; the check panels with the branch that reads a check; a report template created through the form |
| `ui-preview.spec.ts` | a draft previewed at 320 px in both pseudo-locales and on its capture step; a simulated path and a built-in preset; a test run's path over the workflow canvas |
| `ui-themes-copy.spec.ts` | a palette refused with its pairs, one saved and restored, a logo uploaded; the machine-drafted locale, a CSV round trip with a formula cell neutralised, a refused file by row and column |
| `ui-analytics.spec.ts` | suppressed cells in the tables and charts of three views; a saved view refusing a personal-data filter and an export downloaded by its creator; a bulk CSV with each row's outcome |
| `ui-cases-reports.spec.ts` | a layout edited by keyboard, a checklist blocking a status, a placed action and a preset comment; the inquiry's reports, coverage words, run notes, a print with its audit and the trust-store flags; no personal value in the case and inquiry payloads without `pii:view`; a graph node expanded |

### Not built in Workflow 9C

Carried, each with its owner, in the plan's Workflow 9C amendments:
- **The flow builder:** modules (C155.4, the editor's macros) and the screen editor (C155.5: the
  component library, the screen canvas, the Design, Data and Logic tabs); a screen's components are
  edited only through the generated step form and the step's JSON. Copy and promote dialogs (the
  clients exist), the canvas diff badges, C150.9 to C150.11's builder warnings, editing a branch's
  `waitFor` other than as JSON, and Phase 8's loop and module authoring in the workflow editor (review
  R005).
- **Settings:** the current scope of a user's assignments and each user's effective permissions per
  environment (built in Workflow 9D by `fix-api`, below; DS8, K9-22).
- **Cases and reports:** the "Other lists" check (built in Workflow 9D by `fix-api`, below; K19,
  K9-23), `FormDialogButton`'s options (K15: dropped, no record says what they were), and editing a
  case action's placement and `visible-when` (deferred, P9).

Built in Workflow 9D by `fix-api`, test-first (`docs/tdd/phase9-fix-api.tdd.md`):
- **The assignments dialog** reads where each role applies today when it opens
  (`readUserAssignments`, `GET /dashboard/users/:id/roles`) and starts each role's choice there; a
  role assigned in several environments, which one choice cannot say, starts unchosen and says so,
  and a failed read says the current environments could not be read (DS8, K9-22).
- **Effective permissions on `/users`:** each user's roles cell links to `?permissions=<usr_>`, which
  shows what their roles give (`GET /dashboard/users/:id/permissions`): the user and role permissions
  once, organisation-wide, and per environment the others with whether the user can enter it
  (`components/operators/effective-permissions.tsx`; DS8, K9-22).
- **Notification settings** say that case notifications follow the choices too (K9-26).
- **"Other lists"** is checked on the full stack on `SBX-2003`, the sandbox entity listed only on the
  Sectoral Sanctions Identifications List (`ui-cases-reports.spec.ts`; K19, K9-23).

Built in Workflow 9D by `fix-console`, test-first (`docs/tdd/phase9-fix-console.tdd.md`):
- **Words for refusals and codes:** a 403 `no_environment_role` at sign-in, after the second factor
  (back to `/login?reason=no-environment-role`) and at the environment switch, never naming roles
  (K9-9); a bulk row's and a refused file's code in words with the code beside them, an unknown code
  "not described" (`components/analytics/bulk-code-words.ts`, K9-21); a case template's publish
  problem at a layout module placed as "Layout module N (its name)" (K9-17); a relation's target kind
  in words (K9-1); a redacted transaction's alert saying its relations stay, by id (K9-2).
- **Settings and access:** the 9A and 9B settings in the read-only settings view
  (`PlatformSettingsView`, K9-10); a security key or passkey step-up in the reset and reactivate
  dialogs beside the code (`StepUpCodeField`'s `startWebauthn`, K9-11); each webhook's name in the
  webhooks list (K9-12); the error page in `ui-csp.spec.ts` through `/error-probe` (K9-15, the
  `OPENVERIFY_MODE` row above); `consolePublicOrigin` removed, as nothing read it (K9-13).
- **Preview:** the simulated path lists simulate's two known differences from a live inquiry (K9-8).
- **Evidence:** `comparison-source` in words beside each compared field of the database evidence and
  of `id_inquiry_comparison`'s metadata, "not recorded" when the result names none
  (`lib/comparison-source.ts`, K9-16).
- **Analytics:** "Download this view as CSV" on every view, made in the browser from the view's own
  tables (suppression marks, never a hidden value), the About lines and each metric's definition
  first, cells written so a spreadsheet runs none as a formula, the per-reviewer table left out
  because it names people, no second API read (`components/analytics/analytics-download.tsx`,
  K9-18); a saved view holding a transaction field filter on a field no type declares as a string,
  failing closed otherwise (K9-19); the bulk upload taking a template ID from a `reports:write`
  holder who cannot read report templates (K9-20).
- **The graph result table** pages 25 accounts and 25 shared values at a time, and its checkboxes
  are 24 px (R009); the public `/csp-reports` limiter holds at most 10,000 addresses a minute (R001).
- **Themes:** a route that lists theme assets.
