/**
 * C123.3 (F19): the child of the code runner. It imports nothing of ours, so it loads the same way
 * from source, from `dist` and in the image: the parent passes the real paths of the QuickJS
 * packages and the contract's numbers in `argv[2]`, and this file reads the frames of
 * `src/code-runner/protocol.ts` by hand.
 *
 * It runs with `--permission`, `--allow-fs-read` on those paths alone, an empty environment and no
 * IPC channel: requests arrive on fd 3 and responses leave on fd 4, each a 4-byte big-endian length
 * and that much UTF-8 JSON. The length of a request is checked before a byte of it is buffered.
 *
 * The `.wasm` is compiled once per child and **instantiated per evaluation**, with a fresh
 * `WebAssembly.Memory` of fixed maximum, then one runtime and one context (P15). The guest gets one
 * JSON string in, parsed inside the VM, and one JSON string out, produced inside the VM and checked
 * here (C123.4). It has no host function, no module loader and no timer. The harness text below is
 * no boundary, because a guest shares its VM: every cap is applied here, on the host side, to
 * whatever comes out. Nothing here logs: stdout and stderr are closed, and a guest's words reach
 * only the frame that answers its evaluation (P18).
 */
import { readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { pathToFileURL } from 'node:url';

const REQUEST_FD = 3;
const RESPONSE_FD = 4;
const FRAME_HEADER_BYTES = 4;

/** What the parent reads when a child ends without a frame. */
const EXIT_FRAME_REFUSED = 64;
const EXIT_EVALUATION_FAILED = 65;
const EXIT_START_FAILED = 66;

const WASM_PAGE_BYTES = 65_536;
/** Where the build's imported memory starts (Emscripten's INITIAL_MEMORY, 16 MiB). */
const WASM_INITIAL_PAGES = 256;

/** Reading a failed guest's words may run its getters, so it gets a short budget of its own. */
const DESCRIBE_BUDGET_MS = 50;
/** So the words of a guest that holds its whole limit can still be read. */
const DESCRIBE_MEMORY_BYTES = 1_048_576;
/** Closer to the limit than this, even a small object may not fit. */
const MEMORY_LIMIT_SLACK_BYTES = 65_536;
const ERROR_NAME_CHARACTERS = 64;
/** The most a character takes as JSON text (`\u00XX`). */
const JSON_ESCAPE_FACTOR = 6;
/** Promise jobs run in batches, so the deadline is read between them too. */
const JOB_BATCH = 1_024;

/** The handshake's self-test: a child that cannot evaluate never says `ready`. */
const SELF_TEST = Object.freeze({
  source: 'export default function () { return 42; }',
  input: '{}',
  console: false,
  limits: Object.freeze({
    'time-ms': 2_000,
    'memory-bytes': 1_048_576,
    'wasm-maximum-bytes': 17_825_792,
    'stack-bytes': 262_144,
  }),
});

const OUT_OF_MEMORY = 'out of memory';
const STACK_OVERFLOW = 'stack overflow';
const HOST_STACK_OVERFLOW = /call stack/i;

const harnessText = (messageCharacters, lines, lineCharacters) => `(() => {
  const { parse, stringify } = JSON;
  const toText = String;
  const text = (value) => {
    if (typeof value === 'string') return value;
    try {
      const json = stringify(value);
      return json === undefined ? toText(value) : json;
    } catch {
      try { return toText(value); } catch { return ''; }
    }
  };
  const held = [];
  const capture = (...values) => {
    if (held.length >= ${String(lines)}) return;
    held[held.length] = values.map(text).join(' ').slice(0, ${String(lineCharacters)});
  };
  return {
    parse: (json) => parse(json),
    render: (value) => (value === undefined ? 'null' : stringify(value)),
    describe: (error) => {
      let name = null;
      let message = null;
      try { name = toText(error.name).slice(0, ${String(ERROR_NAME_CHARACTERS)}); } catch {}
      try {
        const words =
          error !== null && typeof error === 'object' && 'message' in error ? error.message : error;
        message = toText(words).slice(0, ${String(messageCharacters)});
      } catch {}
      return stringify({ name, message });
    },
    lines: () => stringify(held),
    installConsole: () => {
      globalThis.console = {
        log: capture,
        info: capture,
        warn: capture,
        error: capture,
        debug: capture,
      };
    },
  };
})()`;

const utf8Bytes = (text) => Buffer.byteLength(text, 'utf8');

function truncateUtf8(text, maxBytes) {
  if (utf8Bytes(text) <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    bytes += utf8Bytes(character);
    if (bytes > maxBytes) break;
    end += character.length;
  }
  return text.slice(0, end);
}

/** Whether JSON text nests at most `maxDepth` containers, read without recursion. */
function jsonDepthWithin(text, maxDepth) {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (character === '\\') index += 1;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    } else if (character === '[' || character === '{') {
      depth += 1;
      if (depth > maxDepth) return false;
    } else if (character === ']' || character === '}') {
      depth -= 1;
    }
  }
  return true;
}

