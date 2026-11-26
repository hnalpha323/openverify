import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import {
  PREVIEW_IDS,
  builtinPreset,
  ownPreset,
  simulationDocument,
} from '../../testing/routes/preview';
import type { ScopeSubjects } from './scope-form-model';
import { SimulatePanel, type SimulatePanelProps } from './simulate-panel';

const copy = PREVIEW_COPY.simulate;

const SUBJECTS: ScopeSubjects = {
  verifications: [{ id: 'id_card', type: 'government_id' }],
  workflows: [],
  signals: [{ name: 'inquiry/bot_score', valueType: 'integer' }],
  lists: [],
};

function setup(props: Partial<SimulatePanelProps> = {}) {
  const simulate = vi.fn<SimulatePanelProps['simulate']>(() =>
    Promise.resolve({ ok: true, data: simulationDocument() }),
  );
  const save = vi.fn<SimulatePanelProps['save']>((input) =>
    Promise.resolve({
      ok: true,
      data: ownPreset(input.scope, 'ssp_01JB0000000000000000000P09', input.name),
    }),
  );
  const remove = vi.fn<SimulatePanelProps['remove']>(() =>
    Promise.resolve({ ok: true, data: undefined }),
  );
  render(
    <SimulatePanel
      versionId={PREVIEW_IDS.version}
      subjects={SUBJECTS}
      presets={[
        builtinPreset('government-id', 'failed'),
        ownPreset(),
        ownPreset(null, 'ssp_01JB0000000000000000000P02', 'Synthetic hidden'),
      ]}
      simulate={simulate}
      save={save}
      remove={remove}
      {...props}
    />,
  );
  return { simulate, save, remove };
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
  });
}

const presetSelect = () => screen.getByLabelText(copy.preset);
const choosePreset = (value: string) => {
  fireEvent.change(presetSelect(), { target: { value } });
};

