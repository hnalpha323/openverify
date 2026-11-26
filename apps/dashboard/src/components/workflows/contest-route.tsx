/**
 * A contest route (C128.3, C128.7): how a person contests an automated decision, shown with a
 * URL's host first, and its two form fields. An undeclared route reads "Not declared", never empty.
 */
import type { ContestRoute } from '@openverify/contracts';
import { fieldErrorOf, type DisplayProblem } from '../../lib/action-state';
import { FormField, controlClassName } from '../form-field';

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function ContestRouteWords({ route }: { readonly route: ContestRoute | null }) {
  if (route === null) {
    return <>Not declared</>;
  }
  return (
    <span className="flex flex-col gap-1">
      {route.url !== undefined && (
        <span>
          {`${hostOf(route.url)}: `}
          <span className="break-all">{route.url}</span>
        </span>
      )}
      {route.contact !== undefined && <span>{`Contact: ${route.contact}`}</span>}
    </span>
  );
}

export function ContestRouteFields({
  route,
  problem,
  pointer,
}: {
  readonly route: ContestRoute | null;
  readonly problem: DisplayProblem | undefined;
  /** Where the API and the form name the route, such as `/data/attributes/contest-route`. */
  readonly pointer: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <FormField
        label="Contest route URL"
        description="An https: page where the person contests an automated decision."
        error={fieldErrorOf(problem, `${pointer}/url`)}
        className="min-w-72"
      >
        {(control) => (
          <input
            {...control}
            name="contest-url"
            type="url"
            defaultValue={route?.url ?? ''}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField
        label="Contest route contact"
        description="Or how the person reaches a reviewer."
        error={fieldErrorOf(problem, `${pointer}/contact`)}
        className="min-w-72"
      >
        {(control) => (
          <input
            {...control}
            name="contest-contact"
            maxLength={200}
            defaultValue={route?.contact ?? ''}
            className={controlClassName(control)}
          />
        )}
      </FormField>
    </div>
  );
}