/** A string out of the VM, read only when it is short enough to read. */
function boundedString(context, handle, maxCharacters) {
  if (context.typeof(handle) !== 'string') return null;
  const lengthHandle = context.getProp(handle, 'length');
  const length = context.getNumber(lengthHandle);
  lengthHandle.dispose();
  return length <= maxCharacters ? context.getString(handle) : null;
}

function parsedOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const failure = (code, message = null) => ({ kind: 'error', code, message });

/** An instance is dropped after its evaluation, so a failed dispose loses nothing. */
function disposeAll(handles, context, runtime) {
  try {
    for (const handle of handles.reverse()) if (handle.alive) handle.dispose();
    context.dispose();
    runtime.dispose();
  } catch {
    // The instance and its memory go with this call's frame.
  }
}

/** One evaluation, from a fresh memory to a disposed runtime. */
async function evaluateOnce({ core, base, compiled }, config, request) {
  const { limits } = request;
  const memory = new WebAssembly.Memory({
    initial: WASM_INITIAL_PAGES,
    maximum: Math.max(
      WASM_INITIAL_PAGES,
      Math.ceil(limits['wasm-maximum-bytes'] / WASM_PAGE_BYTES),
    ),
  });
  const variant = core.newVariant(base, {
    wasmModule: compiled,
    wasmMemory: memory,
    emscriptenModule: { print: () => undefined, printErr: () => undefined },
  });
  const quickjs = await core.newQuickJSWASMModuleFromVariant(variant);
  const runtime = quickjs.newRuntime();
  const context = runtime.newContext();
  const handles = [];
  const own = (handle) => {
    handles.push(handle);
    return handle;
  };

  let deadline = Number.POSITIVE_INFINITY;
  let timedOut = false;
  let guestRunning = true;
  runtime.setMaxStackSize(limits['stack-bytes']);

  const messageBytes = config['error-message-bytes'];
  const lineBytes = config['console-line-bytes'];
  const lineCount = config['console-lines'];
  const harness = own(
    context.unwrapResult(
      context.evalCode(harnessText(messageBytes, lineCount, lineBytes), 'harness.js'),
    ),
  );
  const harnessCall = (name, ...args) => {
    const fn = own(context.getProp(harness, name));
    return context.callFunction(fn, context.undefined, ...args);
  };

  /** After the guest: a fresh short budget and room to read what it left. */
  const guestEnded = () => {
    guestRunning = false;
    deadline = Date.now() + DESCRIBE_BUDGET_MS;
    runtime.setMemoryLimit(limits['memory-bytes'] + DESCRIBE_MEMORY_BYTES);
  };

  /** The value of a settled promise; anything but a promise is its own value. */
  const settle = (handle) => {
    let state = context.getPromiseState(handle);
    while (state.type === 'pending') {
      if (Date.now() > deadline) {
        timedOut = true;
        return { pending: true };
      }
      const jobs = runtime.executePendingJobs(JOB_BATCH);
      if (jobs.error) return { error: own(jobs.error) };
      if (jobs.value === 0) return { pending: true };
      state = context.getPromiseState(handle);
    }
    if (state.type === 'rejected') return { error: own(state.error) };
    return { value: state.notAPromise ? handle : own(state.value) };
  };

  const atMemoryLimit = () => {
    const usage = context.dump(own(runtime.computeMemoryUsage()));
    return usage.memory_used_size + MEMORY_LIMIT_SLACK_BYTES >= limits['memory-bytes'];
  };

  /** Why a guest stopped, read from its own error. */
  const failureOf = (error, fallback) => {
    const expired = timedOut;
    guestEnded();
    if (expired) return failure('timeout');
    const described = harnessCall('describe', error);
    if (described.error) {
      own(described.error);
      return failure(fallback);
    }
    const text = boundedString(
      context,
      own(described.value),
      JSON_ESCAPE_FACTOR * messageBytes * 2,
    );
    const { name = null, message = null } = (text === null ? null : parsedOrNull(text)) ?? {};
    if (name === 'InternalError' && message === OUT_OF_MEMORY) return failure('memory_limit');
    // With no room left even for the error object, QuickJS throws `null`.
    if (name === null && message === 'null' && atMemoryLimit()) return failure('memory_limit');
    if (name === 'InternalError' && message === STACK_OVERFLOW) return failure('stack_overflow');
    return failure(fallback, message === null ? null : truncateUtf8(message, messageBytes));
  };

  const unsettled = (fallback) => {
    const expired = timedOut;
    guestEnded();
    return failure(expired ? 'timeout' : fallback);
  };

  const run = () => {
    // Our own setup runs outside the guest's limits: only the guest can fail them.
    if (request.console) own(context.unwrapResult(harnessCall('installConsole')));
    runtime.setMemoryLimit(limits['memory-bytes']);
    const parsed = harnessCall('parse', own(context.newString(request.input)));
    if (parsed.error) return failureOf(own(parsed.error), 'runtime_error');
    const input = own(parsed.value);

    deadline = Date.now() + limits['time-ms'];
    runtime.setInterruptHandler(() => {
      if (Date.now() <= deadline) return false;
      if (guestRunning) timedOut = true;
      return true;
    });
    const evaluated = context.evalCode(request.source, 'guest.js', { type: 'module' });
    if (evaluated.error) return failureOf(own(evaluated.error), 'runtime_error');
    const namespace = settle(own(evaluated.value));
    if (namespace.error) return failureOf(namespace.error, 'runtime_error');
    if (namespace.pending) return unsettled('runtime_error');
    const fn = own(context.getProp(namespace.value, 'default'));
    if (context.typeof(fn) !== 'function') {
      return failure('runtime_error', 'the module has no default function');
    }

    const called = context.callFunction(fn, context.undefined, input);
    if (called.error) return failureOf(own(called.error), 'runtime_error');
    const value = settle(own(called.value));
    if (value.error) return failureOf(value.error, 'runtime_error');
    if (value.pending) return unsettled('invalid_output');

    const rendered = harnessCall('render', value.value);
    if (rendered.error) return failureOf(own(rendered.error), 'invalid_output');
    // A native call can end the guest past its deadline, between two interrupt checks.
    const expired = Date.now() > deadline;
    guestEnded();
    if (expired) return failure('timeout');
    const text = boundedString(context, own(rendered.value), config['output-bytes']);
    if (text === null || utf8Bytes(text) > config['output-bytes']) {
      return failure('invalid_output');
    }
    if (!jsonDepthWithin(text, config['output-depth'])) return failure('invalid_output');
    const output = parsedOrNull(text);
    if (output === null && text !== 'null') return failure('invalid_output');
    return { kind: 'value', value: output };
  };

  const consoleLines = () => {
    if (!request.console) return [];
    guestEnded();
    const result = harnessCall('lines');
    if (result.error) {
      own(result.error);
      return [];
    }
    const text = boundedString(
      context,
      own(result.value),
      (lineBytes * JSON_ESCAPE_FACTOR + 3) * lineCount + 2,
    );
    const lines = text === null ? null : parsedOrNull(text);
    if (!Array.isArray(lines)) return [];
    return lines
      .slice(0, lineCount)
      .filter((line) => typeof line === 'string')
      .map((line) => truncateUtf8(line, lineBytes));
  };

  let abandoned = false;
  try {
    const outcome = run();
    return { outcome, console: consoleLines() };
  } catch (error) {
    // V8's stack limit can stop QuickJS's recursion inside WebAssembly before QuickJS's own check.
    // The VM is then left in the middle of a call, so nothing of it is touched again.
    abandoned = true;
    if (error instanceof RangeError && HOST_STACK_OVERFLOW.test(error.message)) {
      return { outcome: failure('stack_overflow'), console: [] };
    }
    throw error;
  } finally {
    if (!abandoned) disposeAll(handles, context, runtime);
  }
}

