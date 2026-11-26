/**
 * C90.5, C94.3 (Workflow 7A, integration-7a): the collector sends a screen's body when the screen
 * closes, but the last screen of a flow closes only after its submission settles, and the inquiry
 * completes (and its sessions end) as that submission is decided. Its body then arrived after the
 * signals were frozen and was refused, so a session reads `collector_missing`. The flow therefore
 * flushes the open screen before each request that can end the person's part (a verification
 * submit, an OTP confirmation, and since Workflow 9A a screen submission, which moves the position
 * and may enter a branch that snapshots client-collected signals, C150.9), waiting at most
 * `SIGNAL_FLUSH_BOUND_MS`: signals never hold the flow.
 */
import type { FlowApiClient } from '../api/flow-api-client';

/** How long a submission waits for the open screen's body (provisional; a collector failure is swallowed). */
export const SIGNAL_FLUSH_BOUND_MS = 1_500;

/** `client` whose submissions first flush the open screen's body (bounded by `boundMs`). */
export function flushBeforeSubmission(
  client: FlowApiClient,
  flush: () => Promise<void> | undefined,
  boundMs: number = SIGNAL_FLUSH_BOUND_MS,
): FlowApiClient {
  const flushed = async (): Promise<void> => {
    const sending = flush();
    if (sending === undefined) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, boundMs);
    });
    try {
      // The collector swallows its own failures; a rejection here is ignored the same way.
      await Promise.race([sending.catch(() => undefined), bound]);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    ...client,
    submitVerification: async (...args) => {
      await flushed();
      return client.submitVerification(...args);
    },
    confirmOtp: async (...args) => {
      await flushed();
      return client.confirmOtp(...args);
    },
    // C150.9 (Workflow 9A): a branch after this screen may read client-collected signals.
    submitScreen: async (...args) => {
      await flushed();
      return client.submitScreen(...args);
    },
  };
}
