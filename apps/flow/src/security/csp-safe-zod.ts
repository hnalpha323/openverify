/**
 * Makes zod safe under the flow's Content-Security-Policy, which has no `unsafe-eval`.
 *
 * zod 4 compiles object parsers with `new Function` when it can, and finds out by trying it.
 * The browser blocks that attempt and reports a CSP violation even though zod catches the
 * error, so the flow switches the JIT off before any schema is parsed. `main.tsx` imports
 * this module first, ahead of `@openverify/contracts`, which parses schemas when it loads.
 */
import { z } from 'zod';

z.config({ jitless: true });