/** Compiles the `.wasm` once and proves one evaluation works, for the handshake. */
export async function createEvaluator(config) {
  const core = await import(pathToFileURL(config.core).href);
  const { default: base } = await import(pathToFileURL(config.variant).href);
  const compiled = new WebAssembly.Module(readFileSync(config.wasm));
  const { name, version } = JSON.parse(readFileSync(config.manifest, 'utf8'));
  const toolkit = { core, base, compiled };
  const { outcome } = await evaluateOnce(toolkit, config, SELF_TEST);
  if (outcome.kind !== 'value' || outcome.value !== 42) {
    throw new Error('the self-test failed');
  }
  return {
    label: `${name}@${version}`,
    evaluate: (request) => evaluateOnce(toolkit, config, request),
  };
}

/** Frames off one stream. The length is checked before a byte of the payload is kept. */
function createFrameReader(maxBytes, onFrame, onViolation) {
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  let headerFilled = 0;
  let payload = null;
  let payloadFilled = 0;
  return (chunk) => {
    let offset = 0;
    while (offset < chunk.length) {
      if (payload === null) {
        const taken = Math.min(FRAME_HEADER_BYTES - headerFilled, chunk.length - offset);
        chunk.copy(header, headerFilled, offset, offset + taken);
        headerFilled += taken;
        offset += taken;
        if (headerFilled === FRAME_HEADER_BYTES) {
          const length = header.readUInt32BE(0);
          if (length === 0 || length > maxBytes) {
            onViolation();
            return;
          }
          payload = Buffer.allocUnsafe(length);
          payloadFilled = 0;
        }
      } else {
        const taken = Math.min(payload.length - payloadFilled, chunk.length - offset);
        chunk.copy(payload, payloadFilled, offset, offset + taken);
        payloadFilled += taken;
        offset += taken;
        if (payloadFilled === payload.length) {
          onFrame(payload);
          payload = null;
          headerFilled = 0;
        }
      }
    }
  };
}

