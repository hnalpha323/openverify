# The mocked flow suite (`apps/flow/e2e`)

Playwright specs for the built flow with the API mocked per test (`support/mock-flow-api.ts`): no stack, no network. `pnpm --filter @openverify/flow e2e` builds the flow with `vite build`, serves it with `vite preview` on a free loopback port, and runs every spec in Chromium, plus `theme-csp.spec.ts` in Firefox and WebKit. The full-stack suite and its rules are in `e2e/README.md` at the repository root.

## Engines

- **CI** always runs Chromium, Firefox and WebKit (`firefox webkit --with-deps` are installed in the `e2e` job).
- **Locally**, `playwright.config.ts` keeps Firefox or WebKit only when it is installed and starts (Workflow 9C, S9C-2). `OPENVERIFY_FLOW_E2E_ENGINES` (a comma list of `firefox`, `webkit`) overrides that probe.

## WebKit without host libraries (optional, local only)

WebKit downloaded onto a host that lacks its system libraries does not start, and installing them needs sudo. Playwright's browser server in Docker runs it instead (Workflow 9D, K9-35; orchestrator decision 3 before 9D). This is test tooling only: the Playwright image (Apache-2.0) is used unmodified, never shipped and never run in CI. Its tag must equal the `@playwright/test` version in the lockfile (1.64.1 here). The server pulls the same `playwright` package version from the npm registry inside the container.

```sh
docker run -d --rm --name openverify-webkit --ipc=host -p 127.0.0.1:3555:3555 \
  mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f \
  sh -c 'cd /tmp && npx -y playwright@1.64.1 run-server --port 3555 --host 0.0.0.0'
# wait until `docker logs openverify-webkit` prints "Listening on", then:
PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3555/ PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>' \
  OPENVERIFY_FLOW_E2E_ENGINES=webkit pnpm --filter @openverify/flow e2e --project=webkit theme-csp.spec.ts
docker rm -f openverify-webkit
```

The server binds to loopback only, and `<loopback>` lets the browser in the container reach the suite's `vite preview` on the host. Remove the container after each run. In a shared workspace, take `/tmp/openverify-e2e.lock` around the run, as for any e2e call.

## The theme CSP spec and WebKit's own report

WebKit reports one `style-src-attr` violation for a native `<select>` under any policy without `'unsafe-inline'`, on a page with no script at all; Chromium and Firefox report none. That report, not the flow's code, failed CI 42331362147 and 42382549247. `theme-csp.spec.ts` therefore measures each engine's baseline on a script-free control page served on the flow's origin under the flow's own production policy (`buildContentSecurityPolicy`), allows on a flow page only reports that match a baseline entry (same directive, blocked value and target element, empty sample), and pins the baseline itself per engine in its own test. The policy gains no `'unsafe-inline'`, `'unsafe-hashes'` or `style-src-attr` source, and the language picker stays a native `<select>`.
