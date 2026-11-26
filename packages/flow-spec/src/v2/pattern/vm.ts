/**
 * C148.3 (P03): the compiled form of a pattern and the Pike VM that runs it. The program is a list
 * of instructions; the VM keeps the set of instructions every match could be at, advancing all of
 * them one code point at a time, and visits each instruction at most once per position. So a match
 * costs at most (input length + 1) x program length steps, whatever the pattern: no backtracking,
 * and no pattern can make it exponential or polynomial in the input.
 */
import { PATTERN_PROGRAM_LIMIT } from './limits.js';
import { PatternRefusal, type PatternNode } from './parse.js';

const SET = 0;
const SPLIT = 1;
const JUMP = 2;
const START = 3;
const END = 4;
const MATCH = 5;

type Instruction =
  | { readonly op: typeof SET; readonly ranges: readonly number[]; readonly negate: boolean }
  | { readonly op: typeof SPLIT; x: number; y: number }
  | { readonly op: typeof JUMP; x: number }
  | { readonly op: typeof START | typeof END | typeof MATCH };

export type Program = readonly Instruction[];

/** Matches nothing: what an index outside the program reads as, so it can never match (fails closed). */
const DEAD: Instruction = Object.freeze({ op: SET, ranges: [], negate: false });

const instructionAt = (program: Program, pc: number): Instruction => program[pc] ?? DEAD;

class Emitter {
  readonly program: Instruction[] = [];

  push(instruction: Instruction): Instruction {
    if (this.program.length >= PATTERN_PROGRAM_LIMIT) {
      throw new PatternRefusal('pattern_too_complex', null);
    }
    this.program.push(instruction);
    return instruction;
  }

  get here(): number {
    return this.program.length;
  }

  emit(node: PatternNode): void {
    switch (node.t) {
      case 'set':
        this.push({ op: SET, ranges: node.ranges, negate: node.negate });
        return;
      case 'start':
        this.push({ op: START });
        return;
      case 'end':
        this.push({ op: END });
        return;
      case 'cat':
        for (const item of node.items) this.emit(item);
        return;
      case 'alt':
        this.emitAlternatives(node.options);
        return;
      case 'rep':
        this.emitRepeat(node.body, node.min, node.max);
        return;
    }
  }

  /** split L1, L2; L1: first; jump end; L2: split ...; the last option falls through. */
  private emitAlternatives(options: readonly PatternNode[]): void {
    const jumps: { op: typeof JUMP; x: number }[] = [];
    options.forEach((option, index) => {
      if (index === options.length - 1) {
        this.emit(option);
        return;
      }
      const split = this.push({ op: SPLIT, x: 0, y: 0 }) as {
        op: typeof SPLIT;
        x: number;
        y: number;
      };
      split.x = this.here;
      this.emit(option);
      jumps.push(this.push({ op: JUMP, x: 0 }) as { op: typeof JUMP; x: number });
      split.y = this.here;
    });
    for (const jump of jumps) jump.x = this.here;
  }

  /** `min` copies, then `max - min` optional ones, or a loop when unbounded. */
  private emitRepeat(body: PatternNode, min: number, max: number): void {
    for (let copy = 0; copy < min; copy += 1) this.emit(body);
    if (max === -1) {
      const loop = this.here;
      const split = this.push({ op: SPLIT, x: 0, y: 0 }) as {
        op: typeof SPLIT;
        x: number;
        y: number;
      };
      split.x = this.here;
      this.emit(body);
      this.push({ op: JUMP, x: loop });
      split.y = this.here;
      return;
    }
    const splits: { op: typeof SPLIT; x: number; y: number }[] = [];
    for (let copy = min; copy < max; copy += 1) {
      const split = this.push({ op: SPLIT, x: 0, y: 0 }) as {
        op: typeof SPLIT;
        x: number;
        y: number;
      };
      split.x = this.here;
      splits.push(split);
      this.emit(body);
    }
    for (const split of splits) split.y = this.here;
  }
}

/** The program of a parsed pattern, or a `PatternRefusal` (`pattern_too_complex`). */
export function compileProgram(node: PatternNode): Program {
  const emitter = new Emitter();
  emitter.emit(node);
  emitter.push({ op: MATCH });
  return emitter.program;
}

function inSet(ranges: readonly number[], negate: boolean, point: number): boolean {
  let found = false;
  for (let index = 0; index < ranges.length && !found; index += 2) {
    found = point >= (ranges[index] ?? 0) && point <= (ranges[index + 1] ?? -1);
  }
  return found !== negate;
}

/** Whether the whole of `input` matches `program`. */
export function runProgram(program: Program, input: string): boolean {
  const points: number[] = [];
  for (const character of input) points.push(character.codePointAt(0) ?? 0);
  const length = points.length;
  const size = program.length;
  // `seen[pc]` is the last position `pc` was added at, so each is visited once per position.
  const seen = new Int32Array(size).fill(-1);
  // Each instruction, visited once per position, pushes at most two: the stack never overflows.
  const stack = new Int32Array(2 * size + 2);
  let current = new Int32Array(size);
  let next = new Int32Array(size);

  const add = (list: Int32Array, count: number, start: number, position: number): number => {
    let added = count;
    let top = 0;
    stack[top++] = start;
    while (top > 0) {
      const pc = stack[--top] ?? 0;
      if (seen[pc] === position) continue;
      seen[pc] = position;
      const instruction = instructionAt(program, pc);
      switch (instruction.op) {
        case JUMP:
          stack[top++] = instruction.x;
          break;
        case SPLIT:
          stack[top++] = instruction.y;
          stack[top++] = instruction.x;
          break;
        case START:
          if (position === 0) stack[top++] = pc + 1;
          break;
        case END:
          if (position === length) stack[top++] = pc + 1;
          break;
        default:
          list[added++] = pc;
      }
    }
    return added;
  };

  let currentCount = add(current, 0, 0, 0);
  for (let position = 0; position < length; position += 1) {
    const point = points[position] ?? 0;
    let nextCount = 0;
    for (let index = 0; index < currentCount; index += 1) {
      const pc = current[index] ?? 0;
      const instruction = instructionAt(program, pc);
      if (instruction.op === SET && inSet(instruction.ranges, instruction.negate, point)) {
        nextCount = add(next, nextCount, pc + 1, position + 1);
      }
    }
    if (nextCount === 0) return false;
    [current, next] = [next, current];
    currentCount = nextCount;
  }
  for (let index = 0; index < currentCount; index += 1) {
    if (instructionAt(program, current[index] ?? 0).op === MATCH) return true;
  }
  return false;
}
