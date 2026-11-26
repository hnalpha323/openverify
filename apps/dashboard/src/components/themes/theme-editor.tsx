'use client';

import type { ThemeStyles } from '@openverify/contracts';
import { BUILTIN_PALETTES, CONTRAST_PALETTE_TOKENS, type ContrastToken } from '@openverify/core';
import { Alert, Checkbox } from '@openverify/ui';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';
import { AssetUploadForm, type UploadedAsset } from './asset-upload-form';
import { ContrastLimits, ContrastTable } from './contrast-table';
import { PaletteSwatches } from './palette-swatches';
import { ThemePreview, type PreviewTemplate } from './theme-preview';
import type { TemplatePreviewDocument } from '../../lib/api/template-preview';
import {
  THEME_VARIANTS,
  editorStateOf,
  resolvedPalette,
  stylesOfEditor,
  type ThemeEditorState,
  type ThemeVariant,
} from './theme-model';

const copy = THEMES_COPY.editor;

/** C160.6: the built-in radius when `shape.radius` is absent (the stylesheet's `rounded-md`). */
const BUILTIN_RADIUS = 6;

export type ThemeSaveResult =
  | { readonly kind: 'saved'; readonly revision: number }
  | {
      readonly kind: 'refused';
      readonly pairs: readonly {
        readonly pointer: string;
        readonly foreground: string;
        readonly background: string;
        readonly ratio: number;
        readonly required: number;
      }[];
    };

export interface ThemeEditorProps {
  readonly themeSetId: string;
  readonly styles: ThemeStyles;
  /** Without it (a reader, or an archived set) the editor only shows the styles and contrast. */
  readonly saveAction?: (
    state: ActionState<ThemeSaveResult>,
    formData: FormData,
  ) => Promise<ActionResult<ThemeSaveResult>>;
  readonly uploadAction?: (
    state: ActionState<UploadedAsset>,
    formData: FormData,
  ) => Promise<ActionResult<UploadedAsset>>;
  /** The environment's `organization-display-name`, shown with a decorative logo; `null` unknown. */
  readonly organizationName: string | null;
  /** Real screens through the preview frame; without it (no template read) the swatches stand in. */
  readonly preview?: {
    readonly flowOrigin: string | null;
    readonly templates: readonly PreviewTemplate[];
    readonly action: (
      state: ActionState<TemplatePreviewDocument>,
      formData: FormData,
    ) => Promise<ActionResult<TemplatePreviewDocument>>;
  };
}

const VARIANT_WORDS: Readonly<Record<ThemeVariant, string>> = {
  light: copy.light,
  dark: copy.dark,
};

/**
 * C160.3-C160.6 (Workflow 9C, `dashboard-themes-copy`): the theme set editor. The twelve tokens of
 * each palette as hex (an empty cell keeps the built-in token), the radius, the font (the system
 * font, or an uploaded WOFF2 under the operator's licence attestation) and the logo (decorative, or
 * with the copy key of its text alternative), with the contrast of every pair of both palettes
 * computed live by the API's own gate. Saving replaces the whole tree as one revision; the API's
 * answer (a revision, or the refused pairs) is what the editor reports.
 */
