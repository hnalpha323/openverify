# Sample customer site (`apps/demo-web`)

This is a sample. It shows how a customer's site uses OpenVerify's web packages; it is not a
product, it is never published as a package, and it must only ever see synthetic data.

The packages it uses are clients: the installation's server decides every step and the result. The
sample's page treats the flow's completion in the browser as a hint and shows the result its own
server learned from a webhook it verified, or else from the API.

## What it does

- Its small server (`src/server/`, `node:http`) holds a sandbox API key and creates an inquiry and
  its session with `@openverify/node`. The key is read from the environment and is never logged or
  sent to the browser.
- Its page (`src/page/`, Vite and React) embeds the flow with `<OpenVerifyFlow>` from
  `@openverify/react`, which mounts `@openverify/js`'s embed.
- Its server receives the installation's webhooks at `POST /webhooks/openverify`, verifies each
  signature with `@openverify/node` before reading it, and keeps only the inquiry id, its status and
  the event name, in memory.

| Route                           | What it does                                          |
| ------------------------------- | ----------------------------------------------------- |
| `GET /api/config`               | the flow URL the page embeds from                     |
| `POST /api/inquiries`           | creates an inquiry and its session for the page       |
| `GET /api/inquiries/:id/result` | the result from a verified webhook, else from the API |
| `POST /webhooks/openverify`     | the installation's webhook, verified first            |
| `GET /`, `GET /assets/*`        | the built page                                        |

## Settings

| Variable                         | Meaning                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `OPENVERIFY_DEMO_API_URL`        | the API's base URL, for example `http://127.0.0.1:3000` |
| `OPENVERIFY_DEMO_API_KEY`        | a sandbox API key (a secret; never commit it)           |
| `OPENVERIFY_DEMO_WEBHOOK_SECRET` | the webhook's signing secret (a secret)                 |
| `OPENVERIFY_DEMO_FLOW_URL`       | where the installation serves the flow                  |
| `OPENVERIFY_DEMO_TEMPLATE_ID`    | the inquiry template (`itmpl_...`) to create from       |
| `OPENVERIFY_DEMO_LISTEN`         | `host:port`, default `127.0.0.1:4180`                   |
| `OPENVERIFY_DEMO_STATIC_DIR`     | the built page, default this app's `dist/`              |

Point a webhook of the installation at `http://<listen>/webhooks/openverify` with the inquiry
events, and use its secret as `OPENVERIFY_DEMO_WEBHOOK_SECRET`.

## Running it

```sh
pnpm turbo run build --filter=@openverify/demo-web...   # @openverify/node and the page
pnpm --filter @openverify/demo-web start                # node src/server/main.ts
```

For development, run the server as above and `pnpm --filter @openverify/demo-web exec vite`, which
sends `/api` and `/webhooks` to it.

## Tests

- `pnpm --filter @openverify/demo-web test`: the server against a fake API and the page in jsdom.
- `pnpm --filter @openverify/demo-web e2e` (after the build above, under the e2e lock): Playwright,
  from the e2e package, runs `e2e/demo.spec.ts` against a fake installation on loopback ports.
