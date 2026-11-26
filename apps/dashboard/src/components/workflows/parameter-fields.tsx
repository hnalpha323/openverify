'use client';

/**
 * The controls of a parameter form (C118.7, C140.1): one per declared input, typed by its control,
 * prefilled with what the API served. A `null` prefill is empty: the API sends `null` for a value
 * hidden from the viewer as well as for none (P38), and the run reads the live value under its own
 * grant.
 */
import { FormField, controlClassName } from '../form-field';
import { PARAMETER_PREFIX, PARAMETER_TYPE_PREFIX, parameterControlOf } from './parameters';

export interface ParameterInput {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly 'prefilled-value'?: unknown;
}

const textOf = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
};

export function ParameterFields({ inputs }: { readonly inputs: readonly ParameterInput[] }) {
  if (inputs.length === 0) {
    return <p className="text-sm text-ink-muted">This action takes no parameters.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        A value hidden from you stays empty; the run reads the live value under its own grant.
      </p>
      {inputs.map((input) => {
        const control = parameterControlOf(input.type);
        const name = `${PARAMETER_PREFIX}${input.name}`;
        const value = input['prefilled-value'];
        return (
          <div key={input.name}>
            <input
              type="hidden"
              name={`${PARAMETER_TYPE_PREFIX}${input.name}`}
              value={input.type}
            />
            <FormField
              label={
                <>
                  <code className="font-mono">{input.name}</code>{' '}
                  <span className="font-normal text-ink-muted">({input.type})</span>
                </>
              }
              required={input.required}
            >
              {(props) => {
                const className = controlClassName(props);
                switch (control) {
                  case 'boolean':
                    return (
                      <select
                        {...props}
                        name={name}
                        defaultValue={typeof value === 'boolean' ? String(value) : ''}
                        className={className}
                      >
                        <option value="">Not set</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    );
                  case 'number':
                    return (
                      <input
                        {...props}
                        type="number"
                        step="any"
                        name={name}
                        defaultValue={typeof value === 'number' ? value : ''}
                        className={className}
                      />
                    );
                  case 'json':
                    return (
                      <textarea
                        {...props}
                        name={name}
                        rows={3}
                        defaultValue={textOf(value)}
                        className={`${className} font-mono`}
                      />
                    );
                  case 'datetime':
                  case 'text':
                    return (
                      <input
                        {...props}
                        type="text"
                        name={name}
                        defaultValue={textOf(value)}
                        {...(control === 'datetime' ? { placeholder: '2026-11-01T09:00:00Z' } : {})}
                        className={className}
                      />
                    );
                }
              }}
            </FormField>
          </div>
        );
      })}
    </div>
  );
}
