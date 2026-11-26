/**
 * C43, C45.4: `docs/checks/selfie.md` copies the virtual-camera list of
 * `selfie_liveness_detection` from {@link VIRTUAL_CAMERA_NAMES}, and this test keeps the two
 * equal: the same labels, match kinds and sources, in the same order. The copy sits between the
 * `virtual-cameras:start` and `virtual-cameras:end` comments, as a Markdown table whose cells
 * hold the label and the match kind in backticks, then the source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIRTUAL_CAMERA_NAMES } from './virtual-cameras.js';

const DOC = path.resolve(import.meta.dirname, '../../../../docs/checks/selfie.md');
const START = '<!-- virtual-cameras:start -->';
const END = '<!-- virtual-cameras:end -->';

/** The rows of the documented list, read back into the data file's shape. */
function documentedList(markdown: string) {
  const start = markdown.indexOf(START);
  const end = markdown.indexOf(END);
  expect(start, `${START} in ${DOC}`).toBeGreaterThanOrEqual(0);
  expect(end, `${END} after ${START}`).toBeGreaterThan(start);
  const rows = markdown
    .slice(start + START.length, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .slice(2); // the header and its separator
  return rows.map((row) => {
    const cells = row
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    const unquote = (cell: string | undefined) => /^`(.*)`$/.exec(cell ?? '')?.[1] ?? cell;
    return { name: unquote(cells[0]), match: unquote(cells[1]), source: cells[2] };
  });
}

describe('the documented virtual-camera list (C43, C45.4)', () => {
  it('equals VIRTUAL_CAMERA_NAMES: labels, match kinds and sources, in order', () => {
    const documented = documentedList(readFileSync(DOC, 'utf8'));

    expect(documented).toEqual(
      VIRTUAL_CAMERA_NAMES.map(({ name, match, source }) => ({ name, match, source })),
    );
  });
});
