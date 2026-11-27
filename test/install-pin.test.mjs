import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { listFiles, PLUGIN_DIR } from '../lib/claude-plugin.mjs';
import { PINS } from '../lib/pins.mjs';
import { ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { version } = JSON.parse(read('package.json'));
const FILE = `100x-engineer-skill-${version}.tgz`;
const URL = `https://github.com/DeadInternetStudios/100x-engineer-skill/releases/download/v${version}/${FILE}`;
const PLUGIN_README = `${PLUGIN_DIR}/README.md`;
const INSTALL_PAGE = 'docs/install.md';
const SHA256 = /\b[0-9a-f]{64}\b/g;
const checksums = (rel) => [...new Set(read(rel).match(SHA256) ?? [])];

test('the install step in the plugin README names the release by version and checks one SHA-256 before npm runs it', () => {
  const readme = read(PLUGIN_README);
  const lines = readme.split('\n');
  const download = lines.findIndex((line) => line.includes(URL));
  assert.ok(download >= 0, `the README downloads ${URL}`);
  const check = lines.find((line) => line.includes(FILE) && line.includes('shasum -a 256 -c -'));
  assert.ok(check, 'the README checks the file with shasum');
  assert.match(check, /^\s*echo "[0-9a-f]{64} {2}/, 'the checksum is in the step, not behind a link');
  const install = lines.find((line) => line.includes('npm install -g') && line.includes(FILE));
  assert.ok(install, 'npm installs the file that was checked');
  assert.ok(lines.indexOf(check) > download && lines.indexOf(install) > lines.indexOf(check), 'download, then check, then install');
  for (const line of [lines[download], check, install]) assert.ok(line.trimEnd().endsWith('&&'), `a failed step stops the chain: ${line.trim().slice(0, 40)}`);
});

test('the plugin README and the install page carry the same checksum, in the shape of SHA-256', () => {
  const plugin = checksums(PLUGIN_README);
  const page = checksums(INSTALL_PAGE);
  assert.equal(plugin.length, 1, 'the plugin README holds one checksum');
  assert.deepEqual(page, plugin, 'the install page holds the same one');
  assert.equal(read(INSTALL_PAGE).split(plugin[0]).length - 1, 3, 'the page lists it once, then uses it in the shell command and in the PowerShell command');
});

test('the root README cannot hold the checksum of a tarball it is packed into, so it sends the reader to the install page', () => {
  const readme = read('README.md');
  assert.deepEqual(readme.match(SHA256) ?? [], [], 'no 64-hex string in the packed README');
  assert.ok(readme.includes(URL), 'it downloads the pinned release');
  assert.ok(readme.includes(`shasum -a 256 ${FILE}`), 'it prints the checksum for the reader to compare');
  assert.ok(readme.includes('docs/install.md#install-a-pinned-release'), 'it links to the page that has the checksum');
  assert.match(read(INSTALL_PAGE), /^### Install a pinned release$/m, 'and that link lands on a heading');
});

test('no step in the plugin folder or the install docs installs code from a branch, a bare name or a latest tag', () => {
  const under = (dir) => listFiles(path.join(ROOT, dir)).map((rel) => `${dir}/${rel}`);
  const files = [...under(PLUGIN_DIR), ...under('skills'), 'README.md', INSTALL_PAGE];
  for (const rel of files.filter((file) => file.endsWith('.md'))) {
    const text = read(rel);
    assert.doesNotMatch(text, /npm (install|i|add) [^\n]*github:/, `${rel} installs from a branch`);
    assert.doesNotMatch(text, /@latest\b/, `${rel} installs a latest tag`);
    assert.doesNotMatch(text, /\|\s*(ba)?sh\b/, `${rel} pipes a download into a shell`);
    if (rel.startsWith(PLUGIN_DIR)) assert.doesNotMatch(text, /\bnpx\s/, `${rel} runs a package that is not pinned`);
  }
});

test('the docs name the same versions of Playwright and the Cursor SDK that the tool pins', () => {
  for (const rel of [PLUGIN_README, INSTALL_PAGE]) {
    const text = read(rel);
    assert.ok(text.includes(`Playwright ${PINS.playwright.version}`), `${rel} names Playwright ${PINS.playwright.version}`);
    assert.ok(text.includes(`@cursor/sdk\` ${PINS['@cursor/sdk'].version}`), `${rel} names @cursor/sdk ${PINS['@cursor/sdk'].version}`);
  }
});
