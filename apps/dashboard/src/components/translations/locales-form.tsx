'use client';

import { templateLocaleSchema, type TemplateLocale } from '@openverify/contracts';
import { Checkbox } from '@openverify/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { COPY_COPY } from '../../lib/copy/themes-copy';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

const copy = COPY_COPY.locales;
/** C161.2: the five built-in base languages, in the contract's order; never a region tag. */
const LOCALES: readonly TemplateLocale[] = templateLocaleSchema.options;

/**
 * C161.2: the draft's enabled languages and its default, saved with `If-Match` (C154.3). Base
 * language tags only: the five built-in languages, so a region tag such as `ar-EG` cannot be chosen
 * (the API answers `locale_unsupported` for one).
 */
export function LocalesForm({
  templateId,
  versionId,
  etag,
  enabledLocales,
  defaultLocale,
  action,
}: {
  readonly templateId: string;
  readonly versionId: string;
  readonly etag: string;
  readonly enabledLocales: readonly TemplateLocale[];
  readonly defaultLocale: TemplateLocale;
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [enabled, setEnabled] = useState<readonly TemplateLocale[]>(enabledLocales);
  const [fallback, setFallback] = useState<TemplateLocale>(defaultLocale);
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: copy.saved });
      router.refresh();
    },
  });
  return (
    <form {...form.formProps} aria-label={copy.heading} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="inquiry-template-id" value={templateId} />
      <input type="hidden" name="version-id" value={versionId} />
      <input type="hidden" name="etag" value={etag} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">{copy.enabled}</legend>
        {LOCALES.map((locale) => (
          <Checkbox
            key={locale}
            name="enabled-locales"
            value={locale}
            label={`${copy.names[locale]} (${locale})`}
            checked={enabled.includes(locale)}
            onChange={(event) => {
              const on = event.currentTarget.checked;
              setEnabled((current) =>
                on
                  ? LOCALES.filter((each) => each === locale || current.includes(each))
                  : current.filter((each) => each !== locale),
              );
            }}
          />
        ))}
      </fieldset>
      <FormField label={copy.defaultLocale} error={fieldErrorOf(form.problem, '/default-locale')}>
        {(control) => (
          <select
            {...control}
            name="default-locale"
            value={fallback}
            onChange={(event) => {
              const value = templateLocaleSchema.safeParse(event.currentTarget.value);
              if (value.success) {
                setFallback(value.data);
              }
            }}
            className={controlClassName(control)}
          >
            {enabled.map((locale) => (
              <option key={locale} value={locale}>
                {`${copy.names[locale]} (${locale})`}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <ProblemDisplay problem={form.problem} />
      <div>
        <SubmitButton pending={form.pending} pendingLabel={COPY_COPY.translations.saving}>
          {copy.save}
        </SubmitButton>
      </div>
    </form>
  );
}
