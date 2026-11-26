import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../lib/action-state';
import { THEME_IDS } from '../../testing/routes/themes-copy';
import { AssetUploadForm, type UploadedAsset } from './asset-upload-form';

describe('AssetUploadForm (C160.6)', () => {
  it('asks for the licence attestation for a font only', () => {
    render(<AssetUploadForm action={vi.fn()} onUploaded={vi.fn()} />);

    expect(screen.queryByRole('checkbox', { name: /licence for this font/ })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind of file' }), {
      target: { value: 'font' },
    });
    expect(screen.getByRole('checkbox', { name: /licence for this font/ })).toBeVisible();
    expect(screen.getByText(/OpenVerify ships no font/)).toBeVisible();
  });

  it('reports the stored asset and hands it to the editor', async () => {
    const asset: UploadedAsset = { id: THEME_IDS.logo, kind: 'logo', width: 120, height: 40 };
    const action = vi
      .fn<() => Promise<ActionResult<UploadedAsset>>>()
      .mockResolvedValue({ ok: true, data: asset });
    const onUploaded = vi.fn();
    render(<AssetUploadForm action={action} onUploaded={onUploaded} />);

    fireEvent.submit(screen.getByRole('form', { name: 'Logo and font files' }));

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith(asset);
    });
    expect(screen.getByText(new RegExp(`^The logo was stored as ${THEME_IDS.logo}`))).toBeVisible();
  });
});
