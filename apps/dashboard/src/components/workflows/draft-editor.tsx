'use client';

/**
 * The draft editor (C141.2 to C141.4; Workflow 8C review, Workflow 8D). The outline is the editor:
 * each item's menu (Enter, or "Actions for the selected item") sets the trigger, adds a step from
 * the palette, adds a branch, moves, connects, deletes and opens a step's settings, so a definition
 * is authored by keyboard alone (WCAG 2.2 2.1.1, 2.5.7). The raw definition stays editable in
 * `JsonEditor` as the fallback, and the outline follows what is typed there. Every edit goes
 * through the pure document model (`editor/document-model.ts`) and the bounded undo history
 * (`editor/history.ts`): Ctrl or Cmd with Z, and with Shift and Z, inside the editor only, and the
 * two buttons. An edit stays in this tab until it is saved, and the page says so, because the API
 * stores only a draft its check accepts (8A amendment 49). "Check" asks the API for the
 * definition's problems and saves nothing; "Save draft" checks, then saves at the lock version.
 * Problems are listed by their place, counted on their steps, and announced politely.
 */
import { Button } from '@openverify/ui';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { JsonEditor } from '../json-editor';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';
import { DefinitionOutline, outlineName, type OutlineHandle } from './definition-outline';
import {
  outlineOf,
  stepLabelOf,
  type OutlineItem,
  type OutlineIssue,
} from './definition-outline-model';
import {
  addBranch,
  canDelete,
  canMove,
  connectContinue,
  connectPort,
  continueTargets,
  deleteStep,
  insertionPlaceOf,
  insertStep,
  moveStep,
  readDraft,
  renameStep,
  replaceLayout,
  serialise,
  setTrigger,
  type DraftDefinition,
  type DraftStep,
  type Edited,
  type Place,
  type StepTemplate,
} from './editor/document-model';
import { canvasSummary, type DiffMark } from './editor/canvas-model';
import { EditMenu, type EditMenuItem } from '../graph-editor/edit-menu';
import { ConnectDialog, DeleteDialog, TriggerDialog } from './editor/editor-dialogs';
import {
  endGesture,
  isRedoKey,
  isUndoKey,
  record,
  redo,
  startHistory,
  undo,
  type History,
} from '../graph-editor/history';
import { tidyLayout } from './editor/layout';
import { PaletteDialog } from './editor/palette';
import { paletteOf, TEMPLATE_ENTRIES, type CatalogueAction } from './editor/palette-model';
import { StepForm, type ApplyEdit } from './editor/step-form';
import { triggerPathsOf } from './editor/trigger-paths';
import { PathList } from './editor/variable-picker';
import { scopeAt } from './editor/variable-scope';
import { DeclarationsPanel, declarationPaths, TriggerPanel } from './editor/workflow-panels';
import { edgeOn, portsOf, portWords, TRIGGER_NODE, validTargets } from './editor/port-rules';
import { WorkflowCanvas } from './editor/workflow-canvas';
import { WORKFLOW_TRIGGER_TYPE_WORDS, definitionProblemWords, wordOf } from './workflow-words';

export interface DraftIssue {
  readonly pointer: string;
  readonly code: string;
  readonly detail: string;
}

export interface DraftResult {
  readonly saved: boolean;
  readonly lockVersion: number | null;
  readonly errors: readonly DraftIssue[];
  readonly warnings: readonly DraftIssue[];
}

