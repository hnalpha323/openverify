'use client';

/**
 * The flow builder (C155): the outline first (an APG tree from the entry, every edit reachable from
 * its menus by keyboard, C155.2), the shared canvas beside it over the flow adapter (C155.1), the
 * selected step's panel with the step-panel slot (C155.3), the format's own rules run in the browser
 * on every edit (`checkFlowGraph`, the code the API runs) with the problems by step and in a panel
 * announced politely (C155.6), undo and redo (100 entries), autosave with `If-Match` and
 * `allow-invalid`, the 412 "reload the latest draft" with what changed, and publish with every
 * acknowledgement and its reason (C154.9). Nothing here decides a person: the API publishes, and
 * stays the authority on every rule.
 */
import type { VerificationConfig } from '@openverify/contracts';
import { checkFlowGraph, stepV2Schema, type FlowProblem, type FlowV2 } from '@openverify/flow-spec';
import { Alert, Button } from '@openverify/ui';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActionResult } from '../../lib/action-state';
import type { TemplateVersionDiff } from '../../lib/api/inquiry-template-versions';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';
import { EditMenu, type EditMenuItem } from '../graph-editor/edit-menu';
import { BuilderThemePanel, type ThemeSetChoice } from '../themes/builder-theme-panel';
import { GraphCanvas } from '../graph-editor/graph-canvas';
import { record, redo, startHistory, undo, type History } from '../graph-editor/history';
import { OutlineTree, type OutlineHandle } from '../graph-editor/outline-tree';
import { StepSchemaForm } from '../schema-form/step-schema-form';
import { BranchRoutes } from './branch-routes';
import { FLOW_ADAPTER, type FlowPaletteEntry } from './flow-adapter';
import {
  ConflictDialog,
  ConnectDialog,
  DeleteDialog,
  ModuleDialog,
  PaletteDialog,
  PublishDialog,
  type PublishDialogState,
} from './flow-dialogs';
import {
  addBranchRoute,
  connectFlowPort,
  deleteFlowStep,
  edgeOnPort,
  idsOf,
  insertStepAfter,
  moveBranchRoute,
  opaqueId,
  setStepName,
  stepOf,
  stepPorts,
  stepTemplate,
  tidyFlowLayout,
  updateFlowStep,
  validFlowTargets,
  type Place,
} from './flow-model';
import {
  flowOutlineOf,
  flowPortLabel,
  flowStepLabel,
  type FlowOutlineItem,
} from './flow-outline-model';
import { FlowStepPanel } from './flow-step-panel';
import { ScreenEditor, type ScreenField } from './screen-editor';
import { VersionDiffList } from './version-diff-list';
import { insertModule, moduleOffers } from './flow-modules';

export type SaveOutcome =
  | { readonly kind: 'saved'; readonly etag: string; readonly problems: readonly FlowProblem[] }
  | {
      readonly kind: 'conflict';
      readonly latest: { readonly flow: FlowV2; readonly etag: string };
    };

export interface PublishCheck {
  readonly problems: readonly FlowProblem[];
  readonly acknowledgements: readonly string[];
}

export interface FlowBuilderActions {
  readonly save: (input: {
    readonly versionId: string;
    readonly flow: FlowV2;
    readonly etag: string;
    /** C160.7: the version's theme set, sent only when the author chose one here. */
    readonly themeSetId?: string | null;
  }) => Promise<ActionResult<SaveOutcome>>;
  readonly check: (input: { readonly versionId: string }) => Promise<ActionResult<PublishCheck>>;
  readonly publish: (input: {
    readonly versionId: string;
    readonly etag: string;
    readonly acknowledgements: readonly string[];
    readonly note: string;
  }) => Promise<ActionResult<{ readonly etag: string }>>;
}

