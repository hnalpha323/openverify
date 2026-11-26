'use client';

import { counselUnreviewed } from '@openverify/flow-spec';
import { CounselReviewNote } from '../connect/counsel-review-note';
import type { TemplateLocale, TranslationRow } from '@openverify/contracts';
import { Alert, Button } from '@openverify/ui';
import { useId, useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { COPY_COPY } from '../../lib/copy/themes-copy';
import { controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';
import { copyCodeWords } from './code-words';

const copy = COPY_COPY.translations;

/** One text the editor offers, with its rules (`CopyKeyView` of `copy-key-catalog.ts`). */
export interface EditorKey {
  readonly key: string;
  readonly kind: 'built-in' | 'component';
  readonly step: string | null;
  readonly stepName: string | null;
  readonly component: string | null;
  readonly attribute: string;
  readonly maxLength: number;
  readonly placeholders: readonly string[];
  readonly multiline: boolean;
  readonly consent: boolean;
  readonly legal: string | null;
  readonly biometric: boolean;
}

export type TranslationsImportResult =
  | { readonly kind: 'saved'; readonly count: number }
  | {
      readonly kind: 'refused';
      readonly refusals: readonly { readonly pointer: string; readonly code: string }[];
    };

export interface TranslationsEditorProps {
  readonly templateId: string;
  readonly keys: readonly EditorKey[];
  /** The texts the version holds: `{ <copy key>: { <locale>: text } }`. */
  readonly values: Readonly<Record<string, Readonly<Partial<Record<string, string>>>>>;
  readonly enabledLocales: readonly TemplateLocale[];
  /** Without it the texts are shown read-only. */
  readonly action?: (
    state: ActionState<TranslationsImportResult>,
    formData: FormData,
  ) => Promise<ActionResult<TranslationsImportResult>>;
}

const slot = (key: string, locale: string) => `${key}\u0000${locale}`;
const VALUE_POINTER =
  /^\/data\/attributes\/translations\/([0-9]+)\/locale-values\/([0-9]+)\/value$/u;

/** The rows to send: one per key with a changed, non-empty cell, in the order shown. */
function rowsToSend(
  shown: readonly EditorKey[],
  edits: Readonly<Record<string, string>>,
  values: TranslationsEditorProps['values'],
  locales: readonly TemplateLocale[],
): TranslationRow[] {
  return shown.flatMap((entry) => {
    const cells = locales.flatMap((locale) => {
      const edited = edits[slot(entry.key, locale)];
      return edited !== undefined && edited !== '' && edited !== (values[entry.key]?.[locale] ?? '')
        ? [{ locale, value: edited }]
        : [];
    });
    return cells.length === 0
      ? []
      : [
          {
            step: entry.step,
            'step-display-name': null,
            component: entry.component,
            'attribute-name': entry.attribute,
            'locale-values': cells,
          },
        ];
  });
}

/**
 * C162 (Workflow 9C, `dashboard-themes-copy`): the translations editor, per key and locale. Each
 * text shows its rules (length, placeholders, one line or several, legal weight); a save imports
 * the changed cells into the draft through the API, which checks every rule and refuses by cell;
 * the refusals are said in words at their cells, never echoing the text. An empty cell keeps the
 * stored text: an import never deletes.
 */
export function TranslationsEditor({
  templateId,
  keys,
  values,
  enabledLocales,
  action,
}: TranslationsEditorProps) {
  const id = useId();
  const [added, setAdded] = useState<readonly string[]>([]);
  const [choice, setChoice] = useState('');
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const [outcome, setOutcome] = useState<TranslationsImportResult | 'unchanged' | null>(null);
  const [sent, setSent] = useState<readonly TranslationRow[]>([]);
  const shown = keys.filter(
    (entry) => values[entry.key] !== undefined || added.includes(entry.key),
  );
  const addable = keys.filter((entry) => !shown.includes(entry));
  const rows = rowsToSend(shown, edits, values, enabledLocales);
  const form = useFormAction<TranslationsImportResult>(
    action ?? (() => Promise.resolve({ ok: false, problem: { title: copy.readOnly } })),
    {
      onSuccess: (result) => {
        setOutcome(result);
        if (result.kind === 'saved') {
          setEdits({});
        }
      },
    },
  );
  // Each refusal names the cell of the rows sent: `translations/<row>/locale-values/<cell>`.
  const refusedAt = new Map<string, string>();
  if (outcome !== null && outcome !== 'unchanged' && outcome.kind === 'refused') {
    for (const refusal of outcome.refusals) {
      const match = VALUE_POINTER.exec(refusal.pointer);
      const row = match === null ? undefined : sent[Number(match[1])];
      const cell = row?.['locale-values'][Number(match?.[2])];
      const entry = keys.find(
        (each) =>
          each.step === row?.step &&
          each.component === row.component &&
          each.attribute === row['attribute-name'],
      );
      if (entry !== undefined && cell !== undefined) {
        refusedAt.set(slot(entry.key, cell.locale), copyCodeWords(refusal.code));
      }
    }
  }
  const readOnly = action === undefined;

  return (
    <form
      {...form.formProps}
      onSubmit={(event) => {
        if (rows.length === 0) {
          event.preventDefault();
          setOutcome('unchanged');
          return;
        }
        setSent(rows);
        setOutcome(null);
        form.formProps.onSubmit(event);
      }}
      aria-label={copy.tableCaption}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="inquiry-template-id" value={templateId} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      {readOnly && <p className="text-sm text-ink-muted">{copy.readOnly}</p>}
      <p className="text-sm text-ink-muted">{copy.blankKeeps}</p>
      {shown.length === 0 ? (
        <p className="text-sm text-ink">{copy.noRows}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">{copy.tableCaption}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pe-3 font-medium">
                  {copy.key}
                </th>
                {enabledLocales.map((locale) => (
                  <th key={locale} scope="col" className="py-2 pe-3 font-medium">
                    {`${COPY_COPY.locales.names[locale]} (${locale})`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.key} className="border-b border-line align-top">
                  <th scope="row" className="py-2 pe-3 font-normal">
                    <code className="font-mono text-xs break-all">{entry.key}</code>
                    <ul className="mt-1 text-xs text-ink-muted">
                      <li>{entry.kind === 'built-in' ? copy.builtInText : copy.componentText}</li>
                      <li>{copy.maxLength(entry.maxLength)}</li>
                      <li>
                        {copy.placeholders(
                          entry.placeholders.map((name) => `{${name}}`).join(', '),
                        )}
                      </li>
                      <li>{entry.multiline ? copy.multiline : copy.oneLine}</li>
                      {entry.consent && <li>{copy.consent}</li>}
                      {entry.legal !== null && <li>{copy.legal(entry.legal)}</li>}
                      {/* C238.10 (Workflow 11A console-connect, a named borrowed edit). */}
                      {counselUnreviewed(entry.key) && (
                        <li>
                          <CounselReviewNote copyKey={entry.key} />
                        </li>
                      )}
                    </ul>
                  </th>
                  {enabledLocales.map((locale) => {
                    const at = slot(entry.key, locale);
                    const refused = refusedAt.get(at);
                    const errorId = `${id}-${entry.key}-${locale}-error`;
                    const control = {
                      'aria-label': copy.cellLabel(entry.key, locale),
                      lang: locale,
                      dir: 'auto',
                      value: edits[at] ?? values[entry.key]?.[locale] ?? '',
                      readOnly,
                      maxLength: entry.maxLength,
                      ...(refused === undefined
                        ? {}
                        : { 'aria-invalid': true as const, 'aria-describedby': errorId }),
                      onChange: (event: { currentTarget: { value: string } }) => {
                        const value = event.currentTarget.value;
                        setEdits((current) => ({ ...current, [at]: value }));
                      },
                      className: controlClassName(
                        refused === undefined ? {} : { 'aria-invalid': true },
                      ),
                    };
                    return (
                      <td key={locale} className="py-2 pe-3">
                        {entry.multiline ? (
                          <textarea rows={3} {...control} />
                        ) : (
                          <input {...control} />
                        )}
                        {refused !== undefined && (
                          <p id={errorId} className="mt-1 text-xs font-medium text-danger">
                            {refused}
                          </p>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly && addable.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            {copy.addKeyLabel}
            <select
              value={choice}
              onChange={(event) => {
                setChoice(event.currentTarget.value);
              }}
              className={controlClassName({})}
            >
              <option value="">{copy.addKey}</option>
              {addable.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.stepName === null ? entry.key : `${entry.key} (${entry.stepName})`}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={choice === ''}
            onClick={() => {
              setAdded((current) => [...current, choice]);
              setChoice('');
            }}
          >
            {copy.addKeySubmit}
          </Button>
        </div>
      )}
      <div role="status" aria-live="polite">
        {outcome === 'unchanged' && <Alert tone="info">{copy.nothingChanged}</Alert>}
        {outcome !== null && outcome !== 'unchanged' && outcome.kind === 'saved' && (
          <Alert tone="success">{copy.saved(outcome.count)}</Alert>
        )}
        {outcome !== null && outcome !== 'unchanged' && outcome.kind === 'refused' && (
          <Alert tone="error" title={copy.refusedHeading}>
            <ul className="list-disc ps-5">
              {outcome.refusals.map((refusal) => (
                <li key={refusal.pointer + refusal.code}>
                  <code className="font-mono text-xs">{refusal.pointer}</code>:{' '}
                  {copyCodeWords(refusal.code)}
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
      <p className="text-sm text-ink-muted">{copy.neverPublishes}</p>
    </form>
  );
}
