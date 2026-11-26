import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../lib/action-state';
import { previewDocument, type TemplatePreviewDocument } from '../../testing/routes/preview';
import { THEME_IDS } from '../../testing/routes/themes-copy';
import { ThemePreview } from './theme-preview';

const frames: unknown[] = [];
vi.mock('../flow-preview/flow-preview-frame', () => ({
  FlowPreviewFrame: (props: {
    document: unknown;
    scheme: string;
    assetUrl: (id: string) => string;
  }) => {
    frames.push(props);
    return <p>{`frame ${props.scheme} ${props.assetUrl('tsa_x')}`}</p>;
  },
}));

const TEMPLATES = [
  { id: THEME_IDS.template, name: 'Synthetic template', versionId: THEME_IDS.version },
];

describe('ThemePreview (C156.1, C160)', () => {
  it('previews the unsaved styles on the chosen template in the flow’s frame', async () => {
    const document = previewDocument();
    const action = vi
      .fn<() => Promise<ActionResult<TemplatePreviewDocument>>>()
      .mockResolvedValue({ ok: true, data: document });
    render(
      <ThemePreview
        flowOrigin="https://flow.example.test"
        templates={TEMPLATES}
        styles={{ light: { palette: { primary: '#1447e6' } } }}
        action={action}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Variant' }), {
      target: { value: 'dark' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview these styles' }));

    await waitFor(() => {
      expect(
        screen.getByText(`frame dark /templates/${THEME_IDS.template}/preview/assets/tsa_x`),
      ).toBeVisible();
    });
    const sent = action.mock.calls[0] as unknown as [unknown, FormData];
    expect(sent[1].get('version-id')).toBe(THEME_IDS.version);
    expect(JSON.parse(sent[1].get('styles') as string)).toEqual({
      light: { palette: { primary: '#1447e6' } },
    });
    expect(frames.at(-1)).toMatchObject({ document, flowOrigin: 'https://flow.example.test' });
  });

  it('says when there is no template to preview with', () => {
    render(<ThemePreview flowOrigin={null} templates={[]} styles={{}} action={vi.fn()} />);

    expect(screen.getByText('This environment has no template to preview with yet.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Preview these styles' })).toBeNull();
  });
});
