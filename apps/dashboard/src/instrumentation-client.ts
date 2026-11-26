/**
 * Makes zod safe under a script Content-Security-Policy with no `unsafe-eval` (C108, F33).
 *
 * zod 4 compiles object parsers with `new Function` when it can, and finds out by trying it.
 * The browser blocks that attempt and reports a CSP violation even though zod catches the
 * error. Client components reach zod through values of `@openverify/contracts`, such as
 * `GRAPH_LIMITS`, whose modules build schemas when they load, so the JIT goes off here: Next
 * runs this file before hydration, ahead of the page's client modules. The flow does the same
 * in `apps/flow/src/security/csp-safe-zod.ts`. This file runs on every page, so it imports
 * `config` alone: `import { z } from 'zod'` would put all of zod's schemas on pages that hold
 * none. The setting lives on `globalThis`, so every copy of zod reads it.
 */
import { config } from 'zod/v4/core';

config({ jitless: true });
