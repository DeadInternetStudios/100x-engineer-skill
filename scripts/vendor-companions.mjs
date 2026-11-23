#!/usr/bin/env node
// Copy the skill folder of unslop-text into vendor/ and pin the commit it came from.
//   node scripts/vendor-companions.mjs                      from the checkout next to this repository
//   node scripts/vendor-companions.mjs --text ~/code/unslop-text
//   node scripts/vendor-companions.mjs --check              say whether vendor/ still matches companions.json
// A checkout with uncommitted changes in its skill folder is refused, so a pin always names real code. --allow-dirty overrides.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkVendored, COMPANIONS, vendorCompanion } from '../lib/companions.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';

const USAGE = 'node scripts/vendor-companions.mjs [--text <checkout>] [--allow-dirty] [--check]';
let values;
try {
  ({ values } = parseArgs({ options: { text: { type: 'string' }, check: { type: 'boolean' }, 'allow-dirty': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } }));
} catch (error) {
  console.error(`vendor-companions: ${error.message}\n${USAGE}`);
  process.exit(2);
}

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

if (values.check) {
  const results = checkVendored();
  for (const r of results) console.log(r.ok ? `ok   ${r.name} ${r.version ?? ''} at ${r.commit}` : `FAIL ${r.problem}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

const sources = { 'unslop-text': values.text };
for (const name of Object.keys(COMPANIONS)) {
  const checkout = path.resolve(sources[name] ?? path.join(REPO_ROOT, '..', name));
  try {
    const pin = vendorCompanion(name, checkout, { allowDirty: values['allow-dirty'] });
    console.log(`vendored ${name} ${pin.version ?? ''} at ${pin.commit.slice(0, 7)} from ${checkout}`);
  } catch (error) {
    console.error(`${name}. ${error.message}`);
    process.exitCode = 1;
  }
}
