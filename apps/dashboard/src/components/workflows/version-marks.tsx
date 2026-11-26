/**
 * A version's grant and egress marks in words (C141.5, C121.2, C121.4): which API scopes its runs
 * act with, whether they read personal data unmasked, and which steps send personal data off the
 * platform and where. A draft's grant is derived only at publish, so it reads so, never "none".
 */
import type { WorkflowEgressMark, WorkflowGrant } from '@openverify/contracts';

/** The grant cell: the scopes, and the unmasked-data mark when the grant holds it. */
export function GrantWords({ grant }: { readonly grant: WorkflowGrant | null }) {
  if (grant === null) {
    return <>Derived at publish</>;
  }
  return (
    <span className="flex flex-col gap-1">
      <span className="font-mono text-xs break-all">
        {grant.scopes.length === 0 ? 'No API scope' : grant.scopes.join(', ')}
      </span>
      {grant.pii && <span>Reads personal data unmasked</span>}
    </span>
  );
}

/** One egress mark in words: the step, the destination, and how many paths it carries. */
export function egressMarkWords(mark: WorkflowEgressMark): string {
  const paths = mark.paths.length === 1 ? '1 path' : `${String(mark.paths.length)} paths`;
  return `${mark['step-id']} sends personal data to ${mark.destination} (${paths})`;
}

/** The egress cell: each marked step, or a sentence that none sends personal data. */
export function EgressWords({ egress }: { readonly egress: readonly WorkflowEgressMark[] }) {
  if (egress.length === 0) {
    return <>No personal data leaves</>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {egress.map((mark) => (
        <li key={mark['step-id']}>{egressMarkWords(mark)}</li>
      ))}
    </ul>
  );
}
