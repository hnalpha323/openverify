import { counselUnreviewed } from '@openverify/flow-spec';

/**
 * C238.10 (reviews P14, H08): until counsel's review is recorded (Q7), the built-in `share.consent.*`
 * texts are "not reviewed by counsel", and the template editor says so beside each one's rules.
 * Nothing for any other key.
 */
export function CounselReviewNote({ copyKey }: { readonly copyKey: string }) {
  return counselUnreviewed(copyKey) ? <span>Not reviewed by counsel</span> : null;
}
