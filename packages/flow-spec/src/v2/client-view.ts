/**
 * C151.5 (owner `flow-spec-logic`; review P14): the allowlisted view of a step that a client which
 * declared spec 2 renders. A screen keeps its components (copy keys, validation, same-screen rules)
 * and loses its name; a v1 step type loses every v2 member but `captureMethodsByDevice` on the two
 * capture steps that take it (`prefillFrom` reaches the client as the session's `values`, the
 * fallback and the failure bases stay on the server); a branch and an action are never sent, so no
 * route condition, threshold or signal name reaches the person. An `nfc` view also says whether
 * the step has a fallback (`fallbackAvailable`, C207.9), never where it leads.
 */
import type { ClientStepView, ShareConsentClientView } from './schemas/client-view.js';
import type { FlowV2Step, ShareConsentStep } from './schemas/steps.js';
import { V2_STEP_MEMBERS, withoutMembers } from './step-members.js';

const CAPTURE_BY_DEVICE: ReadonlySet<string> = new Set(['government_id', 'document']);

/** The step a spec-2 client renders; `null` for a branch or an action, which no client sees. */
export function clientViewOf(
  step: FlowV2Step,
  /**
   * C207.9 (Workflow 10C; review F26): the flow's edges. With them, an `nfc` view says whether the
   * step has an `exhausted` edge (`fallbackAvailable`); without them the member is left out.
   */
  flow?: { readonly edges: readonly { from: string; port: string; to: string }[] },
): ClientStepView | null {
  switch (step.type) {
    case 'branch':
    case 'action':
      return null;
    // C238.3 (Workflow 11A): composed by the session builder (`shareConsentClientViewOf`) from the
    // server's own names and texts; never built from the step alone.
    case 'share_consent':
      return null;
    case 'screen':
      return { id: step.id, type: 'screen', components: step.components };
    default: {
      const dropped = CAPTURE_BY_DEVICE.has(step.type)
        ? V2_STEP_MEMBERS.filter((member) => member !== 'captureMethodsByDevice')
        : V2_STEP_MEMBERS;
      // Only members of the step's own v1 schema (and, for the capture steps, the device map) stay.
      const view = withoutMembers(step, dropped) as ClientStepView;
      if (view.type !== 'nfc' || flow === undefined) {
        return view;
      }
      return {
        ...view,
        fallbackAvailable: flow.edges.some(
          (edge) => edge.from === step.id && edge.port === 'exhausted',
        ),
      };
    }
  }
}

/** C238.3: the members of a `share_consent` view that the server composes. */
export type ShareConsentComposition = Omit<ShareConsentClientView, 'id' | 'type' | 'side'>;

/**
 * C238.3 (Phase 11, Workflow 11A): the client view of a `share_consent` step, from the composition
 * the API builds (`services/flow-views/share-consent.ts`: the names, the categories, the texts and
 * their digests). Only the step's id and side come from the step itself.
 */
export function shareConsentClientViewOf(
  step: ShareConsentStep,
  composition: ShareConsentComposition,
): ShareConsentClientView {
  return { id: step.id, type: 'share_consent', side: step.side, ...composition };
}
