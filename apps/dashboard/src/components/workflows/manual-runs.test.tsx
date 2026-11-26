/**
 * Manual runs (C118.5, C141.7): object ids or a CSV of ids, one run per object, and every id or
 * row that started none said by its row and code in words, never with a value (C143.5).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ManualRunsResult } from '../../app/workflows/actions';
import type { ActionResult } from '../../lib/action-state';
import { later } from '../../testing/later';
import { ManualRunForm, refusalWords } from './manual-runs';

const WORKFLOW = 'wfl_01MB0000000000000000000001';
const RUN = 'wfr_01MB0000000000000000000001';
const INQUIRY = 'inq_01MB0000000000000000000009';

const answering = (result: ManualRunsResult) =>
  vi.fn(() => later<ActionResult<ManualRunsResult>>({ ok: true, data: result }));

describe('ManualRunForm (C118.5)', () => {
  it('sends the ids typed, then links each run started and says each refusal by row and code', async () => {
    const user = userEvent.setup();
    const action = answering({
      runIds: [RUN],
      refused: [
        { objectId: INQUIRY, row: null, code: 'object_not_found' },
        { objectId: null, row: 3, code: 'rate_limited' },
      ],
    });
    render(<ManualRunForm workflowId={WORKFLOW} action={action} />);

    const form = screen.getByRole('form', { name: 'Start manual runs' });
    await user.type(within(form).getByRole('textbox', { name: /Object ids/ }), INQUIRY);
    await user.click(within(form).getByRole('button', { name: 'Start the runs' }));

    const results = await screen.findByRole('region', { name: 'Manual run results' });
    expect(within(results).getByRole('link', { name: RUN })).toHaveAttribute(
      'href',
      `/workflows/runs/${RUN}`,
    );
    expect(results).toHaveTextContent(`${INQUIRY}: the object was not found in this environment`);
    expect(results).toHaveTextContent(
      'Row 3: the run was held back by the rate limit (rate_limited)',
    );
    expect(screen.getByRole('status')).toHaveTextContent('1 run started; 2 refused.');
    const sent = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(Object.fromEntries(sent.entries())).toMatchObject({
      'workflow-id': WORKFLOW,
      source: 'ids',
      'object-ids': INQUIRY,
    });
  });

  it('offers a CSV of ids instead, with one object-id column', async () => {
    const user = userEvent.setup();
    render(<ManualRunForm workflowId={WORKFLOW} action={answering({ runIds: [], refused: [] })} />);

    await user.click(screen.getByRole('radio', { name: 'A CSV file of ids' }));

    expect(screen.getByLabelText('CSV file')).toHaveAttribute('accept', '.csv,text/csv');
    expect(screen.getByText(/one column named object-id/)).toBeVisible();
  });
});

/**
 * The codes a manual run refuses an id or row with: `docs/workflows/errors.md` is generated from the
 * API's own list (reference-docs.test.ts fails it when stale), so the test reads them from there.
 */
const MANUAL_RUN_CODES = [
  ...(
    /^- \*\*A manual run, by object:\*\* (.+)$/m.exec(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../../../../../docs/workflows/errors.md'),
        'utf8',
      ),
    )?.[1] ?? ''
  ).matchAll(/`([a-z][a-z0-9_]+)`/g),
].map((match) => String(match[1]));

describe('every manual-run refusal in words (Workflow 8D review R004)', () => {
  it('reads the source list before it reads the words', () => {
    expect(MANUAL_RUN_CODES).toContain('object_id_invalid');
    expect(MANUAL_RUN_CODES).toContain('object_repeated');
  });

  it.each(MANUAL_RUN_CODES)('says %s in words, with its code', (code) => {
    const words = refusalWords(code);

    expect(words).not.toMatch(/^refused \(/);
    expect(words).toMatch(new RegExp(`^\\S.* \\(${code}\\)$`));
  });
});
