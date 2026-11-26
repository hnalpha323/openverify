/**
 * C156.2, C170.1 (Workflow 9C, `dashboard-preview`): the flow origin the console frames, read on the
 * server from `OPENVERIFY_FLOW_PUBLIC_URL` through the same reader as the console's `frame-src`
 * (`lib/csp/policy.ts`, `dashboard-settings`), so the frame's `src` and the policy that allows it
 * always name one origin. A value that is not a plain http(s) URL is no origin at all, so the
 * preview shows its configuration error rather than framing something else.
 */
import 'server-only';
import { FLOW_PUBLIC_URL_ENV, flowPublicOrigin } from '../../lib/csp/policy';

export const FLOW_URL_ENV = FLOW_PUBLIC_URL_ENV;

/** The flow's origin, or `null` when it is not configured as a plain http(s) URL. */
export function previewFlowOrigin(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  return flowPublicOrigin(env);
}
