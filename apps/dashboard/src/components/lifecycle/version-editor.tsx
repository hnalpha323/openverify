'use client';

import type {
  InquiryTemplateVersionResource,
  ResolvedListConfig,
  ResolvedSignalConfig,
  ResolvedTemplateSettings,
  VerificationConfig,
} from '@openverify/contracts';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { JsonEditor } from '../json-editor';
import { withoutFieldErrors } from '../field-errors';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { describeConfigPointer } from './verification-config-pointers';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
type Flow = InquiryTemplateVersionResource['attributes']['flow'];

export interface VersionEditorProps {
  readonly templateId: string;
  readonly versionId: string;
  readonly flow: Flow;
  readonly verificationConfig: VerificationConfig;
  readonly settings: ResolvedTemplateSettings;
  /** C90.6: the version's `signal-config`, resolved; absent from a server before Phase 7. */
  readonly signalConfig?: ResolvedSignalConfig | undefined;
  /** C99.5: the version's `list-config`, resolved; absent from a server before Workflow 7B. */
  readonly listConfig?: ResolvedListConfig | undefined;
  readonly action: Action;
}

/** The documents of a version, with their form field and their place in the request. */
const DOCUMENTS = [
  { name: 'flow', label: 'Flow', pointer: '/data/attributes/flow', rows: 18 },
  {
    name: 'verification-config',
    label: 'Verification config',
    pointer: '/data/attributes/verification-config',
    rows: 14,
  },
  { name: 'settings', label: 'Settings', pointer: '/data/attributes/settings', rows: 8 },
  // C90.6, C99.5, C108: the version's signal and list configuration, resolved as served.
  {
    name: 'signal-config',
    label: 'Signal config',
    pointer: '/data/attributes/signal-config',
    rows: 10,
  },
  { name: 'list-config', label: 'List config', pointer: '/data/attributes/list-config', rows: 6 },
] as const;

const inside = (pointer: string, prefix: string) =>
  pointer === prefix || pointer.startsWith(`${prefix}/`);

interface DocumentError {
  readonly pointer: string;
  readonly detail: string;
  readonly label?: string | undefined;
}

/**
 * The problem's errors per document, by pointer inside it, and those about no document. An error
 * in the verification config also names its check and setting, or its allowlist entry (C37).
 */
function errorsByDocument(problem: DisplayProblem | undefined) {
  const errors = problem?.errors ?? [];
  return {
    documents: Object.fromEntries(
      DOCUMENTS.map((document) => [
        document.name,
        errors
          .filter((error) => inside(error.pointer, document.pointer))
          .map((error): DocumentError => {
            const pointer = error.pointer.slice(document.pointer.length) || '/';
            return {
              pointer,
              detail: error.detail,
              label:
                document.name === 'verification-config'
                  ? describeConfigPointer(pointer)
                  : undefined,
            };
          }),
      ]),
    ) as Record<(typeof DOCUMENTS)[number]['name'], DocumentError[]>,
    rest: errors.filter(
      (error) => !DOCUMENTS.some((document) => inside(error.pointer, document.pointer)),
    ),
  };
}

/**
 * The draft editor (C11, C23, C108): the flow, verification config, settings, signal config and
 * list config as JSON, saved together. The server action and the API validate them; errors show in the document they are
 * about, by path inside it.
 */
export function VersionEditor({
  templateId,
  versionId,
  flow,
  verificationConfig,
  settings,
  signalConfig,
  listConfig,
  action,
}: VersionEditorProps) {
  const { show } = useToast();
  // A refusal keeps the documents as edited (Workflow 2D K003).
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Saved the draft.' });
    },
  });
  const errors = errorsByDocument(problem);
  const initial = {
    flow: JSON.stringify(flow, null, 2),
    'verification-config': JSON.stringify(verificationConfig, null, 2),
    settings: JSON.stringify(settings, null, 2),
    'signal-config': JSON.stringify(signalConfig ?? {}, null, 2),
    'list-config': JSON.stringify(listConfig ?? {}, null, 2),
  };

  return (
    <form {...formProps} aria-label="Edit the draft" className="flex flex-col gap-6">
      <input type="hidden" name="inquiry-template-id" value={templateId} />
      <input type="hidden" name="version-id" value={versionId} />
      {DOCUMENTS.map((document) => (
        <JsonEditor
          key={document.name}
          label={document.label}
          name={document.name}
          rows={document.rows}
          defaultValue={initial[document.name]}
          errors={errors.documents[document.name]}
        />
      ))}
      {/* Always announced (Workflow 2D F006); errors in a document are listed under it. */}
      <ProblemDisplay
        problem={withoutFieldErrors(
          problem,
          (problem?.errors ?? [])
            .filter((error) => !errors.rest.includes(error))
            .map((error) => error.pointer),
        )}
      />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={pending}>
          Save draft
        </SubmitButton>
      </div>
    </form>
  );
}
