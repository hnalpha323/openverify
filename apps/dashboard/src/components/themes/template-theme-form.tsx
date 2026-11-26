'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { COPY_COPY } from '../../lib/copy/themes-copy';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { BuilderThemePanel, type ThemeSetChoice } from './builder-theme-panel';

const copy = COPY_COPY.themeTab;

/** C160.7: the draft's theme picker, saved with the draft's `ETag` (C154.3). */
export function TemplateThemeForm({
  templateId,
  versionId,
  etag,
  themeSets,
  value,
  action,
}: {
  readonly templateId: string;
  readonly versionId: string;
  readonly etag: string;
  readonly themeSets: readonly ThemeSetChoice[];
  readonly value: string | null;
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [choice, setChoice] = useState<string | null>(value);
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: copy.saved });
      router.refresh();
    },
  });
  return (
    <form {...form.formProps} aria-label={copy.title} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="inquiry-template-id" value={templateId} />
      <input type="hidden" name="version-id" value={versionId} />
      <input type="hidden" name="etag" value={etag} />
      <input type="hidden" name="theme-set-id" value={choice ?? ''} />
      <BuilderThemePanel themeSets={themeSets} value={choice} onChange={setChoice} />
      <p className="text-sm text-ink-muted">{copy.publishNote}</p>
      <ProblemDisplay problem={form.problem} />
      <div>
        <SubmitButton pending={form.pending} pendingLabel={COPY_COPY.translations.saving}>
          {copy.save}
        </SubmitButton>
      </div>
    </form>
  );
}
