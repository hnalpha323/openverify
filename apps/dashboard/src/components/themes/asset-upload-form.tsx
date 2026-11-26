'use client';

import { Alert, Checkbox } from '@openverify/ui';
import { useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';

const copy = THEMES_COPY.assets;

/** A stored asset as the editor offers it: its id and kind, never its bytes. */
export interface UploadedAsset {
  readonly id: string;
  readonly kind: 'logo' | 'font';
  readonly width: number | null;
  readonly height: number | null;
}

/**
 * C160.6: uploads a logo (PNG, JPEG or WebP; the API re-encodes it before it answers) or a WOFF2
 * font with the operator's licence attestation (decision 27). The API types the file by its bytes:
 * SVG is refused with `asset_type_refused`, said in words.
 */
export function AssetUploadForm({
  action,
  onUploaded,
}: {
  readonly action: (
    state: ActionState<UploadedAsset>,
    formData: FormData,
  ) => Promise<ActionResult<UploadedAsset>>;
  readonly onUploaded: (asset: UploadedAsset) => void;
}) {
  const [kind, setKind] = useState<'logo' | 'font'>('logo');
  const [uploaded, setUploaded] = useState<readonly UploadedAsset[]>([]);
  const form = useFormAction(action, {
    resetOnSuccess: true,
    onSuccess: (asset) => {
      setUploaded((current) => [...current, asset]);
      onUploaded(asset);
    },
  });
  return (
    <form {...form.formProps} aria-label={copy.heading} className="flex max-w-xl flex-col gap-4">
      <h2 className="text-base font-semibold text-ink">{copy.heading}</h2>
      <p className="text-sm text-ink-muted">{copy.description}</p>
      <FormField label={copy.kind}>
        {(control) => (
          <select
            {...control}
            name="kind"
            value={kind}
            onChange={(event) => {
              setKind(event.currentTarget.value === 'font' ? 'font' : 'logo');
            }}
            className={controlClassName(control)}
          >
            <option value="logo">{copy.logo}</option>
            <option value="font">{copy.font}</option>
          </select>
        )}
      </FormField>
      <FormField label={copy.file} error={fieldErrorOf(form.problem, '/file')} required>
        {(control) => (
          <input
            {...control}
            type="file"
            name="file"
            accept={kind === 'logo' ? 'image/png,image/jpeg,image/webp' : '.woff2,font/woff2'}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      {kind === 'font' && (
        <>
          <Checkbox name="licence-attested" label={copy.attest} />
          <FormField label={copy.unicodeRange} description={copy.unicodeRangeHint}>
            {(control) => (
              <input
                {...control}
                name="unicode-range"
                autoComplete="off"
                maxLength={2000}
                className={controlClassName(control)}
              />
            )}
          </FormField>
        </>
      )}
      <ProblemDisplay problem={form.problem} />
      <div role="status" aria-live="polite">
        {uploaded.length > 0 && (
          <Alert tone="success" title={copy.uploadedHeading}>
            <ul className="list-disc ps-5">
              {uploaded.map((asset) => (
                <li key={asset.id}>{copy.uploaded(copy.kindWords[asset.kind], asset.id)}</li>
              ))}
            </ul>
          </Alert>
        )}
      </div>
      <p className="text-sm text-ink-muted">{copy.noAssetList}</p>
      <div>
        <SubmitButton pending={form.pending} pendingLabel={THEMES_COPY.editor.saving}>
          {copy.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
