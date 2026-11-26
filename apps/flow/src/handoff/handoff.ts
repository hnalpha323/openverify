/**
 * The flow's device handoff (plan C96), owned by `flow-handoff` (Workflow 7A Stage 3): the step
 * screen, the QR, the phone's preview, context and consent sequence. Stage 1a freezes what the
 * phone reads from its link; Stage 1b reads it in `session/session-bootstrap.ts` and routes a
 * handoff link to `HandoffRedeemFlow`, which redeems the token only on Continue (P15).
 */
import { parseHandoffFragment } from '@openverify/contracts';

/** The credentials of a handoff link (`#inquiry-id=<id>&handoff-token=ovh_…`). */
export interface HandoffFragment {
  readonly inquiryId: string;
  readonly handoffToken: string;
}

/** The handoff credentials of a fragment, or `null` for any other link. Sends nothing. */
export function readHandoffFragment(hash: string): HandoffFragment | null {
  return parseHandoffFragment(hash);
}
