/**
 * The case page's modules in the version's layout (C172.1): columns side by side on a wide screen
 * and one after another on a narrow one (1.4.10), each module in its column's order, a collapsed one
 * behind a disclosure that opens for printing (the print button opens every closed disclosure).
 */
import type { CaseLayoutModule } from '@openverify/core';
import type { ReactNode } from 'react';
import { CASES_REPORTS_COPY } from '../../../lib/copy/cases-reports';
import { LAYOUT_MODULE_WORDS } from '../case-words';
import type { ModuleArrangement } from './layout-model';

export interface CaseLayoutGridProps {
  readonly arrangement: ModuleArrangement;
  /** Each module's section; a module with none (no data for it) is left out. */
  readonly nodes: Readonly<Partial<Record<CaseLayoutModule, ReactNode>>>;
}

const GRID_COLUMNS: Readonly<Record<number, string>> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
};

export function CaseLayoutGrid({ arrangement, nodes }: CaseLayoutGridProps) {
  return (
    <div className={`grid grid-cols-1 gap-8 ${GRID_COLUMNS[arrangement.columns] ?? ''}`}>
      {arrangement.placed.map((column, index) => (
        <div
          // The columns are fixed by the layout and never reordered.
          key={`column-${String(index + 1)}`}
          role="region"
          aria-label={`${CASES_REPORTS_COPY.layout.column} ${String(index + 1)}`}
          className="flex min-w-0 flex-col gap-8"
        >
          {column.map(({ key, collapsed }) => {
            const node = nodes[key];
            if (node === undefined || node === null || node === false) {
              return null;
            }
            return collapsed ? (
              <details key={key} className="rounded-lg border border-line p-3">
                <summary className="min-h-6 cursor-pointer font-semibold">
                  {LAYOUT_MODULE_WORDS[key]}
                </summary>
                <div className="mt-3">{node}</div>
              </details>
            ) : (
              <div key={key}>{node}</div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
