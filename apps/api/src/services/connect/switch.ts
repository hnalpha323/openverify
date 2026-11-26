/**
 * C231.10 (decision 71; Workflow 11A Stage 1b (C)): Connect is off unless the install allows it
 * (`OPENVERIFY_CONNECT_ENABLED`, `config.connect.enabled`, default `false`). While it is off every
 * Connect route answers the one generic 404, as an unknown route of the install would to a caller who
 * may not see it. Each Connect route plugin adds {@link connectSwitchHook} first, so it runs before
 * anything of the route (its body, its rate policies, its handler).
 */
import type { onRequestHookHandler } from 'fastify';
import type { ConnectInstallSettings } from '../../config.js';
import { connectNotFound } from './not-found.js';

/** Whether the install allows Connect; absent settings mean off. */
export const connectEnabled = (settings: ConnectInstallSettings | undefined): boolean =>
  settings?.enabled === true;

/** An `onRequest` hook that answers the one 404 while Connect is off. */
export function connectSwitchHook(
  settings: ConnectInstallSettings | undefined,
): onRequestHookHandler {
  const enabled = connectEnabled(settings);
  return (_request, _reply, done) => {
    done(enabled ? undefined : connectNotFound());
  };
}
