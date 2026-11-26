import type { ThemeStyles } from '@openverify/contracts';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import { contrastRows, type ContrastRow, type ThemeVariant } from './theme-model';

const copy = THEMES_COPY.contrast;

/** A result in words with its own icon, so it never rests on colour (1.4.1). */
const RESULT: Readonly<Record<ContrastRow['level'], { icon: string; words: string }>> = {
  pass: { icon: '✓', words: copy.pass },
  warn: { icon: '!', words: copy.warn },
  fail: { icon: '✗', words: copy.fail },
};

export interface ContrastTableProps {
  readonly styles: ThemeStyles;
  readonly variant: ThemeVariant;
  /** The variant's name in words, such as "Light". */
  readonly label: string;
}

/**
 * C160.4: every pair of the gate in one palette, with its ratio never rounded, its required
 * minimum and its result, computed live by `@openverify/core`'s gate over the cells as typed (an
 * empty cell takes the built-in token, as the API resolves it). The API runs the same gate on
 * every save; this table never replaces its answer.
 */
export function ContrastTable({ styles, variant, label }: ContrastTableProps) {
  const rows = contrastRows(styles, variant);
  const failures = rows.filter((row) => row.level === 'fail').length;
  const warnings = rows.filter((row) => row.level === 'warn').length;
  return (
    <div className="flex flex-col gap-2 overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="mb-2 text-left font-medium text-ink">{copy.caption(label)}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pe-3 font-medium">
              {copy.foreground}
            </th>
            <th scope="col" className="py-2 pe-3 font-medium">
              {copy.background}
            </th>
            <th scope="col" className="py-2 pe-3 font-medium">
              {copy.purpose}
            </th>
            <th scope="col" className="py-2 pe-3 font-medium">
              {copy.ratio}
            </th>
            <th scope="col" className="py-2 pe-3 font-medium">
              {copy.required}
            </th>
            <th scope="col" className="py-2 font-medium">
              {copy.result}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.foreground}/${row.background}`}
              data-level={row.level}
              className="border-b border-line"
            >
              <th scope="row" className="py-2 pe-3 font-normal">
                <code className="font-mono text-xs">{row.foreground}</code>
              </th>
              <td className="py-2 pe-3">
                <code className="font-mono text-xs">{row.background}</code>
              </td>
              <td className="py-2 pe-3">{copy.purposeWords[row.purpose]}</td>
              <td className="py-2 pe-3 font-mono text-xs">{copy.ratioValue(row.ratio)}</td>
              <td className="py-2 pe-3 font-mono text-xs">{copy.requiredValue(row.required)}</td>
              <td className={row.level === 'fail' ? 'py-2 font-medium text-danger' : 'py-2'}>
                <span aria-hidden="true" className="me-1">
                  {RESULT[row.level].icon}
                </span>
                {RESULT[row.level].words}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-ink">{copy.summary(failures, warnings)}</p>
    </div>
  );
}

/** What the gate does not cover, and why the line colour has no pair (C160.4, C160.10). */
export function ContrastLimits() {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-ink-muted">{copy.lineNote}</p>
      <h3 className="font-medium text-ink">{copy.notCovered}</h3>
      <ul className="list-disc ps-5 text-ink-muted">
        {Object.entries(copy.notCoveredItems).map(([key, item]) => (
          <li key={key}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
