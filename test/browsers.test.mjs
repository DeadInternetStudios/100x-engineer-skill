import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromiumBuilds, resolvePlaywright } from '../lib/playwright.mjs';
import { cli, sandbox } from './helpers.mjs';
import { fakeBin } from './helpers.mjs';

test('browsers --check reports missing when nothing provides Playwright', () => {
  const box = sandbox();
  const result = cli(['browsers', '--check'], { cwd: box.project, env: { ...box.env, X100_PLAYWRIGHT_FROM: '' } });
  assert.equal(result.code, 1);
  assert.match(result.out, /not available/);
  box.cleanup();
});

test('browsers --check reports available when Playwright resolves', { skip: resolvePlaywright() && chromiumBuilds().length ? false : 'Playwright and a Chromium build are not both here. Run `100x browsers`.' }, () => {
  const box = sandbox();
  const result = cli(['browsers', '--check'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /already available/);
  box.cleanup();
});

// A stand-in npm that writes a stand-in playwright, which prints a progress line for each 5 percent like the real one does.
function fakeInstallers(box, { exit = 0 } = {}) {
  const bin = path.join(box.dir, 'fake-bin');
  // The stand-in npm writes the stand-in playwright, with a launcher for each shell, as the real one writes .bin entries.
  const playwright = `let i = 0;
while (i < 20) { console.log(\`|progress| \${i * 5}% of 160 MiB\`); i += 1; }
console.error('disk is full');
process.exit(${exit});
`;
  fakeBin(bin, 'npm', `import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const prefix = args[args.indexOf('--prefix') + 1];
const dir = path.join(prefix, 'node_modules', '.bin');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'playwright.mjs'), ${JSON.stringify(playwright)});
fs.writeFileSync(path.join(dir, 'playwright'), '#!/bin/sh\\nexec ' + JSON.stringify(process.execPath) + ' "$(dirname "$0")/playwright.mjs" "$@"\\n', { mode: 0o755 });
fs.writeFileSync(path.join(dir, 'playwright.cmd'), '@echo off\\r\\n"' + process.execPath + '" "%~dp0playwright.mjs" %*\\r\\n');
`);
  return { ...box.env, X100_PLAYWRIGHT_FROM: '', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

test('browsers installs without printing a progress line for every ten percent', () => {
  const box = sandbox();
  const result = cli(['browsers'], { cwd: box.project, env: fakeInstallers(box) });
  assert.equal(result.code, 0, result.err);
  assert.doesNotMatch(result.out, /progress/);
  assert.match(result.out, /Installing Playwright into .*\.100x\./);
  assert.match(result.out, /Installing Chromium\./);
  assert.match(result.out, /installed Playwright and Chromium into/);
  assert.ok(fs.existsSync(path.join(box.home, '.100x', 'node_modules', '.bin', 'playwright')));
  box.cleanup();
});

test('a failed install shows the end of what the installer said', () => {
  const box = sandbox();
  const result = cli(['browsers'], { cwd: box.project, env: fakeInstallers(box, { exit: 3 }) });
  assert.equal(result.code, 1);
  assert.match(result.err, /Installing Chromium failed with exit code 3\./);
  assert.match(result.err, /disk is full/);
  assert.match(result.err, /95% of 160 MiB/);
  assert.doesNotMatch(result.err, /\|progress\| 0% of/, 'only the last lines are shown');
  box.cleanup();
});
