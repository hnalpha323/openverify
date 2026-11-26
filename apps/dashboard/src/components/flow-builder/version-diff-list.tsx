/**
 * The diff of two versions as a list (C154.6, C155.7): the accessible form of the canvas's diff
 * badges. Every consequence the API flags is said in words first, and a change with a consequence is
 * never collapsed into "layout only" (C154.10).
 */
import type { TemplateVersionDiff } from '../../lib/api/inquiry-template-versions';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';

const copy = FLOW_BUILDER_COPY.diff;

const MEMBERS = [
  'verification-config',
  'settings',
  'report-config',
  'field-schemas',
  'copy',
  'locales',
] as const;

export function VersionDiffList({ diff }: { readonly diff: TemplateVersionDiff }) {
  const lines = [
    ...diff.steps.added.map((id) => copy.stepAdded(id)),
    ...diff.steps.removed.map((id) => copy.stepRemoved(id)),
    ...diff.steps.changed.map((change) =>
      copy.stepChanged(change['step-id'], change.changes.map((item) => item.pointer).join(', ')),
    ),
    ...diff.edges.added.map((id) => copy.edgeAdded(id)),
    ...diff.edges.removed.map((id) => copy.edgeRemoved(id)),
    ...diff.edges.retargeted.map((id) => copy.edgeRetargeted(id)),
    ...diff['route-order'].map((id) => copy.routeOrder(id)),
    ...MEMBERS.flatMap((member) =>
      diff[member].map((change) => copy.member(copy.members[member], change.pointer)),
    ),
    ...(diff['theme-set-id'] === null ? [] : [copy.theme]),
  ];
  return (
    <div className="flex flex-col gap-4 text-sm">
      {diff.consequences.length > 0 && (
        <ul aria-label={copy.consequences} className="flex flex-col gap-1">
          {diff.consequences.map((consequence) => (
            <li key={`${consequence.code}:${consequence.pointer}`}>
              <span aria-hidden="true">⚠ </span>
              {copy.consequenceWords[consequence.code]} (
              <code className="font-mono text-xs">{consequence.pointer}</code>)
            </li>
          ))}
        </ul>
      )}
      {lines.length > 0 ? (
        <ul aria-label={copy.changes} className="list-disc ps-5">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p>{diff['layout-only'] && diff.consequences.length === 0 ? copy.layoutOnly : copy.same}</p>
      )}
    </div>
  );
}
