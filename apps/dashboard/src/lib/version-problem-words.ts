/**
 * The problem codes a template version's publish and its signal and handoff routes answer, in
 * words (C90.6, C96, C99.5, C108). A version's publish answers its first problem's code with every
 * pointer (`assertPublishable`), so each error names the document it is about and its path inside
 * it: the flow, the verification config, the settings, the signal config or the list config.
 */
import { SIGNAL_PROBLEM_CODES, type SignalProblemCode } from '@openverify/contracts';
import type { DisplayProblem } from './action-state';

/** The two list publish codes that land on `list-config` (`listConfigPublishProblems`). */
export type ListConfigProblemCode = 'list_kind_mismatch' | 'kind_not_collected';

export const SIGNAL_PROBLEM_WORDS: Readonly<
  Record<SignalProblemCode | ListConfigProblemCode, string>
> = Object.freeze({
  unknown_signal: 'A signal named in the signal config is not in the catalogue.',
  signal_not_reviewable:
    'A review rule tests a signal no rule may test (inquiry/list_match_count: use on-list-match instead).',
  signal_rule_invalid:
    "A review rule does not fit: its signal is not collected, or its comparison does not fit the signal's type.",
  provider_not_bound:
    'A proxy rule needs an IP reputation provider, and none is bound in this environment.',
  basis_required: 'Exempt device recognition needs a recorded basis.',
  sandbox_only_value: 'This value works only in a sandbox environment.',
  consent_required: 'The session has not consented to this collection.',
  consent_text_missing:
    "The flow's consent step does not list the consent or notice text this collection needs.",
  consent_key_conflicts_with_exempt:
    'Exempt device recognition cannot also offer the optional consent.device-recognition tick.',
  filter_required: 'This list needs a filter.',
  session_limit_reached: 'The inquiry has reached its session limit.',
  sms_not_configured:
    'A handoff step offers SMS, and no SMS provider is bound in this environment.',
  display_name_required:
    'A handoff step needs the organization display name: set it on the Settings page first.',
  destination_not_confirmed: 'The handoff destination is not one this inquiry confirmed.',
  handoff_method_not_allowed: 'The handoff step does not offer this method.',
  handoff_not_available: 'No handoff step is waiting.',
  handoff_token_invalid: 'The handoff link is not valid.',
  session_handed_off: 'This session handed off to another device, which is active.',
  continue_here_not_allowed: 'The handoff step does not allow continuing on this device.',
  handoff_not_redeemed: 'No handoff was redeemed, so there is nothing to reject.',
  handoff_send_limited: 'The handoff send budget is spent for now.',
  list_kind_mismatch: 'A list named in the list config is of another kind than expected.',
  kind_not_collected:
    'A list named in the list config is of a kind this environment does not collect (fingerprints without device recognition, or geolocation without City Lite).',
});

const CODES: ReadonlySet<string> = new Set([
  ...SIGNAL_PROBLEM_CODES,
  'list_kind_mismatch',
  'kind_not_collected',
]);

const isCode = (code: string | undefined): code is SignalProblemCode | ListConfigProblemCode =>
  code !== undefined && CODES.has(code);

/** The documents of a version, in its request, as the editor names them. */
const DOCUMENTS = [
  ['/data/attributes/flow', 'Flow'],
  ['/data/attributes/verification-config', 'Verification config'],
  ['/data/attributes/settings', 'Settings'],
  ['/data/attributes/signal-config', 'Signal config'],
  ['/data/attributes/list-config', 'List config'],
] as const;

/** An error's detail, naming its document and its path inside it. */
function placed(pointer: string, detail: string): string {
  const words = isCode(detail) ? SIGNAL_PROBLEM_WORDS[detail] : detail;
  for (const [prefix, label] of DOCUMENTS) {
    if (pointer === prefix || pointer.startsWith(`${prefix}/`)) {
      return `${label}, at ${pointer.slice(prefix.length) || '/'}: ${words}`;
    }
  }
  return words;
}

/** A version's problem, titled in words by its code, each error naming its document. */
export function describeVersionProblem(problem: DisplayProblem): DisplayProblem {
  if (!isCode(problem.code)) {
    return problem;
  }
  return {
    ...problem,
    title: SIGNAL_PROBLEM_WORDS[problem.code],
    ...(problem.errors === undefined
      ? {}
      : {
          errors: problem.errors.map((error) => ({
            ...error,
            detail: placed(error.pointer, error.detail),
          })),
        }),
  };
}