export interface FlowBuilderProps {
  readonly versionId: string;
  readonly flow: FlowV2;
  readonly etag: string;
  /** The stored draft was flow-spec 1 and was migrated on opening (C147.1). */
  readonly migrated: boolean;
  readonly verificationConfig: VerificationConfig;
  readonly canEdit: boolean;
  readonly canPublish: boolean;
  /** How long after an edit the draft saves itself. */
  readonly autosaveMs?: number;
  readonly actions: FlowBuilderActions;
  /** C155.8: the theme picker's sets and the version's choice; `null` without `theme-sets:read`. */
  readonly theme?: {
    readonly sets: readonly ThemeSetChoice[];
    readonly value: string | null;
  } | null;
  /** C155.8: the languages and copy panel (`dashboard-themes-copy`'s), rendered by the page. */
  readonly copyPanel?: ReactNode;
  /** C149: the version's field schemas, for the screen editor and the format's field rules. */
  readonly fieldSchemas?: readonly ScreenField[];
  /**
   * C155.7: the server's diff of this draft against another version (the current one), drawn as
   * the canvas's and the outline's badges beside the same diff as a list.
   */
  readonly comparison?: {
    readonly versionNumber: number;
    readonly diff: TemplateVersionDiff;
  } | null;
}

type OpenDialog =
  | { readonly kind: 'palette'; readonly place: Place; readonly after: string }
  | { readonly kind: 'module'; readonly place: Place; readonly after: string }
  | {
      readonly kind: 'connect';
      readonly from: string;
      readonly port: string;
      readonly title: string;
    }
  | { readonly kind: 'delete'; readonly stepId: string; readonly label: string }
  | {
      readonly kind: 'conflict';
      readonly latest: { flow: FlowV2; etag: string };
      readonly changes: string[];
    }
  | { readonly kind: 'publish' };

const copy = FLOW_BUILDER_COPY;

function randomUnit(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) / 2 ** 32;
}

/** What the server's draft changed against the one this editor started from, in words. */
function changesBetween(base: FlowV2, latest: FlowV2): string[] {
  const before = new Map(base.steps.map((step) => [step.id, step]));
  const after = new Map(latest.steps.map((step) => [step.id, step]));
  const lines: string[] = [];
  for (const step of latest.steps) {
    const old = before.get(step.id);
    if (old === undefined) {
      lines.push(copy.dialogs.conflictAdded(flowStepLabel(latest, step)));
    } else if (JSON.stringify(old) !== JSON.stringify(step)) {
      lines.push(copy.dialogs.conflictChanged(flowStepLabel(latest, step)));
    }
  }
  for (const step of base.steps) {
    if (!after.has(step.id)) {
      lines.push(copy.dialogs.conflictRemoved(flowStepLabel(base, step)));
    }
  }
  if (JSON.stringify(base.edges) !== JSON.stringify(latest.edges)) {
    lines.push(copy.dialogs.conflictEdges);
  }
  return lines;
}

/** Each acknowledgement's reason, by its kind (C154.9). */
function reasonOf(key: string): string {
  const kind = key.slice(0, key.indexOf(':'));
  return (copy.acknowledgements as Readonly<Record<string, string>>)[kind] ?? key;
}

/** The problems the format's own rules find now, as the API's save check would (C155.6). */
function problemsOf(flow: FlowV2, fieldSchemas?: readonly ScreenField[]): FlowProblem[] {
  try {
    return checkFlowGraph(flow, {
      mode: 'save',
      ...(fieldSchemas === undefined ? {} : { fieldSchemas }),
    });
  } catch {
    return [];
  }
}

