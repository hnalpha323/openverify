import type { WorkflowVersionDiffDocument } from '@openverify/contracts';

type Diff = WorkflowVersionDiffDocument['data']['attributes'];
type Change = Diff['trigger-changes'][number];

const pointers = (changes: readonly Change[]) => changes.map((change) => change.pointer).join(', ');

/** Each change as a sentence: a word says what happened, so nothing rests on colour (1.4.1). */
function linesOf(diff: Diff): string[] {
  const lines = [
    ...diff.steps.added.map((id) => `Added step ${id}`),
    ...diff.steps.removed.map((id) => `Removed step ${id}`),
    ...diff.steps.changed.map((step) => `Changed step ${step.id}: ${pointers(step.changes)}`),
    ...diff.edges.added.map((id) => `Added edge ${id}`),
    ...diff.edges.removed.map((id) => `Removed edge ${id}`),
  ];
  const groups: readonly [string, readonly Change[]][] = [
    ['the trigger', diff['trigger-changes']],
    ['the inputs', diff['input-changes']],
    ['the outputs', diff['output-changes']],
    ['the variables', diff['variable-changes']],
  ];
  for (const [what, changes] of groups) {
    if (changes.length > 0) {
      lines.push(`Changed ${what}: ${pointers(changes)}`);
    }
  }
  if (diff['layout-changes'].length > 0) {
    lines.push(`Moved only: ${diff['layout-changes'].join(', ')}`);
  }
  return lines;
}

/** C116.6: what the draft changes against the live version, from the server's diff, as a list. */
export function VersionDiff({ diff }: { readonly diff: WorkflowVersionDiffDocument['data'] }) {
  const lines = linesOf(diff.attributes);
  return (
    <section
      aria-labelledby="draft-changes"
      className="flex flex-col gap-2 rounded-lg border border-line p-3"
    >
      <h2 id="draft-changes" className="text-base font-semibold">
        Changes against the live version
      </h2>
      {lines.length === 0 ? (
        <p className="text-sm">No change: the draft holds what the live version holds.</p>
      ) : (
        <ul className="list-disc pl-5 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
