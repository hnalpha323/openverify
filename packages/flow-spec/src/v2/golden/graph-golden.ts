/** The content of each graph golden file (test support for C147.6 and C178.1). */
import { BASE_PROBLEMS, GRAPH_CASES, baseFlow } from './graph-cases.js';

export function graphGoldens(): [string, unknown][] {
  return [
    [
      'base',
      {
        rule: 'valid',
        description: 'The valid base every case mutates; its only problems are spec-1 warnings.',
        flow: baseFlow(),
        problems: BASE_PROBLEMS,
      },
    ],
    ...GRAPH_CASES.map((golden): [string, unknown] => [
      golden.name,
      {
        rule: golden.rule,
        description: golden.description,
        flow: golden.flow,
        ...(golden.options === undefined ? {} : { options: golden.options }),
        added: golden.added,
      },
    ]),
  ];
}
