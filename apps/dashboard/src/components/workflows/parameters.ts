/**
 * The parameter forms of account actions, case actions, manual runs and test runs (C118.7, C140.1,
 * C141.7): one control per declared input, named `parameter.<name>`, with its declared type in a
 * hidden `parameter-type.<name>`, read back into typed JSON values (the C115.3 type DSL).
 */
export const PARAMETER_PREFIX = 'parameter.';
export const PARAMETER_TYPE_PREFIX = 'parameter-type.';

/** How a declared type is entered. */
export type ParameterControl = 'text' | 'number' | 'boolean' | 'datetime' | 'json';

export function parameterControlOf(type: string): ParameterControl {
  const base = type.trim();
  if (base === 'number' || base === 'integer') {
    return 'number';
  }
  if (base === 'boolean') {
    return 'boolean';
  }
  if (base === 'datetime') {
    return 'datetime';
  }
  if (base.startsWith('list<') || base.startsWith('object{')) {
    return 'json';
  }
  return 'text';
}

export class ParameterInputError extends Error {
  constructor(readonly names: readonly string[]) {
    super('Some parameters are not valid.');
  }
}

const INVALID = Symbol('invalid');

function valueOf(type: string, text: string): unknown {
  switch (parameterControlOf(type)) {
    case 'number': {
      const value = Number(text);
      if (!Number.isFinite(value) || (type.trim() === 'integer' && !Number.isInteger(value))) {
        return INVALID;
      }
      return value;
    }
    case 'boolean':
      return text === 'true' ? true : text === 'false' ? false : INVALID;
    case 'json':
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return INVALID;
      }
    case 'datetime': {
      const instant = new Date(text);
      return Number.isNaN(instant.getTime()) ? INVALID : instant.toISOString();
    }
    case 'text':
      return text;
  }
}

/**
 * The parameters a form holds, each converted to its declared type; an empty control is left out.
 * @throws ParameterInputError naming each control that does not hold its type.
 */
export function parametersOf(formData: FormData): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  const invalid: string[] = [];
  for (const [key, type] of formData.entries()) {
    if (!key.startsWith(PARAMETER_TYPE_PREFIX) || typeof type !== 'string') {
      continue;
    }
    const name = key.slice(PARAMETER_TYPE_PREFIX.length);
    const raw = formData.get(`${PARAMETER_PREFIX}${name}`);
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text === '') {
      continue;
    }
    const value = valueOf(type, text);
    if (value === INVALID) {
      invalid.push(name);
    } else {
      parameters[name] = value;
    }
  }
  if (invalid.length > 0) {
    throw new ParameterInputError(invalid);
  }
  return parameters;
}
