import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JsonEditor, describeJsonError } from './json-editor';

const VALID = '{"steps":[{"id":"consent"}]}';

function editor() {
  return screen.getByRole('textbox', { name: 'Flow' });
}

describe('JsonEditor', () => {
  it('is a labelled, monospaced text area that posts its text under its name', () => {
    render(<JsonEditor label="Flow" name="flow" defaultValue={VALID} />);

    expect(editor()).toHaveValue(VALID);
    expect(editor()).toHaveAttribute('name', 'flow');
    expect(editor()).toHaveAttribute('spellcheck', 'false');
    expect(editor()).toHaveClass('font-mono');
  });

  it('is outlined with the control border, 3:1 or more (Workflow 2D F010)', () => {
    render(<JsonEditor label="Flow" name="flow" defaultValue={VALID} />);

    expect(editor()).toHaveClass('border-control');
    expect(editor()).not.toHaveClass('border-line');
  });

  it('formats valid JSON with two-space indentation', async () => {
    render(<JsonEditor label="Flow" name="flow" defaultValue={VALID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Format' }));

    expect(editor()).toHaveValue(JSON.stringify(JSON.parse(VALID), null, 2));
    expect(screen.getByRole('status')).toHaveTextContent('Formatted.');
  });

  it('says valid JSON is valid', async () => {
    render(<JsonEditor label="Flow" name="flow" defaultValue={VALID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));

    expect(screen.getByRole('status')).toHaveTextContent('Valid JSON.');
    expect(editor()).not.toHaveAttribute('aria-invalid');
  });

  it('points at the line and column of a syntax error, and leaves the text as it is', async () => {
    const broken = '{\n  "steps": [\n    {"id": "consent",}\n  ]\n}';
    render(<JsonEditor label="Flow" name="flow" defaultValue={broken} />);

    await userEvent.click(screen.getByRole('button', { name: 'Format' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/^Not valid JSON: line 3, column \d+/);
    expect(editor()).toHaveAttribute('aria-invalid', 'true');
    expect(editor()).toHaveValue(broken);
  });

  it('clears the verdict once the text changes', async () => {
    render(<JsonEditor label="Flow" name="flow" defaultValue="{" />);
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));

    fireEvent.change(editor(), { target: { value: '{}' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(editor()).not.toHaveAttribute('aria-invalid');
  });

  it("lists the API's errors for this document, by path, and marks it invalid", () => {
    render(
      <JsonEditor
        label="Flow"
        name="flow"
        defaultValue={VALID}
        errors={[{ pointer: '/data/attributes/flow/steps/0/id', detail: 'Unknown step.' }]}
      />,
    );

    const list = screen.getByRole('list', { name: 'Problems in Flow' });
    expect(list).toHaveTextContent('/data/attributes/flow/steps/0/id');
    expect(list).toHaveTextContent('Unknown step.');
    expect(editor()).toHaveAttribute('aria-invalid', 'true');
  });

  it("names the API's error details in its description, not only their heading (Workflow 2E F013)", () => {
    render(
      <JsonEditor
        label="Flow"
        name="flow"
        defaultValue={VALID}
        errors={[{ pointer: '/data/attributes/flow/steps/0/id', detail: 'Unknown step.' }]}
      />,
    );

    expect(editor()).toHaveAccessibleDescription(
      expect.stringContaining('/data/attributes/flow/steps/0/id: Unknown step.'),
    );
  });

  it('reports each change', () => {
    const onChange = vi.fn();
    render(<JsonEditor label="Flow" name="flow" defaultValue="" onChange={onChange} />);

    fireEvent.change(editor(), { target: { value: '[]' } });

    expect(onChange).toHaveBeenCalledWith('[]');
  });
});

describe('describeJsonError', () => {
  it('turns a position into a line and column', () => {
    expect(
      describeJsonError('{\n "a": }', new SyntaxError('Unexpected token } in JSON at position 8')),
    ).toBe('line 2, column 7: Unexpected token } in JSON');
  });

  it('keeps the message when it names no position', () => {
    expect(describeJsonError('', new SyntaxError('Unexpected end of JSON input'))).toBe(
      'Unexpected end of JSON input',
    );
  });
});
