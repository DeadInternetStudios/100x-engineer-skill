#!/usr/bin/env node
// Writes plugins/100x, the folder submitted to Anthropic's plugin directory, from package.json, skills/, LICENSE and NOTICE.md. Run it after any change to
// those, and commit the result. plugins/100x/README.md and plugins/100x/assets/icon.png are written by hand.
//   node scripts/build-claude-plugin.mjs           write the folder
//   node scripts/build-claude-plugin.mjs --check   say whether the folder is current, and exit 1 when it is not
import { buildPlugin, pluginProblems } from '../lib/claude-plugin.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';

const args = process.argv.slice(2);
if (args.some((a) => a !== '--check')) {
  console.error('usage: node scripts/build-claude-plugin.mjs [--check]');
  process.exit(2);
}

if (args.includes('--check')) {
  const problems = pluginProblems(REPO_ROOT);
  for (const problem of problems) console.error(`plugins/100x: ${problem}`);
  if (problems.length) {
    console.error('Run `node scripts/build-claude-plugin.mjs` and commit the result.');
    process.exit(1);
  }
  console.log('plugins/100x is current');
} else {
  const { written, removed } = buildPlugin(REPO_ROOT);
  console.log(written || removed ? `plugins/100x: wrote ${written}, removed ${removed}` : 'plugins/100x is current');
}
