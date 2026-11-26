/** json-logic-js ships no types (Stage 1a amendment 26). A dev-only oracle: see differential.test.ts. */
declare module 'json-logic-js' {
  const jsonLogic: { apply(rule: unknown, data?: unknown): unknown };
  export default jsonLogic;
}
