'use client';

import type { CaseChecklists, CasePresetComments } from '@openverify/contracts';
import type { ActionResult, ActionState, DisplayProblem } from '../../../lib/action-state';
import { CASES_REPORTS_COPY } from '../../../lib/copy/cases-reports';
import { withoutFieldErrors } from '../../field-errors';
import { JsonEditor } from '../../json-editor';
import { ProblemDisplay } from '../../problem-display';
import { SubmitButton } from '../../submit-button';
import { useToast } from '../../toasts';
import { useFormAction } from '../../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const COPY = CASES_REPORTS_COPY.versionMembers;
const ROOT = '/data/attributes';
const MEMBERS = ['checklists', 'preset-comments'] as const;

export interface ChecklistsEditorProps {
  readonly templateId: string;
  readonly versionId: string;
  readonly checklists: CaseChecklists;
  readonly presetComments: CasePresetComments;
  readonly action: Action;
}

/** The problem's errors inside one member, by pointer within it. */
function errorsIn(problem: DisplayProblem | undefined, member: (typeof MEMBERS)[number]) {
  const root = `${ROOT}/${member}`;
  return (problem?.errors ?? [])
    .filter((error) => error.pointer === root || error.pointer.startsWith(`${root}/`))
    .map((error) => ({ pointer: error.pointer.slice(root.length) || '/', detail: error.detail }));
}

/**
 * The draft's checklists and preset comments as JSON documents (C172.2, C172.4), saved alone, each
 * refusal under its document at its pointer within it. The editor of the rest of the draft keeps
 * its own form, so saving one never sends the other.
 */
export function ChecklistsEditor({
  templateId,
  versionId,
  checklists,
  presetComments,
  action,
}: ChecklistsEditorProps) {
  const { show } = useToast();
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: COPY.saved });
    },
  });
  const placed = MEMBERS.flatMap((member) =>
    errorsIn(form.problem, member).map(
      (error) => `${ROOT}/${member}${error.pointer === '/' ? '' : error.pointer}`,
    ),
  );
  return (
    <form {...form.formProps} aria-label={COPY.checklistsTitle} className="flex flex-col gap-4">
      <input type="hidden" name="case-template-id" value={templateId} />
      <input type="hidden" name="version-id" value={versionId} />
      <p className="text-sm text-ink-muted">{COPY.checklistsDescription}</p>
      <JsonEditor
        label={COPY.checklists}
        name="checklists"
        rows={10}
        defaultValue={JSON.stringify(checklists, null, 2)}
        errors={errorsIn(form.problem, 'checklists')}
      />
      <JsonEditor
        label={COPY.presetComments}
        name="preset-comments"
        rows={8}
        defaultValue={JSON.stringify(presetComments, null, 2)}
        errors={errorsIn(form.problem, 'preset-comments')}
      />
      <ProblemDisplay problem={withoutFieldErrors(form.problem, placed)} />
      <div>
        <SubmitButton pendingLabel={CASES_REPORTS_COPY.layout.saving} pending={form.pending}>
          {COPY.save}
        </SubmitButton>
      </div>
    </form>
  );
}
