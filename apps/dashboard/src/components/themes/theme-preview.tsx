'use client';

import type { ThemeStyles } from '@openverify/contracts';
import { useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import type { TemplatePreviewDocument } from '../../lib/api/template-preview';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import { previewAssetUrl } from '../flow-preview/asset-url';
import { FlowPreviewFrame } from '../flow-preview/flow-preview-frame';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';

const copy = THEMES_COPY.editor.realScreens;

/** A template to preview with: its newest draft, else its current version. */
export interface PreviewTemplate {
  readonly id: string;
  readonly name: string;
  readonly versionId: string;
}

/**
 * C156.1, C160 (rule 19: `dashboard-preview`'s frame, by import): the editor's unsaved styles on a
 * template's real screens. The styles are sent to the template version's preview route, which
 * resolves them with the contrast gate's findings and stores nothing; the answer is shown in the
 * flow's own preview frame on the flow origin.
 */
export function ThemePreview({
  flowOrigin,
  templates,
  styles,
  action,
}: {
  readonly flowOrigin: string | null;
  readonly templates: readonly PreviewTemplate[];
  readonly styles: ThemeStyles;
  readonly action: (
    state: ActionState<TemplatePreviewDocument>,
    formData: FormData,
  ) => Promise<ActionResult<TemplatePreviewDocument>>;
}) {
  const [chosen, setChosen] = useState(templates[0]?.id ?? '');
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [shown, setShown] = useState<{
    readonly templateId: string;
    readonly document: TemplatePreviewDocument;
  } | null>(null);
  const form = useFormAction(action, {
    onSuccess: (document) => {
      setShown({ templateId: chosen, document });
    },
  });
  const template = templates.find((each) => each.id === chosen);
  if (templates.length === 0) {
    return <p className="text-sm text-ink-muted">{copy.empty}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{copy.note}</p>
      <form
        {...form.formProps}
        aria-label={copy.heading}
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="version-id" value={template?.versionId ?? ''} />
        <input type="hidden" name="styles" value={JSON.stringify(styles)} />
        <FormField label={copy.template}>
          {(control) => (
            <select
              {...control}
              value={chosen}
              onChange={(event) => {
                setChosen(event.currentTarget.value);
              }}
              className={controlClassName(control)}
            >
              {templates.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label={copy.scheme}>
          {(control) => (
            <select
              {...control}
              value={scheme}
              onChange={(event) => {
                setScheme(event.currentTarget.value === 'dark' ? 'dark' : 'light');
              }}
              className={controlClassName(control)}
            >
              <option value="light">{THEMES_COPY.editor.light}</option>
              <option value="dark">{THEMES_COPY.editor.dark}</option>
            </select>
          )}
        </FormField>
        <SubmitButton pending={form.pending} pendingLabel={copy.showing} variant="secondary">
          {copy.show}
        </SubmitButton>
      </form>
      <ProblemDisplay problem={form.problem} />
      {shown !== null && (
        <FlowPreviewFrame
          flowOrigin={flowOrigin}
          document={shown.document}
          assetUrl={previewAssetUrl(shown.templateId)}
          scheme={scheme}
        />
      )}
    </div>
  );
}