export interface DraftEditorProps {
  readonly workflowId: string;
  readonly lockVersion: number;
  readonly definition: string;
  /** The stored draft's warnings, until a check answers. */
  readonly warnings: readonly DraftIssue[];
  /** The action catalogue the palette offers (C141.4); none when it was not read. */
  readonly actions?: readonly CatalogueAction[];
  /** R005: the workflows the palette offers as modules (C119.8); none, a module says so. */
  readonly modules?: readonly { readonly id: string; readonly name: string }[];
  /** C116.6, C141.5: each step the draft added or changed against the live version. */
  readonly marks?: Readonly<Record<string, DiffMark>>;
  /** `undefined` without `workflows:write`: the definition is shown read-only. */
  readonly action:
    | ((state: ActionState<DraftResult>, formData: FormData) => Promise<ActionResult<DraftResult>>)
    | undefined;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

function summaryOf(result: DraftResult, intent: 'check' | 'save'): string {
  const counts =
    result.errors.length + result.warnings.length === 0
      ? 'No problems found.'
      : `${plural(result.errors.length, 'error')} and ${plural(result.warnings.length, 'warning')}.`;
  if (result.saved) {
    return `The draft was saved. ${counts}`;
  }
  return intent === 'save' ? `The draft was not saved. ${counts}` : counts;
}

function stepIdAt(definition: unknown, pointer: string): string | null {
  const match = /^\/steps\/(\d+)(?:\/|$)/.exec(pointer);
  if (match === null || typeof definition !== 'object' || definition === null) {
    return null;
  }
  const steps = (definition as { steps?: unknown }).steps;
  const step: unknown = Array.isArray(steps) ? steps[Number(match[1])] : undefined;
  const id = typeof step === 'object' && step !== null ? (step as { id?: unknown }).id : undefined;
  return typeof id === 'string' ? id : null;
}

function IssueList({
  title,
  issues,
  definition,
  goTo,
}: {
  readonly title: string;
  readonly issues: readonly DraftIssue[];
  readonly definition: unknown;
  readonly goTo: (stepId: string) => void;
}) {
  if (issues.length === 0) {
    return null;
  }
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-2 text-sm">
        {issues.map((issue, index) => {
          const stepId = stepIdAt(definition, issue.pointer);
          return (
            <li key={`${issue.pointer}-${issue.code}-${String(index)}`}>
              <code className="font-mono text-xs">
                {issue.pointer === '' ? '/' : issue.pointer}
              </code>{' '}
              {definitionProblemWords(issue.code)} {issue.detail} ({issue.code})
              {stepId !== null && (
                <>
                  {' '}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      goTo(stepId);
                    }}
                  >
                    Go to step {stepId}
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Every outline item by id. */
function itemsById(
  items: readonly OutlineItem[],
  found = new Map<string, OutlineItem>(),
): Map<string, OutlineItem> {
  for (const item of items) {
    found.set(item.id, item);
    itemsById(item.children, found);
  }
  return found;
}

const stepOf = (definition: DraftDefinition, id: string): DraftStep | undefined =>
  definition.steps.find((step) => step.id === id);

type Dialogs =
  | { readonly kind: 'trigger' }
  | { readonly kind: 'palette'; readonly place: Place; readonly where: string }
  | { readonly kind: 'connect'; readonly from: string; readonly ports: readonly string[] }
  | { readonly kind: 'delete'; readonly stepId: string }
  | null;

interface OpenMenu {
  readonly item: OutlineItem;
  readonly invoker: HTMLElement | null;
}

const entry = (id: string, label: string, disabled: string | null = null): EditMenuItem => ({
  id,
  label,
  disabled,
});

/** The menu of an outline item (C141.2): what applies is enabled, the rest says why not. */
function menuItemsOf(item: OutlineItem, definition: DraftDefinition): EditMenuItem[] {
  if (item.id === TRIGGER_NODE) {
    const missing = definition.trigger === null ? 'Set the trigger first.' : null;
    return [
      entry('set-trigger', 'Set the trigger…'),
      entry('add', 'Add a step after…', missing),
      entry('connect', 'Connect next step to…', missing),
    ];
  }
  const step = item.stepIndex === null ? undefined : stepOf(definition, item.id);
  if (step === undefined) {
    return insertionPlaceOf(definition, item.id) === null
      ? []
      : [entry('add', 'Add a step here…'), entry('connect', 'Connect this path to…')];
  }
  const branching = step.type === 'conditional' || step.type === 'parallel';
  const branchRefusal = !branching
    ? 'Only a conditional or a parallel has branches.'
    : addBranch(definition, step.id) === null
      ? 'A parallel has at most ten branches.'
      : null;
  const addRefusal =
    insertionPlaceOf(definition, step.id) !== null
      ? null
      : step.type === 'conditional'
        ? 'A conditional’s steps go inside its routes: open a route’s menu.'
        : 'Nothing comes after the output.';
  const deleteRefusal = canDelete(definition, step.id)
    ? null
    : step.type === 'join'
      ? 'A join goes with its parallel: delete the parallel.'
      : 'The output cannot be deleted: a definition needs one.';
  return [
    entry('add', 'Add a step after…', addRefusal),
    entry('branch', 'Add a branch', branchRefusal),
    entry(
      'up',
      'Move up',
      canMove(definition, step.id, 'up')
        ? null
        : 'It cannot move up: nothing of the same shape comes before it.',
    ),
    entry(
      'down',
      'Move down',
      canMove(definition, step.id, 'down')
        ? null
        : 'It cannot move down: nothing of the same shape comes after it.',
    ),
    entry(
      'connect',
      'Connect next step to…',
      portsOf(step).length === 0 ? 'The output leads nowhere.' : null,
    ),
    // R005 (C113.3): a loop body's step leads back into its loop's `continue` port.
    ...continueTargets(definition, step.id).map((loopId) => {
      const loop = stepOf(definition, loopId);
      return entry(
        `continue:${loopId}`,
        `Lead next back to ${loop === undefined ? loopId : stepLabelOf({ type: loop.type, name: loop.name, actionKey: null })}`,
        portsOf(step).includes('next') ? null : 'This step has no next port.',
      );
    }),
    entry('delete', 'Delete…', deleteRefusal),
    entry('settings', 'Open settings'),
  ];
}

/** What a delete leaves behind, in words (C141.2). */
function consequenceOf(step: DraftStep | undefined): string {
  switch (step?.type) {
    case 'parallel':
      return 'Its join goes with it; the steps of its branches stay, not connected, until you connect or delete them.';
    case 'conditional':
      return 'What led into it leads where its else led; the steps of its routes stay, not connected, until you connect or delete them.';
    case 'loop':
      return 'What led into it leads where it went after the loop; the steps of its body stay, not connected.';
    default:
      return 'What led into it leads to the step after it.';
  }
}

function StepSettings({
  step,
  definition,
  nameOf,
  nameRef,
  onRename,
  onDone,
  children,
}: {
  readonly step: DraftStep;
  readonly definition: DraftDefinition;
  readonly nameOf: (id: string) => string;
  readonly nameRef: RefObject<HTMLInputElement | null>;
  readonly onRename: (name: string) => void;
  readonly onDone: () => void;
  readonly children: ReactNode;
}) {
  const id = useId();
  const ports = portsOf(step);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-2 rounded-lg border border-line p-3"
    >
      <h3 id={`${id}-title`} className="text-sm font-semibold">
        Step settings
      </h3>
      <p className="text-sm">
        <code className="font-mono text-xs">{step.id}</code>,{' '}
        {step.type === 'action'
          ? `the action ${String(step['action-key'])}`
          : `a ${step.type} step`}
        .
      </p>
      <label htmlFor={`${id}-name`} className="text-sm font-medium">
        Name
      </label>
      <input
        id={`${id}-name`}
        ref={nameRef}
        defaultValue={step.name}
        maxLength={80}
        onChange={(event) => {
          onRename(event.currentTarget.value);
        }}
        onBlur={onDone}
        className="min-h-11 rounded-md border border-control bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      {ports.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {ports.map((port) => {
            const target = edgeOn(definition, step.id, port)?.to;
            return (
              <li key={port}>
                {portWords(port)}:{' '}
                {target === undefined ? 'not connected' : `leads to ${nameOf(target)}`}
              </li>
            );
          })}
        </ul>
      )}
      <div onBlur={onDone}>{children}</div>
    </section>
  );
}

