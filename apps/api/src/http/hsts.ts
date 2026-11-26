/**
 * C255.1 (decision 40; G-HSTS): for installs whose TLS terminator cannot add headers,
 * `OPENVERIFY_HSTS_MAX_AGE` (0 = off, the default; at most 63,072,000) makes the API send
 * `Strict-Transport-Security: max-age=<n>; includeSubDomains`. The chart's ingress sets it otherwise
 * (no `preload` by default, a value the operator sets there).
 *
 * `buildApp` calls `registerHsts` with the configured value (foundation-11b's hook; built by
 * platform-ops, Workflow 11B). The flow server and the console send the same header from the same
 * variable (`apps/flow/server.ts`, `apps/dashboard/next.config.ts`). Headers instruct browsers;
 * they do not protect a client that ignores them.
 */
import type { FastifyInstance } from 'fastify';

/** Adds the HSTS header to every answer while `maxAgeSeconds` is above 0. */
export function registerHsts(app: FastifyInstance, maxAgeSeconds: number): void {
  if (maxAgeSeconds <= 0) {
    return;
  }
  const value = `max-age=${String(maxAgeSeconds)}; includeSubDomains`;
  // onSend runs for every answer: a route's, the not-found handler's and the error handler's.
  app.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('Strict-Transport-Security', value);
    done(null, payload);
  });
}
