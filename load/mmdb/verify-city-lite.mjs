// Workflow 7A's item (d) (Workflow 11D load-harness; the load method's `city-lite-verify` row):
// verifies a City MMDB in a fresh process and prints one JSON line: its bytes, the open and verify's
// wall and CPU time, the process's peak RSS, and the nodes, prefixes and distinct records. One
// process per take. A `.gz` is gunzipped first. The pinned City Lite file is fetched by
//   python3 -I scripts/fetch_data.py --manifest load/city-lite-manifest.json --dest <fresh /tmp dir>
// and deleted after the take (rule 9); nothing here writes or keeps it.
//
// From the repository root:
//   node --experimental-transform-types --no-warnings --conditions=@openverify/source \
//     --import ./packages/checks/scripts/register-ts.mjs load/mmdb/verify-city-lite.mjs <file>
import { readFileSync } from 'node:fs';
import { verifyCityMmdb } from '../../apps/api/scripts/network-benchmark.ts';

const [file] = process.argv.slice(2);
if (file === undefined) {
  process.stderr.write('usage: verify-city-lite.mjs <file.mmdb.gz | file.mmdb>\n');
  process.exit(2);
}
const timing = verifyCityMmdb(readFileSync(file), { gzipped: file.endsWith('.gz') });
process.stdout.write(`${JSON.stringify(timing)}\n`);