const NO_MARKS: Readonly<Record<string, DiffMark>> = {};

interface ApplyOptions {
  /** Records into one entry while the same gesture lasts (typing, nudging a node). */
  readonly gesture?: string;
  /** Moves focus to the item the command selected; off for an edit made on the canvas. */
  readonly focus?: boolean;
  /** Remounts the settings and panels from the new definition; off for their own edits. */
  readonly remount?: boolean;
}

const isTextField = (target: EventTarget): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement);

export function DraftEditor({
  workflowId,
  lockVersion: initialLockVersion,
  definition,
  warnings: initialWarnings,
  actions = [],
  modules = [],
  marks = NO_MARKS,
  action,
}: DraftEditorProps) {
  const [text, setText] = useState(definition);
  const [savedText, setSavedText] = useState(definition);
  const [checkedText, setCheckedText] = useState<string | null>(null);
  const [jsonKey, setJsonKey] = useState(0);
  const [settingsKey, setSettingsKey] = useState(0);
  const [history, setHistory] = useState<History<DraftDefinition> | null>(() => {
    const read = readDraft(parsed(definition));
    return read === null ? null : startHistory(read);
  });
  const [lockVersion, setLockVersion] = useState(initialLockVersion);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [intent, setIntent] = useState<'check' | 'save'>('check');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [status, setStatus] = useState('');
  const outline = useRef<OutlineHandle>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const submitted = useRef(definition);
  const editable = action !== undefined;

  const form = useFormAction(
    action ??
      (() => Promise.resolve({ ok: false, problem: { title: 'You do not have access' } } as const)),
    {
      onSuccess: (answer) => {
        setResult(answer);
        if (answer.lockVersion !== null) {
          setLockVersion(answer.lockVersion);
        }
        setCheckedText(submitted.current);
        if (answer.saved) {
          setSavedText(submitted.current);
        }
      },
    },
  );
  const document = useMemo(() => parsed(text), [text]);
  const draft = useMemo(() => readDraft(document), [document]);
  const errors = useMemo(() => result?.errors ?? [], [result]);
  const warnings = result?.warnings ?? initialWarnings;
  const issues: OutlineIssue[] = useMemo(() => [...errors, ...warnings], [errors, warnings]);
  const items = useMemo(() => outlineOf(document, issues), [document, issues]);
  const byId = useMemo(() => itemsById(items), [items]);
  const palette = useMemo(
    () => [...paletteOf(actions, draft?.trigger?.type ?? null, modules), ...TEMPLATE_ENTRIES],
    [actions, draft, modules],
  );
  const trigger = draft?.trigger ?? null;
  const triggerPaths = useMemo(() => triggerPathsOf(trigger), [trigger]);
  const nameOf = (id: string) => {
    const item = byId.get(id);
    return item === undefined ? id : outlineName(item);
  };

  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === 'settings') {
      nameRef.current?.focus();
    } else if (target !== null) {
      outline.current?.focusItem(target);
    }
  });

  const show = (next: DraftDefinition, message: string) => {
    setText(serialise(next));
    setJsonKey((key) => key + 1);
    setStatus(message);
  };

  /** Applies a command's answer: one history entry (or one per gesture), the views, the focus. */
  const apply = (edited: Edited | null, message: string, options: ApplyOptions = {}) => {
    const { gesture, focus = gesture === undefined, remount = gesture === undefined } = options;
    if (edited === null || draft === null) {
      setStatus('That change does not apply here.');
      return;
    }
    setHistory(record(history ?? startHistory(draft), edited.definition, gesture));
    show(edited.definition, message);
    setSelectedId(edited.select);
    if (remount) {
      setSettingsKey((key) => key + 1);
    }
    if (focus) {
      pendingFocus.current = edited.select;
    } else {
      outline.current?.revealItem(edited.select);
    }
  };

  const selectFromCanvas = (id: string) => {
    setSelectedId(id);
    outline.current?.revealItem(id);
  };

  const travel = (direction: 'undo' | 'redo') => {
    const steps = direction === 'undo' ? history?.past : history?.future;
    if (history === null || steps === undefined || steps.length === 0) {
      setStatus(direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.');
      return;
    }
    const next = direction === 'undo' ? undo(history) : redo(history);
    setHistory(next);
    show(next.present, direction === 'undo' ? 'Undid the last change.' : 'Redid the change.');
    setSettingsKey((key) => key + 1);
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editable || isTextField(event.target)) {
      return;
    }
    if (isUndoKey(event)) {
      event.preventDefault();
      travel('undo');
    } else if (isRedoKey(event)) {
      event.preventDefault();
      travel('redo');
    }
  };

  const openMenu = (item: OutlineItem, invoker: HTMLElement | null) => {
    if (draft === null) {
      return;
    }
    if (menuItemsOf(item, draft).length === 0) {
      setStatus('This item has no actions.');
      return;
    }
    setMenu({ item, invoker });
  };

  const closeMenu = () => {
    menu?.invoker?.focus();
    setMenu(null);
  };

  const pick = (choice: string) => {
    if (menu === null || draft === null) {
      return;
    }
    const { item } = menu;
    closeMenu();
    const label = outlineName(item);
    const place = insertionPlaceOf(draft, item.id);
    const group = item.stepIndex === null && item.id !== TRIGGER_NODE;
    switch (choice) {
      case 'set-trigger':
        setDialog({ kind: 'trigger' });
        break;
      case 'add':
        if (place !== null) {
          setDialog({
            kind: 'palette',
            place,
            where: group ? `on the path ${label}` : `after ${label}`,
          });
        }
        break;
      case 'branch':
        apply(addBranch(draft, item.id), `Added a branch to ${label}.`);
        break;
      case 'up':
      case 'down':
        apply(moveStep(draft, item.id, choice), `Moved ${label} ${choice}.`);
        break;
      case 'connect': {
        const step = stepOf(draft, item.id);
        if (group) {
          if (place !== null) {
            setDialog({ kind: 'connect', from: place.from, ports: [place.port] });
          }
        } else {
          setDialog({
            kind: 'connect',
            from: item.id,
            ports: step === undefined ? ['next'] : portsOf(step),
          });
        }
        break;
      }
      case 'delete':
        setDialog({ kind: 'delete', stepId: item.id });
        break;
      default:
        if (choice.startsWith('continue:')) {
          const loopId = choice.slice('continue:'.length);
          apply(connectContinue(draft, item.id, loopId), `${label} now leads back to its loop.`);
          break;
        }
        setSelectedId(item.id);
        pendingFocus.current = 'settings';
        setSettingsKey((key) => key + 1);
    }
  };

  const goTo = (id: string) => {
    setSelectedId(id);
    outline.current?.focusItem(id);
  };

  const endTyping = () => {
    if (history !== null) {
      setHistory(endGesture(history));
    }
  };

  const selectedStep =
    draft === null || selectedId === null ? undefined : stepOf(draft, selectedId);
  /** A form's or a panel's edit: one entry per field while it is typed, focus left where it is. */
  const applyForm: ApplyEdit = (edited, message, gesture) => {
    // The form's step stays selected, so its settings stay open while they are edited.
    const kept = edited === null ? null : { ...edited, select: selectedId ?? edited.select };
    apply(kept, message, {
      ...(gesture === undefined ? {} : { gesture }),
      focus: false,
      remount: false,
    });
  };
  const scope =
    draft === null || selectedStep === undefined
      ? []
      : scopeAt(draft, selectedStep.id, actions, triggerPaths);
  const unsaved = editable && text !== savedText;
  const selectedItem = selectedId === null ? undefined : byId.get(selectedId);

  return (
    <div
      onKeyDown={onEditorKeyDown}
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(16rem,1fr)_2fr]"
    >
      <section aria-labelledby="draft-outline" className="flex flex-col gap-3">
        <h2 id="draft-outline" className="text-base font-semibold">
          Outline
        </h2>
        {editable && (
          <div className="flex flex-col gap-2">
            <div role="group" aria-label="Editor actions" className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  travel('undo');
                }}
              >
                Undo
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  travel('redo');
                }}
              >
                Redo
              </Button>
              <Button
                variant="secondary"
                aria-haspopup="menu"
                aria-expanded={menu !== null}
                disabled={selectedItem === undefined || draft === null}
                onClick={(event) => {
                  if (selectedItem !== undefined) {
                    openMenu(selectedItem, event.currentTarget);
                  }
                }}
              >
                Actions for the selected item
              </Button>
            </div>
            {menu !== null && draft !== null && (
              <EditMenu
                label={`Actions for ${outlineName(menu.item)}`}
                items={menuItemsOf(menu.item, draft)}
                onPick={pick}
                onClose={closeMenu}
              />
            )}
          </div>
        )}
        {document === null ? (
          <p className="text-sm">The definition is not valid JSON, so it has no outline.</p>
        ) : (
          <>
            {editable && draft === null && (
              <p className="text-sm">
                The outline cannot edit this definition until its steps and edges have their shape;
                edit it as JSON.
              </p>
            )}
            <DefinitionOutline
              ref={outline}
              items={items}
              onSelect={(item) => {
                setSelectedId(item.id);
              }}
              {...(editable
                ? {
                    onActivate: (item: OutlineItem, element: HTMLElement) => {
                      openMenu(item, element);
                    },
                  }
                : {})}
            />
          </>
        )}
        {editable && selectedStep !== undefined && draft !== null && (
          <StepSettings
            key={`${selectedStep.id}:${String(settingsKey)}`}
            step={selectedStep}
            definition={draft}
            nameOf={nameOf}
            nameRef={nameRef}
            onRename={(name) => {
              const edited = renameStep(draft, selectedStep.id, name);
              if (edited !== null) {
                apply(edited, `Renamed ${selectedStep.id}.`, {
                  gesture: `rename:${selectedStep.id}`,
                });
              }
            }}
            onDone={endTyping}
          >
            <StepForm
              workflowId={workflowId}
              step={selectedStep}
              definition={draft}
              action={
                selectedStep.type === 'action'
                  ? (actions.find(
                      (row) =>
                        row.key === selectedStep['action-key'] &&
                        row.version === selectedStep['action-version'],
                    ) ?? actions.find((row) => row.key === selectedStep['action-key']))
                  : undefined
              }
              scope={scope}
              apply={applyForm}
            />
          </StepSettings>
        )}
        <p role="status" aria-label="Editor status" className="text-sm">
          {status}
        </p>
        {unsaved && (
          <p className="text-sm font-medium">
            Unsaved changes: they stay in this tab until you save the draft. The API keeps only a
            draft its check accepts, so an unfinished graph stays here until it is finished.
          </p>
        )}
      </section>
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="draft-canvas" className="flex flex-col gap-3">
          <h2 id="draft-canvas" className="text-base font-semibold">
            Canvas
          </h2>
          {draft === null ? (
            <p className="text-sm">The canvas draws a definition the outline can read.</p>
          ) : (
            <>
              <p className="text-sm">
                {canvasSummary(draft, errors.length)} The outline lists the same steps and edits
                them by keyboard.
              </p>
              {editable && (
                <div role="group" aria-label="Canvas actions" className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      apply(
                        {
                          definition: replaceLayout(draft, tidyLayout(draft)),
                          select: selectedId ?? TRIGGER_NODE,
                        },
                        'Tidied up the layout.',
                        { focus: false },
                      );
                    }}
                  >
                    Tidy up
                  </Button>
                </div>
              )}
              <WorkflowCanvas
                definition={draft}
                issues={issues}
                marks={marks}
                selectedId={selectedId}
                onSelect={selectFromCanvas}
                {...(editable
                  ? {
                      onEdit: (edited: Edited, message: string, gesture?: string) => {
                        apply(edited, message, {
                          ...(gesture === undefined ? {} : { gesture }),
                          focus: false,
                        });
                      },
                    }
                  : {})}
              />
            </>
          )}
        </section>
        {draft !== null && (
          <section aria-labelledby="draft-panels" className="flex flex-col gap-4">
            <h2 id="draft-panels" className="text-base font-semibold">
              Trigger, inputs, variables and outputs
            </h2>
            <div key={settingsKey} onBlur={endTyping} className="flex flex-col gap-4">
              {(
                [
                  ['trigger', 'Trigger'],
                  ['inputs', 'Inputs'],
                  ['variables', 'Variables'],
                  ['outputs', 'Outputs'],
                ] as const
              ).map(([panel, title]) => (
                <section
                  key={panel}
                  aria-labelledby={`draft-panel-${panel}`}
                  className="flex flex-col gap-2 rounded-lg border border-line p-3"
                >
                  <h3 id={`draft-panel-${panel}`} className="text-sm font-semibold">
                    {title}
                  </h3>
                  {panel === 'trigger' ? (
                    editable ? (
                      <TriggerPanel
                        definition={draft}
                        triggerPaths={triggerPaths}
                        apply={applyForm}
                        onChangeType={() => {
                          setDialog({ kind: 'trigger' });
                        }}
                      />
                    ) : (
                      <PathList
                        label="Paths of the trigger"
                        paths={triggerPaths}
                        empty="This trigger has no view of an object: its runs read the inputs."
                      />
                    )
                  ) : editable ? (
                    <DeclarationsPanel member={panel} definition={draft} apply={applyForm} />
                  ) : (
                    <PathList
                      label={`Paths of the ${panel}`}
                      paths={declarationPaths(panel, draft[panel])}
                      empty={`Nothing declared.`}
                    />
                  )}
                </section>
              ))}
            </div>
          </section>
        )}
        <section aria-labelledby="draft-definition" className="flex flex-col gap-3">
          <h2 id="draft-definition" className="text-base font-semibold">
            Definition
          </h2>
          {action === undefined ? (
            <pre className="overflow-x-auto rounded-lg border border-line bg-canvas p-3 font-mono text-xs">
              {definition}
            </pre>
          ) : (
            <form
              {...form.formProps}
              onSubmit={(event) => {
                const submitter = event.nativeEvent.submitter;
                setIntent(
                  submitter instanceof HTMLButtonElement && submitter.value === 'save'
                    ? 'save'
                    : 'check',
                );
                submitted.current = text;
                form.formProps.onSubmit(event);
              }}
              aria-label="Edit the draft"
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="workflow-id" value={workflowId} />
              <input type="hidden" name="lock-version" value={String(lockVersion)} />
              <div onBlur={endTyping}>
                <JsonEditor
                  key={jsonKey}
                  label="Definition"
                  name="definition"
                  defaultValue={text}
                  rows={24}
                  required
                  onChange={(next) => {
                    setText(next);
                    const read = readDraft(parsed(next));
                    if (read !== null) {
                      setHistory(record(history ?? startHistory(read), read, 'json'));
                    }
                  }}
                  errors={errors.map((issue) => ({ pointer: issue.pointer, detail: issue.detail }))}
                  description="The workflow as JSON (C113.1). The outline follows what you type."
                />
              </div>
              <ProblemDisplay problem={form.problem} />
              <div className="flex flex-wrap gap-3">
                <SubmitButton
                  name="intent"
                  value="check"
                  variant="secondary"
                  pendingLabel="Checking…"
                  pending={form.pending}
                >
                  Check
                </SubmitButton>
                <SubmitButton
                  name="intent"
                  value="save"
                  pendingLabel="Saving…"
                  pending={form.pending}
                >
                  Save draft
                </SubmitButton>
              </div>
            </form>
          )}
          <p role="status" aria-live="polite" className="text-sm">
            {result === null ? '' : summaryOf(result, intent)}
          </p>
          {result !== null && checkedText !== null && checkedText !== text && (
            <p className="text-sm font-medium">
              The definition changed after this check: the problems below are from the last check,
              and their places may have moved. Check again to see the problems now.
            </p>
          )}
          <IssueList title="Errors" issues={errors} definition={document} goTo={goTo} />
          <IssueList title="Warnings" issues={warnings} definition={document} goTo={goTo} />
        </section>
      </div>
      {draft !== null && dialog?.kind === 'trigger' && (
        <TriggerDialog
          open
          current={draft.trigger?.type ?? null}
          onClose={() => {
            setDialog(null);
          }}
          onSet={(type) => {
            setDialog(null);
            apply(
              setTrigger(draft, type),
              `Set the trigger to ${wordOf(WORKFLOW_TRIGGER_TYPE_WORDS, type)}.`,
            );
          }}
        />
      )}
      {draft !== null && dialog?.kind === 'palette' && (
        <PaletteDialog
          open
          place={dialog.where}
          entries={palette}
          onClose={() => {
            setDialog(null);
          }}
          onAdd={(template: StepTemplate, label: string) => {
            setDialog(null);
            apply(insertStep(draft, dialog.place, template), `Added ${label} ${dialog.where}.`);
          }}
        />
      )}
      {draft !== null && dialog?.kind === 'connect' && (
        <ConnectDialog
          open
          source={nameOf(dialog.from)}
          ports={dialog.ports.map((port) => ({
            port,
            label: portWords(port),
            current: edgeOn(draft, dialog.from, port)?.to ?? null,
            targets: validTargets(draft, dialog.from, port).map((id) => ({
              id,
              label: nameOf(id),
            })),
          }))}
          onClose={() => {
            setDialog(null);
          }}
          onConnect={(port, target) => {
            setDialog(null);
            apply(
              connectPort(draft, { from: dialog.from, port }, target),
              `Connected ${portWords(port)} of ${nameOf(dialog.from)} to ${nameOf(target)}.`,
            );
          }}
        />
      )}
      {draft !== null && dialog?.kind === 'delete' && (
        <DeleteDialog
          open
          step={nameOf(dialog.stepId)}
          consequence={consequenceOf(stepOf(draft, dialog.stepId))}
          onClose={() => {
            setDialog(null);
          }}
          onDelete={() => {
            setDialog(null);
            apply(deleteStep(draft, dialog.stepId), `Deleted ${nameOf(dialog.stepId)}.`);
          }}
        />
      )}
    </div>
  );
}
