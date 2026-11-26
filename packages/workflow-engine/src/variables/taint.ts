/**
 * PII taint (plan C115.6, C121.4, P28, P20). A value is tainted when it is a `pii: true` variable, a
 * PII attribute of a contract, or derived from one: the scope already carries those marks through
 * Calculate, Evaluate Code, an HTTPS body, a loop item and a module. This pass reads every value a
 * step sends somewhere, and:
 * - marks what leaves the platform in the version's `egress`, which publish needs acknowledged;
 * - refuses taint into a plain sink, and into a URL;
 * - allows a PII-to-PII copy into another object, which the effect row records (C120.9).
 */
import type { WorkflowOutput, WorkflowStep } from '@openverify/contracts';
import type { ActionRegistry } from '../actions/registry.js';
import { pointerOf, type DefinitionIssue, type JsonValue } from '../expressions/json.js';
import type { ActionStep, GraphIndex } from '../graph/structure.js';
import { ACTION_SINKS, parseConfigTemplates, type ActionSinkTable } from '../templates/sinks.js';
import { parseTemplate, type TemplateReference } from '../templates/render.js';
import { containsPii, type NodeScopes } from './scope.js';
import { resolvePath, type ScopeType } from './types.js';

/** C121.4: a step that sends tainted values off the platform. */
export interface EgressMark {
  readonly stepId: string;
  /** The tainted paths, never their values. */
  readonly paths: readonly string[];
  /** The literal host, or the kind of channel. */
  readonly destination: string;
}

export interface TaintAnalysis {
  readonly issues: readonly DefinitionIssue[];
  readonly egress: readonly EgressMark[];
}

const CHANNELS: Readonly<Record<string, string>> = {
  send_email: 'email',
  send_sms: 'sms',
  send_slack_message: 'slack',
  send_inquiry_link_email: 'email',
  send_inquiry_link_sms: 'sms',
};

const ORIGIN = /^https:\/\/([^/:?#]+)/i;

function destinationOf(step: ActionStep): string {
  const { url } = step.config;
  const [, host] = (typeof url === 'string' ? ORIGIN.exec(url) : null) ?? [];
  return CHANNELS[step['action-key']] ?? host?.toLowerCase() ?? step['action-key'];
}

const referencesOf = (raw: JsonValue | undefined): readonly TemplateReference[] => {
  const parsed = raw === undefined ? null : parseTemplate(raw);
  return parsed?.ok === true ? parsed.template.references : [];
};

function isTainted({ path, secret }: TemplateReference, scope: ScopeType): boolean {
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (secret !== null) {
    return false;
  }
  const resolved = resolvePath(scope, path.segments);
  return resolved.ok && (resolved.pii || containsPii(resolved.type));
}

const PLAIN_SINK = 'This member is plain text, so it never carries personal data';

class TaintWalk {
  readonly issues: DefinitionIssue[] = [];
  readonly egress: EgressMark[] = [];

  constructor(
    private readonly graph: GraphIndex,
    private readonly scopes: NodeScopes,
    private readonly registry: ActionRegistry,
    private readonly sinks: ActionSinkTable,
  ) {}

  private plain(pointer: string): void {
    this.issues.push({ pointer, code: 'pii_into_plain_sink', detail: PLAIN_SINK });
  }

  private checkAction(step: ActionStep, index: number, scope: ScopeType): void {
    const base = pointerOf('/steps', index, 'config');
    const { references } = parseConfigTemplates(step.config);
    const tainted = references.filter((reference) => isTainted(reference, scope));
    const key = step['action-key'];
    for (const { pointer } of tainted) {
      const member = this.sinks.sinkOf(key, pointer);
      if (member.sink === 'url') {
        this.issues.push({
          pointer: `${base}${pointer}`,
          code: 'pii_in_url',
          detail: 'Personal data goes in the JSON body or a header, never in a URL',
        });
      } else if (member.plain) {
        this.plain(`${base}${pointer}`);
      }
    }
    if (key === 'update_variable') {
      this.checkVariable(step, index, tainted.length > 0);
    }
    if (key === 'update_object') {
      this.checkObjectField(step, base, tainted.length > 0);
    }
    if (tainted.length > 0 && this.registry.get(key, step['action-version'])?.kind === 'egress') {
      this.egress.push({
        stepId: step.id,
        paths: [...new Set(tainted.map(({ path }) => path.text))],
        destination: destinationOf(step),
      });
    }
  }

  /** C115.6: a variable assigned a tainted value must be declared `pii: true`. */
  private checkVariable(step: ActionStep, index: number, tainted: boolean): void {
    const declared = this.graph.definition.variables.find(({ name }) => name === step.config.name);
    if (tainted && declared?.pii !== true) {
      this.plain(pointerOf('/steps', index, 'config', 'value'));
    }
  }

  /** C127.8: `tags` and a status are plain, and custom fields take a recorded copy (C120.9). */
  private checkObjectField(step: ActionStep, base: string, tainted: boolean): void {
    if (tainted && (step.config.field === 'tags' || step.config.field === 'status')) {
      this.plain(`${base}/value`);
    }
  }

  /** C115.6: a run output not declared PII is a plain sink. */
  private checkOutput(
    step: Extract<WorkflowStep, { type: 'output' }>,
    index: number,
    scope: ScopeType,
  ): void {
    const declared = new Map<string, WorkflowOutput>(
      this.graph.definition.outputs.map((output) => [output.name, output]),
    );
    for (const [name, mapping] of Object.entries(step.mappings)) {
      const tainted = referencesOf(mapping).some((reference) => isTainted(reference, scope));
      if (tainted && declared.get(name)?.pii !== true) {
        this.plain(pointerOf('/steps', index, 'mappings', name));
      }
    }
  }

  walk(): void {
    this.graph.definition.steps.forEach((step, index) => {
      const scope = this.scopes.at.get(step.id);
      if (scope !== undefined) {
        if (step.type === 'action') {
          this.checkAction(step, index, scope);
        } else if (step.type === 'output') {
          this.checkOutput(step, index, scope);
        }
      }
    });
  }
}

/** C115.6, C121.4: the taint rules over a definition whose scopes were built. */
export function analyzeTaint(
  graph: GraphIndex,
  scopes: NodeScopes,
  registry: ActionRegistry,
  sinks: ActionSinkTable = ACTION_SINKS,
): TaintAnalysis {
  const walk = new TaintWalk(graph, scopes, registry, sinks);
  walk.walk();
  return { issues: walk.issues, egress: walk.egress };
}
