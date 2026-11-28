import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromiumBuilds, resolvePlaywright } from '../lib/playwright.mjs';
import { PINS } from '../lib/pins.mjs';
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
function fakeInstallers(box, { exit = 0, hash = {} } = {}) {
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
fs.writeFileSync(${JSON.stringify(path.join(box.dir, 'npm-args.json'))}, JSON.stringify(args));
// Like npm, write each package named name@version into node_modules, and the hidden record of its version and integrity hash.
const pins = ${JSON.stringify(PINS)};
const hash = ${JSON.stringify(hash)};
const packages = {};
for (const arg of args.filter((a) => /^@?[a-z][a-z0-9/-]*@\\d/.test(a))) {
  const name = arg.slice(0, arg.lastIndexOf('@'));
  const folder = path.join(prefix, 'node_modules', ...name.split('/'));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, version: arg.slice(arg.lastIndexOf('@') + 1) }));
  packages['node_modules/' + name] = { version: arg.slice(arg.lastIndexOf('@') + 1), integrity: hash[name] ?? pins[name]?.integrity };
}
fs.mkdirSync(path.join(prefix, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(prefix, 'node_modules', '.package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
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
  assert.match(result.out, new RegExp(`Installing Playwright ${PINS.playwright.version} into .*\\.100x\\.`));
  assert.match(result.out, new RegExp(`Installing the Chromium build that Playwright ${PINS.playwright.version} names\\.`));
  assert.match(result.out, /installed Playwright and Chromium into/);
  assert.ok(fs.existsSync(path.join(box.home, '.100x', 'node_modules', '.bin', 'playwright')));
  box.cleanup();
});

test('browsers asks npm for the pinned version of Playwright and its core, never for latest', () => {
  const box = sandbox();
  const result = cli(['browsers'], { cwd: box.project, env: fakeInstallers(box) });
  assert.equal(result.code, 0, result.err);
  const args = JSON.parse(fs.readFileSync(path.join(box.dir, 'npm-args.json'), 'utf8'));
  assert.ok(args.includes(`playwright@${PINS.playwright.version}`) && args.includes(`playwright-core@${PINS['playwright-core'].version}`), args.join(' '));
  assert.ok(args.includes('--save-exact'));
  assert.ok(args.includes('--ignore-scripts'), 'no package script runs before the hash is checked');
  assert.ok(!args.includes('playwright'), 'a bare package name would take whatever is newest');
  box.cleanup();
});

test('a Playwright whose hash is not the pinned one is removed, and Chromium is never downloaded', () => {
  const box = sandbox();
  const result = cli(['browsers'], { cwd: box.project, env: fakeInstallers(box, { hash: { playwright: `sha512-${'A'.repeat(86)}==` } }) });
  assert.equal(result.code, 1);
  assert.match(result.err, /playwright does not match what 100x pins/);
  assert.doesNotMatch(result.out, /Installing the Chromium build/, 'no download after a mismatch');
  assert.ok(!fs.existsSync(path.join(box.home, '.100x', 'node_modules', 'playwright')), 'the package that did not match is gone');
  box.cleanup();
});

test('helper setup asks npm for the pinned SDK version, checks its hash, and says so', () => {
  const box = sandbox();
  const result = cli(['helper', 'setup'], { cwd: box.project, env: { ...fakeInstallers(box), X100_CURSOR_SDK_FROM: '' } });
  assert.equal(result.code, 0, result.err);
  const args = JSON.parse(fs.readFileSync(path.join(box.dir, 'npm-args.json'), 'utf8'));
  assert.ok(args.includes(`@cursor/sdk@${PINS['@cursor/sdk'].version}`) && args.includes('--save-exact'), args.join(' '));
  assert.ok(args.includes('--ignore-scripts'), 'no package script runs before the hash is checked');
  assert.match(result.out, /its hash matches the one pinned in 100x/);
  box.cleanup();
});

test('an SDK whose hash is not the pinned one is removed, and setup does not call it installed', () => {
  const box = sandbox();
  const result = cli(['helper', 'setup'], { cwd: box.project, env: { ...fakeInstallers(box, { hash: { '@cursor/sdk': `sha512-${'C'.repeat(86)}==` } }), X100_CURSOR_SDK_FROM: '' } });
  assert.equal(result.code, 1);
  assert.match(result.err, /@cursor\/sdk does not match what 100x pins/);
  assert.doesNotMatch(result.out, /installed @cursor\/sdk/);
  assert.ok(!fs.existsSync(path.join(box.home, '.100x', 'node_modules', '@cursor', 'sdk')));
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
