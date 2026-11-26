/** The Evaluate Code runner (C123): `contracts-8a` freezes the protocol, `code-sandbox` builds it. */
export * from './protocol.js';
export * from './runner.js';
export * from './transport.js';
export * from './runner-token.js';
export { serveCodeRunner } from './socket-server.js';
export type { CodeRunnerServer, CodeRunnerServerOptions } from './socket-server.js';

/** This folder's area. */
export const CODE_RUNNER_AREA = 'code-runner';
