'use client';

/**
 * The variable picker (C115.3, C141.4): every path a step can read where it stands, each with its
 * type and its marks in words, never by colour alone: "can be unknown (null)" (C114.6) and
 * "personal data" (C115.6). Picking one inserts `{{ path }}` into the field it was opened from.
 */
import { Button } from '@openverify/ui';
import { useId, useState } from 'react';
import { Dialog } from '../../dialog';
import type { ScopePath } from './variable-scope';

/** A path's type and marks, in words. */
export function pathMarks(path: ScopePath): string {
  const type = path.type === 'enum' ? `one of ${path.options.join(', ')}` : path.type;
  return [
    type,
    ...(path.nullable ? ['can be unknown (null)'] : []),
    ...(path.pii ? ['personal data'] : []),
    // C150.8, C150.10: a flow fact also says where it comes from, its tier and its stage.
    ...('tier' in path || 'stage' in path
      ? [
          path.source,
          ...(path.tier === undefined || path.tier === null ? [] : [`tier ${path.tier}`]),
          ...(path.stage === 'beta' ? ['beta'] : []),
        ]
      : []),
  ].join(' · ');
}

/** A list of paths with their marks, for the panels (C141.9). */
export function PathList({
  label,
  paths,
  empty,
}: {
  readonly label: string;
  readonly paths: readonly ScopePath[];
  readonly empty: string;
}) {
  return paths.length === 0 ? (
    <p className="text-sm text-ink-muted">{empty}</p>
  ) : (
    <ul aria-label={label} className="flex flex-col gap-1 text-sm">
      {paths.map((path) => (
        <li key={path.path}>
          <code className="font-mono text-xs break-all">{path.path}</code>: {pathMarks(path)}
        </li>
      ))}
    </ul>
  );
}

export interface VariablePickerProps {
  readonly open: boolean;
  /** The field it inserts into, in words. */
  readonly field: string;
  readonly scope: readonly ScopePath[];
  readonly onPick: (path: string) => void;
  readonly onClose: () => void;
}

export function VariablePicker({ open, field, scope, onPick, onClose }: VariablePickerProps) {
  const id = useId();
  const [filter, setFilter] = useState('');
  const wanted = filter.trim().toLowerCase();
  const shown = scope.filter((path) => wanted === '' || path.path.toLowerCase().includes(wanted));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Insert a variable"
      description={`Inserts {{ path }} into ${field}. Each path says its type, whether it can be unknown (null) and whether it is personal data.`}
    >
      <div className="flex flex-col gap-3">
        <label htmlFor={`${id}-filter`} className="text-sm font-medium">
          Filter paths
        </label>
        <input
          id={`${id}-filter`}
          value={filter}
          onChange={(event) => {
            setFilter(event.currentTarget.value);
          }}
          className="min-h-11 rounded-md border border-control bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        <ul aria-label="Paths in scope" className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {shown.map((path) => (
            <li key={path.path} className="flex flex-wrap items-center gap-2 text-sm">
              <Button
                variant="secondary"
                onClick={() => {
                  onPick(path.path);
                }}
              >
                Insert {path.path}
              </Button>
              <span>
                {path.source}: {pathMarks(path)}
              </span>
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="text-sm">No path in scope matches.</p>}
        <div>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