describe('simulate with presets (C156.4)', () => {
  it('says to use synthetic values only, and labels every preset so', () => {
    setup();

    expect(screen.getByText(copy.syntheticOnly)).toBeVisible();
    const options = within(presetSelect()).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      copy.noPreset,
      `Synthetic government id fails (${copy.builtIn}, ${copy.presetLabel})`,
      `Synthetic failed capture on a phone (${copy.presetLabel})`,
      `Synthetic hidden (${copy.presetLabel})`,
    ]);
  });

  it('simulates the scope the form builds, and shows the path labelled simulated', async () => {
    const { simulate } = setup();

    fireEvent.change(screen.getByLabelText(`id_card: ${copy.verificationStatus}`), {
      target: { value: 'failed' },
    });
    await click(copy.run);

    expect(simulate).toHaveBeenCalledWith({
      'version-id': PREVIEW_IDS.version,
      body: { meta: { scope: { verifications: { id_card: { status: 'failed' } } } } },
    });
    expect(screen.getByRole('region', { name: PREVIEW_COPY.path.heading })).toBeVisible();
  });

  it('simulates a built-in preset by its id, without showing or sending values', async () => {
    const { simulate } = setup();

    choosePreset('builtin:government-id-failed');
    expect(screen.queryByLabelText(`id_card: ${copy.verificationStatus}`)).toBeNull();
    await click(copy.run);

    expect(simulate).toHaveBeenCalledWith({
      'version-id': PREVIEW_IDS.version,
      body: { meta: { 'preset-id': 'builtin:government-id-failed' } },
    });
  });

  it('loads my preset’s values into the form, and simulates them', async () => {
    const { simulate } = setup();

    choosePreset(PREVIEW_IDS.preset);
    expect(screen.getByLabelText(`id_card: ${copy.verificationStatus}`)).toHaveValue('failed');
    await click(copy.run);

    expect(simulate.mock.calls[0]?.[0].body).toEqual({
      meta: {
        scope: { verifications: { id_card: { status: 'failed' } }, device: { kind: 'mobile-web' } },
      },
    });
  });

  it('never offers to edit a preset whose values are hidden (no pii:view), and simulates it by id', async () => {
    const { simulate } = setup();

    choosePreset('ssp_01JB0000000000000000000P02');
    expect(screen.getByText(copy.scopeHidden)).toBeVisible();
    expect(screen.queryByLabelText(`id_card: ${copy.verificationStatus}`)).toBeNull();
    await click(copy.run);

    expect(simulate.mock.calls[0]?.[0].body).toEqual({
      meta: { 'preset-id': 'ssp_01JB0000000000000000000P02' },
    });
  });

  it('refuses a malformed value before calling, naming it', async () => {
    const { simulate } = setup();

    fireEvent.change(screen.getByLabelText(`inquiry/bot_score: ${copy.signalState}`), {
      target: { value: 'set' },
    });
    fireEvent.change(screen.getByLabelText(`inquiry/bot_score: ${copy.signalValue}`), {
      target: { value: 'high' },
    });
    await click(copy.run);

    expect(simulate).not.toHaveBeenCalled();
    expect(screen.getByText('inquiry/bot_score: a whole number is expected.')).toBeVisible();
  });

  it('shows the API’s refusal at the scope', async () => {
    const { simulate } = setup();
    simulate.mockResolvedValue({
      ok: false,
      problem: {
        title: 'Unprocessable',
        status: 422,
        errors: [{ pointer: '/meta/scope/verifications/id_card', detail: 'Synthetic refusal.' }],
      },
    });

    await click(copy.run);

    expect(
      screen.getByText(/Synthetic refusal\. \(\/meta\/scope\/verifications\/id_card\)/),
    ).toBeVisible();
  });

  it('saves the form as a preset of mine, and lists it', async () => {
    const { save } = setup();

    fireEvent.change(screen.getByLabelText(`id_card: ${copy.verificationStatus}`), {
      target: { value: 'needs_review' },
    });
    fireEvent.change(screen.getByLabelText(copy.presetName), {
      target: { value: 'Synthetic review' },
    });
    await click(copy.savePreset);

    expect(save).toHaveBeenCalledWith({
      name: 'Synthetic review',
      scope: { verifications: { id_card: { status: 'needs_review' } } },
    });
    expect(screen.getByText(copy.saved)).toBeVisible();
    expect(
      within(presetSelect()).getByRole('option', {
        name: `Synthetic review (${copy.presetLabel})`,
      }),
    ).toBeInTheDocument();
  });

  it('deletes a preset of mine after a confirmation, and never offers to delete a built-in', async () => {
    const { remove } = setup();

    choosePreset('builtin:government-id-failed');
    expect(screen.queryByRole('button', { name: copy.deletePreset })).toBeNull();

    choosePreset(PREVIEW_IDS.preset);
    await click(copy.deletePreset);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(copy.deleteConfirm('Synthetic failed capture on a phone'));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: copy.deletePreset }));
      await Promise.resolve();
    });

    expect(remove).toHaveBeenCalledWith({ id: PREVIEW_IDS.preset });
    expect(screen.getByText(copy.deleted)).toBeVisible();
    expect(
      within(presetSelect()).queryByRole('option', {
        name: `Synthetic failed capture on a phone (${copy.presetLabel})`,
      }),
    ).toBeNull();
  });

  it('sends every kind of simulated fact the form holds, null where chosen', async () => {
    const { simulate } = setup({
      subjects: {
        ...SUBJECTS,
        workflows: [{ id: 'risk_run' }],
        lists: ['blocklist_main'],
      },
    });
    const change = (label: string, value: string) => {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    };

    change(`id_card: ${copy.checks}`, 'id_expired, failed');
    change(`id_card: ${copy.extractions}`, '{"age-years": 17}');
    change(`inquiry/bot_score: ${copy.signalState}`, 'null');
    change(copy.listLabel('blocklist_main'), 'matched');
    change(`risk_run: ${copy.workflowStatus}`, 'errored');
    change(`risk_run: ${copy.workflowErrorType}`, 'timeout');
    change(`risk_run: ${copy.workflowOutputs}`, '{"level": "high"}');
    change(copy.deviceKind, 'null');
    change(copy.devicePlatform, 'android');
    change(copy.inquiryTags, 'vip');
    change(copy.fields, '{"name_first": "Synthetic"}');
    await click(copy.run);

    expect(simulate.mock.calls[0]?.[0].body).toEqual({
      meta: {
        scope: {
          verifications: {
            id_card: { checks: { id_expired: 'failed' }, extractions: { 'age-years': 17 } },
          },
          signals: { 'inquiry/bot_score': null },
          lists: { blocklist_main: { matched: true } },
          device: { kind: null, platform: 'android' },
          workflows: {
            risk_run: { status: 'errored', 'error-type': 'timeout', outputs: { level: 'high' } },
          },
          inquiry: { tags: ['vip'] },
          fields: { name_first: 'Synthetic' },
        },
      },
    });
  });

  it('shows a refused save and a refused delete, keeping the presets', async () => {
    const { save, remove } = setup();
    save.mockResolvedValue({ ok: false, problem: { title: 'Synthetic refusal', status: 403 } });
    remove.mockResolvedValue({
      ok: false,
      problem: { title: 'Synthetic gone', detail: 'Synthetic detail.', status: 404 },
    });

    fireEvent.change(screen.getByLabelText(copy.presetName), { target: { value: 'Synthetic' } });
    await click(copy.savePreset);
    expect(screen.getByText('Synthetic refusal')).toBeVisible();

    choosePreset(PREVIEW_IDS.preset);
    await click(copy.deletePreset);
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: copy.deletePreset }),
      );
      await Promise.resolve();
    });
    expect(screen.getByText('Synthetic gone: Synthetic detail.')).toBeVisible();
    expect(within(presetSelect()).getAllByRole('option')).toHaveLength(4);
  });
});
