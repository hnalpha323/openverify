'use client';

/**
 * Widget overrides for sets of enum values (C153.1, C153.2), so a list of choices is ticked rather
 * than typed as JSON: `enumSetWidgetOf` for a list such as a step's `captureMethods`, and
 * `captureMethodsByDeviceWidgetOf` for `captureMethodsByDevice`, one set per device class (a class
 * with nothing ticked is left out, so it follows `captureMethods`). The contract judges the result.
 */
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import type { SchemaWidgetProps } from './schema-form';

const COPY = TEMPLATE_FORMS_COPY.stepForm;

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function Choices({
  options,
  chosen,
  onChosen,
}: {
  readonly options: readonly string[];
  readonly chosen: readonly string[];
  readonly onChosen: (next: string[]) => void;
}) {
  return options.map((option) => (
    <label key={option} className="flex min-h-6 items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-6"
        checked={chosen.includes(option)}
        onChange={(event) => {
          onChosen(
            event.currentTarget.checked
              ? [...chosen, option]
              : chosen.filter((item) => item !== option),
          );
        }}
      />
      {option}
    </label>
  ));
}

/** A list of `options` as checkboxes, in the order they were ticked. */
export function enumSetWidgetOf(options: readonly string[]) {
  function EnumSet({ id, labelId, value, onValue, describedBy, invalid }: SchemaWidgetProps) {
    return (
      <div
        id={id}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="flex flex-wrap gap-x-6 gap-y-2"
      >
        <Choices options={options} chosen={stringsOf(value)} onChosen={onValue} />
      </div>
    );
  }
  return EnumSet;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `captureMethodsByDevice`: a set of `methods` per device class of `devices`. */
export function captureMethodsByDeviceWidgetOf(
  devices: readonly string[],
  methods: readonly string[],
) {
  function CaptureMethodsByDevice({
    id,
    labelId,
    value,
    onValue,
    describedBy,
    invalid,
  }: SchemaWidgetProps) {
    const current = isRecord(value) ? value : {};
    return (
      <div
        id={id}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="flex flex-col gap-3"
      >
        {devices.map((device) => (
          <fieldset key={device} className="flex flex-col gap-1">
            <legend className="text-sm font-medium">{COPY.deviceGroup(device)}</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Choices
                options={methods}
                chosen={stringsOf(current[device])}
                onChosen={(next) => {
                  const changed = Object.fromEntries(
                    Object.entries({ ...current, [device]: next }).filter(
                      ([, chosen]) => stringsOf(chosen).length > 0,
                    ),
                  );
                  onValue(Object.keys(changed).length === 0 ? undefined : changed);
                }}
              />
            </div>
            {stringsOf(current[device]).length === 0 && (
              <p className="text-xs text-ink-muted">{COPY.noMethods}</p>
            )}
          </fieldset>
        ))}
      </div>
    );
  }
  return CaptureMethodsByDevice;
}