const isEvaluateRequest = (request) =>
  request !== null &&
  typeof request === 'object' &&
  request.kind === 'evaluate' &&
  typeof request.id === 'string' &&
  typeof request.source === 'string' &&
  typeof request.input === 'string' &&
  typeof request.console === 'boolean' &&
  request.limits !== null &&
  typeof request.limits === 'object';

async function main() {
  const config = JSON.parse(process.argv[2]);
  const responses = new Socket({ fd: RESPONSE_FD, readable: false, writable: true });
  const requests = new Socket({ fd: REQUEST_FD, readable: true, writable: false });

  const send = (frame) => {
    const payload = Buffer.from(JSON.stringify(frame), 'utf8');
    if (payload.length > config['response-frame-bytes']) return false;
    const header = Buffer.alloc(FRAME_HEADER_BYTES);
    header.writeUInt32BE(payload.length);
    responses.write(Buffer.concat([header, payload]));
    return true;
  };

  let evaluator;
  try {
    evaluator = await createEvaluator(config);
  } catch {
    process.exit(EXIT_START_FAILED);
  }

  const answer = async (request) => {
    let answered;
    try {
      answered = await evaluator.evaluate(request);
    } catch {
      process.exit(EXIT_EVALUATION_FAILED);
    }
    for (const line of answered.console) send({ kind: 'console', id: request.id, line });
    if (!send({ ...answered.outcome, id: request.id })) {
      send({ ...failure('invalid_output'), id: request.id });
    }
  };

  let turn = Promise.resolve();
  const refuse = () => process.exit(EXIT_FRAME_REFUSED);
  const onFrame = (bytes) => {
    const request = parsedOrNull(bytes.toString('utf8'));
    if (request?.kind === 'shutdown') process.exit(0);
    if (!isEvaluateRequest(request)) refuse();
    turn = turn.then(() => answer(request));
  };
  requests.on('data', createFrameReader(config['request-frame-bytes'], onFrame, refuse));
  // The parent is gone: nobody can read an answer or kill this process.
  requests.on('close', () => process.exit(0));
  requests.on('error', () => process.exit(0));
  responses.on('error', () => process.exit(0));
  send({ kind: 'ready', protocol: config.protocol, variant: evaluator.label });
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
