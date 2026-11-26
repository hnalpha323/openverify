'use client';

/**
 * C155.7 (Workflow 9D, fix-builder): copy and promote on the template page, each a dialog that
 * moves focus in and back, says what it does before it does it and says a refusal in words. The
 * API checks every right; the promote dialog names them, and what a promote does not copy.
 */
import { Button } from '@openverify/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import type { ActionResult, DisplayProblem } from '../../lib/action-state';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';
import { Dialog } from '../dialog';
import { LINK_CLASS } from '../link-styles';
import type { CopiedTemplate, PromotedVersion } from './template-operations-actions';

const copy = FLOW_BUILDER_COPY.operations;

export interface TemplateEnvironment {
  readonly id: string;
  readonly kind: 'sandbox' | 'production';
}

export function CopyTemplateButton({
  templateId,
  templateName,
  versionId,
  action,
}: {
  readonly templateId: string;
  readonly templateName: string;
  readonly versionId?: string;
  readonly action: (input: {
    readonly templateId: string;
    readonly name: string;
    readonly versionId?: string;
  }) => Promise<ActionResult<CopiedTemplate>>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(copy.copyDefault(templateName));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopiedTemplate | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
          setRefusal(null);
        }}
      >
        {copy.copy}
      </Button>
      {copied !== null && (
        <p role="status" className="text-sm">
          {copy.copied(copied.name)}{' '}
          <Link href={`/templates/${copied.id}`} className={LINK_CLASS}>
            {copy.open(copied.name)}
          </Link>
        </p>
      )}
      <Dialog
        open={open}
        dismissible={!busy}
        onClose={() => {
          setOpen(false);
        }}
        title={copy.copyTitle}
        description={copy.copyDescription}
      >
        <label htmlFor={`${id}-name`} className="text-sm font-semibold">
          {copy.copyName}
        </label>
        <input
          id={`${id}-name`}
          value={name}
          maxLength={100}
          onChange={(event) => {
            setName(event.currentTarget.value);
          }}
          className="min-h-11 rounded-md border border-control px-3"
        />
        {refusal !== null && (
          <p role="alert" className="text-sm">
            {refusal}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void action({ templateId, name, ...(versionId === undefined ? {} : { versionId }) })
                .then((result) => {
                  if (result.ok) {
                    setCopied(result.data);
                    setOpen(false);
                  } else {
                    setRefusal(copy.copyRefused(result.problem.title));
                  }
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {copy.copyConfirm}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
          >
            {copy.cancel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** A promote refusal in words, from its status and code (C154.5's 403, 404, 409 and 422). */
function promoteRefusal(problem: DisplayProblem): string {
  if (problem.code === 'draft_exists') return copy.refusals.draftExists;
  switch (problem.status) {
    case 403:
      return copy.refusals.forbidden;
    case 404:
      return copy.refusals.notFound;
    case 409:
      return copy.refusals.notPublished;
    case 422:
      return copy.refusals.unresolved(
        (problem.errors ?? []).map((error) => error.detail).join(' ') ||
          (problem.detail ?? problem.title),
      );
    default:
      return problem.detail ?? problem.title;
  }
}

export function PromoteTemplateButton({
  templateId,
  versionId,
  versionNumber,
  current,
  environments,
  action,
}: {
  readonly templateId: string;
  readonly versionId?: string;
  readonly versionNumber: number;
  readonly current: TemplateEnvironment;
  readonly environments: readonly TemplateEnvironment[];
  readonly action: (input: {
    readonly templateId: string;
    readonly environmentId: string;
    readonly versionId?: string;
  }) => Promise<ActionResult<PromotedVersion>>;
}) {
  const id = useId();
  const targets = environments.filter((environment) => environment.id !== current.id);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<string | null>(null);
  const words = (environment: TemplateEnvironment) =>
    copy.environment(environment.kind, environment.id);
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
          setRefusal(null);
        }}
      >
        {copy.promote}
      </Button>
      {promoted !== null && (
        <p role="status" className="text-sm">
          {promoted}
        </p>
      )}
      <Dialog
        open={open}
        dismissible={!busy}
        onClose={() => {
          setOpen(false);
        }}
        title={copy.promoteTitle(versionNumber)}
        description={copy.promoteDescription}
      >
        {targets.length === 0 ? (
          <p className="text-sm">{copy.noTarget}</p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{copy.promoteTarget}</legend>
            {targets.map((environment) => (
              <label key={environment.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${id}-target`}
                  value={environment.id}
                  checked={target === environment.id}
                  onChange={() => {
                    setTarget(environment.id);
                  }}
                  className="size-6"
                />
                {words(environment)}
              </label>
            ))}
          </fieldset>
        )}
        <p className="text-sm">{copy.rights}</p>
        <ul aria-label={copy.notCopiedHeading} className="list-disc ps-5 text-sm">
          {Object.values(copy.notCopied).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {refusal !== null && (
          <p role="alert" className="text-sm">
            {refusal}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy || target === null}
            onClick={() => {
              const environment = targets.find((each) => each.id === target);
              if (environment === undefined) {
                return;
              }
              setBusy(true);
              void action({
                templateId,
                environmentId: environment.id,
                ...(versionId === undefined ? {} : { versionId }),
              })
                .then((result) => {
                  if (result.ok) {
                    setPromoted(
                      copy.promoted(
                        result.data.versionNumber,
                        words(environment),
                        result.data.copiedThemeSets,
                      ),
                    );
                    setOpen(false);
                  } else {
                    setRefusal(copy.promoteRefused(promoteRefusal(result.problem)));
                  }
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {copy.promoteConfirm(versionNumber)}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
          >
            {copy.cancel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
