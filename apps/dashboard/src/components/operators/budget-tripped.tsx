import { Timestamp } from '../timestamp';

/**
 * C55.7 (V08): when the environment's text message budget last tripped, read-only, from the
 * latest `environment.otp-sms-budget-tripped` audit entry the settings resource serves: "Never"
 * when it never has, "Not reported" by a server that does not serve it.
 */
export function BudgetTripped({ at }: { readonly at: string | null | undefined }) {
  if (at === undefined) {
    return <span className="text-ink-muted">Not reported</span>;
  }
  return at === null ? <>Never</> : <Timestamp value={at} />;
}