export function ThemeEditor({
  themeSetId,
  styles: stored,
  saveAction,
  uploadAction,
  organizationName,
  preview,
}: ThemeEditorProps) {
  const id = useId();
  const router = useRouter();
  const [state, setState] = useState<ThemeEditorState>(() => editorStateOf(stored));
  const [assets, setAssets] = useState<readonly UploadedAsset[]>([]);
  const [outcome, setOutcome] = useState<ThemeSaveResult | null>(null);
  const [showInvalid, setShowInvalid] = useState(false);
  const { styles, invalid } = stylesOfEditor(state);
  const readOnly = saveAction === undefined;
  const form = useFormAction<ThemeSaveResult>(
    saveAction ?? (() => Promise.resolve({ ok: false, problem: { title: copy.readOnly } })),
    {
      onSuccess: (result) => {
        setOutcome(result);
        if (result.kind === 'saved') {
          router.refresh();
        }
      },
    },
  );
  const invalidAt = (variant: ThemeVariant | null, token: ContrastToken | 'radius') =>
    showInvalid && invalid.some((cell) => cell.variant === variant && cell.token === token);
  const setCell = (variant: ThemeVariant, token: ContrastToken, value: string) => {
    setState((current) => ({
      ...current,
      cells: { ...current.cells, [variant]: { ...current.cells[variant], [token]: value } },
    }));
  };
  const fonts = [
    ...new Set([
      ...(state.fontAssetId === null ? [] : [state.fontAssetId]),
      ...assets.filter((asset) => asset.kind === 'font').map((asset) => asset.id),
    ]),
  ];
  const logos = [
    ...new Set([
      ...(state.logo === null ? [] : [state.logo.assetId]),
      ...assets.filter((asset) => asset.kind === 'logo').map((asset) => asset.id),
    ]),
  ];

  return (
    <div className="flex flex-col gap-8">
      <form
        {...form.formProps}
        onSubmit={(event) => {
          if (invalid.length > 0) {
            event.preventDefault();
            setShowInvalid(true);
            return;
          }
          setOutcome(null);
          form.formProps.onSubmit(event);
        }}
        aria-label={copy.heading}
        className="flex flex-col gap-6"
      >
        <input type="hidden" name="theme-set-id" value={themeSetId} />
        <input type="hidden" name="styles" value={JSON.stringify(styles)} />
        <p className="text-sm text-ink-muted">{copy.description}</p>
        {readOnly && <p className="text-sm text-ink-muted">{copy.readOnly}</p>}
        <fieldset className="flex flex-col gap-3" disabled={readOnly}>
          <Checkbox
            label={copy.darkToggle}
            description={copy.darkHint}
            checked={state.useDark}
            onChange={(event) => {
              const useDark = event.currentTarget.checked;
              setState((current) => ({ ...current, useDark }));
            }}
          />
          <FormField label={copy.preferredLabel}>
            {(control) => (
              <select
                {...control}
                value={state.preferred ?? 'light'}
                onChange={(event) => {
                  const preferred = event.currentTarget.value === 'dark' ? 'dark' : 'light';
                  setState((current) => ({ ...current, preferred }));
                }}
                className={controlClassName(control)}
              >
                <option value="light">{copy.light}</option>
                <option value="dark">{copy.dark}</option>
              </select>
            )}
          </FormField>
        </fieldset>
        {THEME_VARIANTS.map((variant) => (
          <fieldset key={variant} className="flex flex-col gap-4" disabled={readOnly}>
            <legend className="text-base font-semibold text-ink">
              {copy.paletteLegend(VARIANT_WORDS[variant])}
            </legend>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CONTRAST_PALETTE_TOKENS.map((token) => (
                <FormField
                  key={token}
                  label={copy.tokenWords[token]}
                  description={copy.builtIn(BUILTIN_PALETTES[variant][token])}
                  error={invalidAt(variant, token) ? copy.notHex : undefined}
                >
                  {(control) => (
                    <input
                      {...control}
                      name={`${variant}-${token}`}
                      value={state.cells[variant][token] ?? ''}
                      placeholder={BUILTIN_PALETTES[variant][token]}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={7}
                      onChange={(event) => {
                        setCell(variant, token, event.currentTarget.value);
                      }}
                      className={controlClassName(control)}
                    />
                  )}
                </FormField>
              ))}
            </div>
            <PaletteSwatches
              palette={resolvedPalette(styles, variant)}
              label={`${copy.previewHeading}: ${copy.paletteLegend(VARIANT_WORDS[variant])}`}
              radius={styles.shape?.radius ?? BUILTIN_RADIUS}
            />
            <ContrastTable styles={styles} variant={variant} label={VARIANT_WORDS[variant]} />
          </fieldset>
        ))}
        <p className="text-sm text-ink-muted">{copy.previewNote}</p>
        <ContrastLimits />
        <fieldset className="flex flex-col gap-4" disabled={readOnly}>
          <FormField
            label={copy.radius}
            description={copy.radiusHint(BUILTIN_RADIUS)}
            error={invalidAt(null, 'radius') ? copy.radiusInvalid : undefined}
          >
            {(control) => (
              <input
                {...control}
                inputMode="numeric"
                value={state.radius}
                placeholder={String(BUILTIN_RADIUS)}
                onChange={(event) => {
                  const radius = event.currentTarget.value;
                  setState((current) => ({ ...current, radius }));
                }}
                className={controlClassName(control)}
              />
            )}
          </FormField>
        </fieldset>
        <fieldset className="flex flex-col gap-3" disabled={readOnly}>
          <legend className="text-base font-semibold text-ink">{copy.fontLegend}</legend>
          <FormField label={copy.fontAsset} description={copy.fontNote}>
            {(control) => (
              <select
                {...control}
                value={state.fontAssetId ?? ''}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setState((current) => ({ ...current, fontAssetId: value === '' ? null : value }));
                }}
                className={controlClassName(control)}
              >
                <option value="">{copy.fontSystem}</option>
                {fonts.map((font) => (
                  <option key={font} value={font}>
                    {`${copy.fontUploaded}: ${font}`}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {fonts.length === 0 && <p className="text-sm text-ink-muted">{copy.fontNone}</p>}
        </fieldset>
        <fieldset className="flex flex-col gap-3" disabled={readOnly}>
          <legend className="text-base font-semibold text-ink">{copy.logoLegend}</legend>
          <FormField label={copy.logoAsset}>
            {(control) => (
              <select
                {...control}
                value={state.logo?.assetId ?? ''}
                onChange={(event) => {
                  const assetId = event.currentTarget.value;
                  setState((current) => ({
                    ...current,
                    logo:
                      assetId === ''
                        ? null
                        : {
                            assetId,
                            decorative: current.logo?.decorative ?? false,
                            altKey: current.logo?.altKey ?? '',
                          },
                  }));
                }}
                className={controlClassName(control)}
              >
                <option value="">{copy.logoNone}</option>
                {logos.map((logo) => (
                  <option key={logo} value={logo}>
                    {logo}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {state.logo !== null && (
            <>
              {/* The stored rendition, through the console's asset route: never a remote URL. */}
              <img
                src={`/theme-sets/assets/${state.logo.assetId}/content`}
                alt={THEMES_COPY.assets.previewAlt}
                className="max-h-16 w-auto self-start"
              />
              <Checkbox
                label={copy.logoDecorative}
                description={
                  organizationName === null
                    ? copy.logoDecorativeHint
                    : `${copy.logoDecorativeHint} (${organizationName})`
                }
                checked={state.logo.decorative}
                onChange={(event) => {
                  const decorative = event.currentTarget.checked;
                  setState((current) =>
                    current.logo === null
                      ? current
                      : { ...current, logo: { ...current.logo, decorative } },
                  );
                }}
              />
              {!state.logo.decorative && (
                <FormField label={copy.logoAltKey} description={copy.logoAltHint} required>
                  {(control) => (
                    <input
                      {...control}
                      value={state.logo?.altKey ?? ''}
                      maxLength={200}
                      onChange={(event) => {
                        const altKey = event.currentTarget.value;
                        setState((current) =>
                          current.logo === null
                            ? current
                            : { ...current, logo: { ...current.logo, altKey } },
                        );
                      }}
                      className={controlClassName(control)}
                    />
                  )}
                </FormField>
              )}
            </>
          )}
        </fieldset>
        <div role="status" aria-live="polite" id={`${id}-status`}>
          {outcome?.kind === 'saved' && (
            <Alert tone="success">{copy.saved(outcome.revision)}</Alert>
          )}
          {outcome?.kind === 'refused' && (
            <Alert tone="error" title={THEMES_COPY.contrast.refusedHeading}>
              <ul className="list-disc ps-5">
                {outcome.pairs.map((pair) => (
                  <li key={pair.pointer + pair.background}>
                    {THEMES_COPY.contrast.refusedPair(
                      pair.foreground,
                      pair.background,
                      pair.ratio,
                      pair.required,
                    )}{' '}
                    <code className="font-mono text-xs">{pair.pointer}</code>
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
        <ProblemDisplay problem={form.problem} />
        {!readOnly && (
          <div>
            <SubmitButton pending={form.pending} pendingLabel={copy.saving}>
              {copy.save}
            </SubmitButton>
          </div>
        )}
      </form>
      <section aria-labelledby={`${id}-real-screens`} className="flex flex-col gap-3">
        <h2 id={`${id}-real-screens`} className="text-base font-semibold text-ink">
          {copy.realScreens.heading}
        </h2>
        {preview === undefined ? (
          <p className="text-sm text-ink-muted">{copy.realScreens.noTemplates}</p>
        ) : (
          <ThemePreview
            flowOrigin={preview.flowOrigin}
            templates={preview.templates}
            styles={styles}
            action={preview.action}
          />
        )}
      </section>
      {uploadAction !== undefined && (
        <AssetUploadForm
          action={uploadAction}
          onUploaded={(asset) => {
            setAssets((current) => [...current, asset]);
          }}
        />
      )}
    </div>
  );
}