export function FlowBuilder({
  versionId,
  flow: initial,
  etag: initialEtag,
  migrated,
  verificationConfig,
  canEdit,
  canPublish,
  autosaveMs = 1500,
  actions,
  theme = null,
  copyPanel,
  comparison = null,
  fieldSchemas,
}: FlowBuilderProps) {
  const problemsHeading = useId();
  const [history, setHistory] = useState<History<FlowV2>>(() => startHistory(initial));
  const [config, setConfig] = useState(verificationConfig);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(0);
  const [menu, setMenu] = useState<{ item: FlowOutlineItem; invoker: HTMLElement } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [publishState, setPublishState] = useState<PublishDialogState>({
    checking: true,
    problems: [],
    acknowledgements: [],
  });
  const [published, setPublished] = useState(false);
  const [themeSetId, setThemeSetId] = useState(theme?.value ?? null);
  const [explanation, setExplanation] = useState(false);
  const etag = useRef(initialEtag);
  const base = useRef(initial);
  const saving = useRef<Promise<void> | null>(null);
  const outline = useRef<OutlineHandle>(null);
  const flow = history.present;
  const editable = canEdit && !published;

  const problems = useMemo(() => problemsOf(flow, fieldSchemas), [flow, fieldSchemas]);
  // Errors mark their step (node badges, the outline's count); warnings never block and are listed
  // in the problems panel only.
  const issues = useMemo(
    () =>
      problems
        .filter((problem) => problem.severity === 'error')
        .map((problem) => ({ pointer: problem.pointer, detail: problem.detail })),
    [problems],
  );
  // C155.7: the diff badges, from the same server diff as the list below the canvas.
  const marks = useMemo(
    () => (comparison === null ? {} : FLOW_ADAPTER.diffMarksOf(comparison.diff)),
    [comparison],
  );
  const items = useMemo(() => flowOutlineOf(flow, issues, marks), [flow, issues, marks]);
  // WCAG 2.5.7 (Workflow 9D): the selected step's outline item, whose actions a button opens, so a
  // single pointer reaches every edit the canvas offers by dragging.
  const selectedItem = useMemo(() => {
    const find = (list: readonly FlowOutlineItem[]): FlowOutlineItem | undefined => {
      for (const each of list) {
        if (each.kind === 'step' && each.stepId === selectedId) return each;
        const inside = find(each.children);
        if (inside !== undefined) return inside;
      }
      return undefined;
    };
    return selectedId === null ? undefined : find(items);
  }, [items, selectedId]);
  const label = (id: string) => {
    const step = stepOf(flow, id);
    return step === undefined ? id : flowStepLabel(flow, step);
  };

  const apply = (next: FlowV2, message: string, select?: string) => {
    setHistory((previous) => record(previous, next));
    if (select !== undefined) {
      setSelectedId(select);
    }
    setStatus(`${message} ${copy.builder.unsaved}`);
    setDirty((count) => count + 1);
  };

  const save = async (change: { readonly themeSetId?: string | null } = {}): Promise<void> => {
    if (!editable) {
      return;
    }
    await saving.current;
    const sent = history.present;
    setStatus(copy.builder.saving);
    const run = (async () => {
      const result = await actions.save({
        versionId,
        flow: sent,
        etag: etag.current,
        ...(change.themeSetId === undefined ? {} : { themeSetId: change.themeSetId }),
      });
      if (!result.ok) {
        setStatus(copy.builder.saveFailed(result.problem.title));
        return;
      }
      if (result.data.kind === 'conflict') {
        setDialog({
          kind: 'conflict',
          latest: result.data.latest,
          changes: changesBetween(base.current, result.data.latest.flow),
        });
        return;
      }
      etag.current = result.data.etag;
      base.current = sent;
      setStatus(copy.builder.saved);
    })();
    saving.current = run;
    await run;
  };

  useEffect(() => {
    if (dirty === 0 || !editable) {
      return undefined;
    }
    const timer = setTimeout(() => {
      void save();
    }, autosaveMs);
    return () => {
      clearTimeout(timer);
    };
    // Each edit restarts the wait; `save` reads the newest flow when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const travel = (direction: 'undo' | 'redo') => {
    setHistory((previous) => (direction === 'undo' ? undo(previous) : redo(previous)));
    setStatus(direction === 'undo' ? copy.builder.edited.undone : copy.builder.edited.redone);
    setDirty((count) => count + 1);
  };

  const menuItems = (item: FlowOutlineItem): EditMenuItem[] => {
    const entry = (id: string, text: string, disabled: string | null = null): EditMenuItem => ({
      id,
      label: text,
      disabled,
    });
    if (item.kind === 'goto') {
      return [entry('goto', copy.menu.goTo)];
    }
    if (!editable || item.stepId === null) {
      return [];
    }
    const step = stepOf(flow, item.stepId);
    if (step === undefined) {
      return [];
    }
    if (item.kind === 'step') {
      const ports = stepPorts(step);
      const list = [
        entry('add-after', copy.menu.addAfter, ports.includes('next') ? null : copy.menu.noNext),
        entry(
          'module-after',
          copy.menu.addModule,
          ports.includes('next') ? null : copy.menu.noNext,
        ),
        ...ports
          .filter((port) => port !== 'exhausted' || edgeOnPort(flow, step.id, port) !== undefined)
          .map((port) => entry(`connect:${port}`, copy.menu.connect(flowPortLabel(step, port)))),
        ...(ports.includes('exhausted') && edgeOnPort(flow, step.id, 'exhausted') === undefined
          ? [entry('fallback', copy.menu.addFallback)]
          : []),
        ...(step.type === 'branch' ? [entry('add-route', copy.menu.addRoute)] : []),
        entry('settings', copy.menu.settings),
        entry('delete', copy.menu.delete, flow.steps.length === 1 ? copy.menu.entryOnly : null),
      ];
      return list;
    }
    if ((item.kind === 'port' || item.kind === 'unset') && item.port !== null) {
      const port = item.port;
      const routes = step.type === 'branch' ? step.routes.map((route) => `route:${route.key}`) : [];
      const index = routes.indexOf(port);
      return [
        entry(`here:${port}`, copy.menu.addAfter),
        entry(`module:${port}`, copy.menu.addModuleHere),
        entry(`connect:${port}`, copy.menu.connect(flowPortLabel(step, port))),
        ...(index === -1
          ? []
          : [
              entry(`up:${port}`, copy.menu.moveUp, index === 0 ? copy.menu.firstRoute : null),
              entry(
                `down:${port}`,
                copy.menu.moveDown,
                index === routes.length - 1 ? copy.menu.lastRoute : null,
              ),
            ]),
      ];
    }
    return [];
  };

  const closeMenu = () => {
    menu?.invoker.focus();
    setMenu(null);
  };

  const pick = (choice: string) => {
    if (menu === null) {
      return;
    }
    const { item } = menu;
    closeMenu();
    const stepId = item.stepId;
    if (choice === 'goto' && item.target !== null) {
      outline.current?.focusItem(item.target);
      setSelectedId(item.target);
      return;
    }
    if (stepId === null) {
      return;
    }
    const step = stepOf(flow, stepId);
    if (step === undefined) {
      return;
    }
    const separator = choice.indexOf(':');
    const action = separator === -1 ? choice : choice.slice(0, separator);
    const port = separator === -1 ? '' : choice.slice(separator + 1);
    switch (action) {
      case 'add-after':
        setDialog({ kind: 'palette', place: { from: stepId, port: 'next' }, after: label(stepId) });
        break;
      case 'module-after':
        setDialog({ kind: 'module', place: { from: stepId, port: 'next' }, after: label(stepId) });
        break;
      case 'module':
        setDialog({
          kind: 'module',
          place: { from: stepId, port },
          after: `${flowPortLabel(step, port)} of ${label(stepId)}`,
        });
        break;
      case 'here':
        setDialog({
          kind: 'palette',
          place: { from: stepId, port },
          after: `${flowPortLabel(step, port)} of ${label(stepId)}`,
        });
        break;
      case 'fallback':
        setDialog({
          kind: 'palette',
          place: { from: stepId, port: 'exhausted' },
          after: `${flowPortLabel(step, 'exhausted')} of ${label(stepId)}`,
        });
        break;
      case 'connect':
        setDialog({
          kind: 'connect',
          from: stepId,
          port,
          title: copy.dialogs.connect(flowPortLabel(step, port), label(stepId)),
        });
        break;
      case 'add-route': {
        if (step.type !== 'branch') {
          return;
        }
        const taken = new Set(step.routes.map((route) => route.key));
        let number = step.routes.length + 1;
        while (taken.has(`route_${String(number)}`)) {
          number += 1;
        }
        apply(
          addBranchRoute(flow, stepId, `route_${String(number)}`, `Route ${String(number)}`),
          copy.builder.edited.routeAdded(label(stepId)),
          stepId,
        );
        break;
      }
      case 'up':
      case 'down': {
        const moved = moveBranchRoute(flow, stepId, port.replace(/^route:/, ''), action);
        if (moved !== null) {
          apply(moved, copy.builder.edited.routeMoved(flowPortLabel(step, port), action), stepId);
        }
        break;
      }
      case 'settings':
        setSelectedId(stepId);
        break;
      case 'delete':
        setDialog({ kind: 'delete', stepId, label: label(stepId) });
        break;
      default:
        break;
    }
  };

  const palette: readonly FlowPaletteEntry[] =
    dialog?.kind === 'palette' ? FLOW_ADAPTER.paletteOf(flow, dialog.place.from, {}) : [];

  const openPublish = async () => {
    setPublishState({ checking: true, problems: [], acknowledgements: [] });
    setDialog({ kind: 'publish' });
    // Publishing uses the saved draft: unsaved edits are saved first.
    if (base.current !== history.present) {
      await save();
    }
    const result = await actions.check({ versionId });
    if (!result.ok) {
      setPublishState({
        checking: false,
        problems: [{ pointer: '', detail: result.problem.title }],
        acknowledgements: [],
      });
      return;
    }
    setPublishState({
      checking: false,
      problems: result.data.problems.filter((problem) => problem.severity === 'error'),
      acknowledgements: result.data.acknowledgements,
    });
  };

  const selected = selectedId === null ? undefined : stepOf(flow, selectedId);

  return (
    <div className="flex flex-col gap-6">
      {migrated && <Alert tone="info">{copy.builder.migrated}</Alert>}
      {!canEdit && <p className="text-sm">{copy.builder.readOnly}</p>}
      <p role="status" aria-label={copy.builder.status} className="min-h-6 text-sm">
        {status}
      </p>
      <div role="toolbar" aria-label={copy.builder.toolbar} className="flex flex-wrap gap-3">
        {editable && (
          <>
            <Button
              variant="secondary"
              disabled={history.past.length === 0}
              onClick={() => {
                travel('undo');
              }}
            >
              {copy.builder.undo}
            </Button>
            <Button
              variant="secondary"
              disabled={history.future.length === 0}
              onClick={() => {
                travel('redo');
              }}
            >
              {copy.builder.redo}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void save();
              }}
            >
              {copy.builder.save}
            </Button>
            <Button
              variant="secondary"
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              disabled={selectedItem === undefined}
              onClick={(event) => {
                if (selectedItem !== undefined) {
                  setMenu({ item: selectedItem, invoker: event.currentTarget });
                }
              }}
            >
              {copy.builder.selectedActions}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                apply(tidyFlowLayout(flow), copy.builder.edited.tidied);
              }}
            >
              {copy.builder.tidy}
            </Button>
          </>
        )}
        {canPublish && !published && (
          <Button
            onClick={() => {
              void openPublish();
            }}
          >
            {copy.builder.publish}
          </Button>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <OutlineTree
            ref={outline}
            label={copy.outline.label}
            items={items}
            onSelect={(item) => {
              if (item.kind === 'step' && item.stepId !== null) {
                setSelectedId(item.stepId);
              }
            }}
            onActivate={(item, element) => {
              if (menuItems(item).length === 0) {
                setStatus(copy.builder.noActions);
                return;
              }
              setMenu({ item, invoker: element });
            }}
          />
          {menu !== null && (
            <EditMenu
              label={copy.builder.menu(menu.item.label)}
              items={menuItems(menu.item)}
              onPick={pick}
              onClose={closeMenu}
            />
          )}
        </div>
        <section aria-label={copy.builder.canvas}>
          <GraphCanvas
            adapter={FLOW_ADAPTER}
            document={flow}
            issues={issues}
            marks={marks}
            selectedId={selectedId}
            onSelect={(id) => {
              // R010: the outline follows a selection made on the canvas (its selected item and
              // its tab stop), so the keyboard and a screen reader find the step the toolbar's
              // "Actions for the selected step" acts on.
              setSelectedId(id);
              outline.current?.revealItem(id);
            }}
            {...(editable
              ? {
                  onEdit: (edited: { flow: FlowV2; select?: string }, message: string) => {
                    apply(edited.flow, message, edited.select);
                  },
                }
              : {})}
          />
        </section>
      </div>
      {comparison !== null && (
        <section
          aria-label={copy.comparison.heading(comparison.versionNumber)}
          className="flex flex-col gap-2"
        >
          <h2 className="text-base font-semibold">
            {copy.comparison.heading(comparison.versionNumber)}
          </h2>
          <p className="text-sm">{copy.comparison.description}</p>
          <VersionDiffList diff={comparison.diff} />
        </section>
      )}
      <section aria-labelledby={problemsHeading} className="flex flex-col gap-2">
        <h2 id={problemsHeading} className="text-base font-semibold">
          Problems
        </h2>
        <div aria-live="polite">
          {problems.length === 0 ? (
            <p className="text-sm">The format’s rules find no problem.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {problems.map((problem, index) => {
                const step = /^\/steps\/(\d+)/.exec(problem.pointer);
                const owner = step === null ? undefined : flow.steps[Number(step[1])];
                return (
                  <li key={`${String(index)}:${problem.pointer}:${problem.code}`}>
                    <span aria-hidden="true">{problem.severity === 'error' ? '⚠ ' : 'ℹ '}</span>
                    {problem.severity === 'error' ? 'Error' : 'Warning'}
                    {owner === undefined ? '' : `, ${flowStepLabel(flow, owner)}`}: {problem.detail}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
      {(theme !== null || copyPanel !== undefined) && (
        <div className="grid gap-6 md:grid-cols-2">
          {theme !== null && (
            <BuilderThemePanel
              themeSets={theme.sets}
              value={themeSetId}
              {...(editable
                ? {
                    onChange: (next: string | null) => {
                      setThemeSetId(next);
                      void save({ themeSetId: next });
                    },
                  }
                : {})}
            />
          )}
          {copyPanel}
        </div>
      )}
      <section aria-label={copy.builder.selected} className="flex flex-col gap-3">
        {selected === undefined ? (
          <p className="text-sm">{copy.builder.nothingSelected}</p>
        ) : (
          <FlowStepPanel
            flow={flow}
            stepId={selected.id}
            verificationConfig={config}
            editable={editable}
            onVerificationConfigChange={(next, message) => {
              setConfig(next);
              setStatus(message);
            }}
          >
            <StepSchemaForm
              step={selected}
              editable={editable}
              onStepChange={(next, message) => {
                apply(updateFlowStep(flow, next), message, selected.id);
              }}
            />
            {selected.type === 'screen' && (
              <ScreenEditor
                key={selected.id}
                step={selected}
                fields={fieldSchemas ?? []}
                editable={editable}
                onChange={(next, message) => {
                  apply(updateFlowStep(flow, next), message, selected.id);
                }}
              />
            )}
            {selected.type === 'branch' && (
              <BranchRoutes
                flow={flow}
                step={selected}
                editable={editable}
                problems={problems}
                context={fieldSchemas === undefined ? {} : { fieldSchemas }}
                onApply={(next, message) => {
                  apply(next, message, selected.id);
                }}
              />
            )}
            <StepJson
              key={`${selected.id}:${String(history.past.length)}`}
              flow={flow}
              stepId={selected.id}
              editable={editable}
              onApply={(next, message) => {
                apply(next, message, selected.id);
              }}
            />
          </FlowStepPanel>
        )}
      </section>
      {dialog?.kind === 'palette' && (
        <PaletteDialog
          open
          after={dialog.after}
          entries={palette}
          onClose={() => {
            setDialog(null);
          }}
          onPick={(entry) => {
            const taken = idsOf(flow);
            const id = opaqueId('s', randomUnit, taken);
            const edges: [string, string] = [
              opaqueId('e', randomUnit, new Set([...taken, id])),
              opaqueId('e', randomUnit, new Set([...taken, id])),
            ];
            if (edges[1] === edges[0]) {
              edges[1] = opaqueId('e', randomUnit, new Set([...taken, id, edges[0]]));
            }
            const step = stepTemplate(entry.type, id);
            const inserted = insertStepAfter(flow, dialog.place, step, edges);
            setDialog(null);
            apply(
              inserted.flow,
              copy.builder.edited.added(flowStepLabel(inserted.flow, step), dialog.after),
              inserted.select,
            );
          }}
        />
      )}
      {dialog?.kind === 'module' && (
        <ModuleDialog
          open
          after={dialog.after}
          offers={moduleOffers(
            flow,
            dialog.place,
            { explanation },
            fieldSchemas === undefined ? {} : { fieldSchemas },
          )}
          explanation={explanation}
          onExplanation={setExplanation}
          onClose={() => {
            setDialog(null);
          }}
          onPick={(offer) => {
            const taken = idsOf(flow);
            const inserted = insertModule(
              flow,
              dialog.place,
              offer.key,
              { explanation },
              (prefix) => {
                const id = opaqueId(prefix, randomUnit, taken);
                taken.add(id);
                return id;
              },
            );
            setDialog(null);
            if (inserted !== null) {
              apply(
                inserted.flow,
                copy.modules.inserted(offer.label, dialog.after),
                inserted.select,
              );
            }
          }}
        />
      )}
      {dialog?.kind === 'connect' && (
        <ConnectDialog
          open
          title={dialog.title}
          targets={validFlowTargets(flow, dialog.from, dialog.port).map((id) => ({
            id,
            label: label(id),
          }))}
          onClose={() => {
            setDialog(null);
          }}
          onConnect={(target) => {
            const edgeId = opaqueId('e', randomUnit, idsOf(flow));
            const step = stepOf(flow, dialog.from);
            setDialog(null);
            apply(
              connectFlowPort(flow, dialog.from, dialog.port, target, edgeId),
              copy.builder.edited.connected(
                flowPortLabel(step, dialog.port),
                label(dialog.from),
                label(target),
              ),
              dialog.from,
            );
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          open
          label={dialog.label}
          onClose={() => {
            setDialog(null);
          }}
          onDelete={() => {
            const next = deleteFlowStep(flow, dialog.stepId);
            setDialog(null);
            if (next !== null) {
              setSelectedId(null);
              apply(next, copy.builder.edited.deleted(dialog.label));
            }
          }}
        />
      )}
      {dialog?.kind === 'conflict' && (
        <ConflictDialog
          open
          changes={dialog.changes}
          onReload={() => {
            etag.current = dialog.latest.etag;
            base.current = dialog.latest.flow;
            setHistory(startHistory(dialog.latest.flow));
            setDialog(null);
            setStatus(copy.builder.edited.reloaded);
          }}
        />
      )}
      {dialog?.kind === 'publish' && (
        <PublishDialog
          open
          state={publishState}
          reasonOf={reasonOf}
          onClose={() => {
            setDialog(null);
          }}
          onPublish={(acknowledgements, note) => {
            void (async () => {
              const result = await actions.publish({
                versionId,
                etag: etag.current,
                acknowledgements,
                note,
              });
              setDialog(null);
              if (result.ok) {
                etag.current = result.data.etag;
                setPublished(true);
                setStatus(copy.dialogs.published);
              } else {
                setStatus(copy.builder.saveFailed(result.problem.title));
              }
            })();
          }}
        />
      )}
    </div>
  );
}

/** The step as JSON, the editor's fallback for every member a form does not cover (C141). */
function StepJson({
  flow,
  stepId,
  editable,
  onApply,
}: {
  readonly flow: FlowV2;
  readonly stepId: string;
  readonly editable: boolean;
  readonly onApply: (flow: FlowV2, message: string) => void;
}) {
  const id = useId();
  const step = stepOf(flow, stepId);
  const [text, setText] = useState(() => JSON.stringify(step, null, 2));
  const [name, setName] = useState(step !== undefined && 'name' in step ? (step.name ?? '') : '');
  const [problem, setProblem] = useState<string | null>(null);
  if (step === undefined) {
    return null;
  }
  const named = step.type === 'screen' || step.type === 'branch' || step.type === 'action';
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Id <code className="font-mono text-xs">{step.id}</code>: a person can see it, so it carries
        no word; the name is yours.
      </p>
      {named && editable && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Name</span>
          <input
            value={name}
            maxLength={200}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
            onBlur={() => {
              if (name.trim() !== '' && name !== ('name' in step ? step.name : undefined)) {
                onApply(
                  setStepName(flow, stepId, name.trim()),
                  `Renamed the step to ${name.trim()}.`,
                );
              }
            }}
            className="min-h-11 rounded-md border border-control px-3"
          />
        </label>
      )}
      <label htmlFor={`${id}-json`} className="text-sm font-semibold">
        The step as JSON
      </label>
      <textarea
        id={`${id}-json`}
        value={text}
        readOnly={!editable}
        rows={10}
        aria-describedby={problem === null ? undefined : `${id}-problem`}
        onChange={(event) => {
          setText(event.currentTarget.value);
        }}
        className="rounded-md border border-control p-3 font-mono text-xs"
      />
      {problem !== null && (
        <p id={`${id}-problem`} className="text-sm">
          {problem}
        </p>
      )}
      {editable && (
        <Button
          variant="secondary"
          onClick={() => {
            let value: unknown;
            try {
              value = JSON.parse(text);
            } catch {
              setProblem('This is not JSON.');
              return;
            }
            const parsed = stepV2Schema.safeParse(value);
            if (!parsed.success || parsed.data.id !== stepId) {
              setProblem(
                parsed.success
                  ? 'A step keeps its id.'
                  : parsed.error.issues
                      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                      .join('; '),
              );
              return;
            }
            setProblem(null);
            onApply(updateFlowStep(flow, parsed.data), `Changed ${flowStepLabel(flow, step)}.`);
          }}
        >
          Apply the JSON
        </Button>
      )}
    </div>
  );
}
