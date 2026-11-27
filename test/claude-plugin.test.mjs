import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { HAND_WRITTEN, ICON, LIMITS, listFiles, PLUGIN_DIR, pluginProblems } from '../lib/claude-plugin.mjs';
import { ROOT } from './helpers.mjs';

// These are the checks of https://claude.com/docs/plugins/pre-submission-checklist that `claude plugin validate` does not run, so a change here cannot
// leave the directory's validation to find it after a push.
const dir = path.join(ROOT, PLUGIN_DIR);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
const files = listFiles(dir);
const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');

const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const TEXT = new Set(['.md', '.mjs', '.js', '.json', '.txt', '.tsv', '.sh', '.yml', '.yaml', '.html', '.css', '.svg']);

test('plugins/100x is what the build writes from package.json, skills/, LICENSE and NOTICE.md', () => {
  assert.deepEqual(pluginProblems(ROOT), [], 'run `node scripts/build-claude-plugin.mjs` and commit the result');
});

test('the manifest carries the name, version, license and author the directory reads', () => {
  assert.match(manifest.name, /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/);
  assert.equal(manifest.version, pkg.version, 'raise the version with package.json on every release');
  assert.equal(manifest.license, pkg.license);
  assert.ok(manifest.description && manifest.author?.name);
  for (const key of ['hooks', 'mcpServers', 'commands', 'agents']) assert.ok(!(key in manifest), `the README says the plugin has no ${key}`);
});

test('the plugin folder holds only what the directory accepts without a reviewer', () => {
  assert.ok(files.length <= LIMITS.maxFiles, `${files.length} files, at most ${LIMITS.maxFiles}`);
  for (const rel of files) {
    const file = path.join(dir, rel);
    const ext = path.extname(rel).toLowerCase();
    assert.ok(!fs.lstatSync(file).isSymbolicLink(), `${rel} is a symbolic link`);
    assert.ok(!/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)/.test(rel), `${rel} is a system file`);
    assert.ok(IMAGES.has(ext) || TEXT.has(ext) || ['LICENSE'].includes(rel), `${rel} is not a text file or an image`);
    if (!IMAGES.has(ext)) assert.ok(fs.statSync(file).size < LIMITS.maxTextBytes, `${rel} is ${LIMITS.maxTextBytes} bytes or more`);
  }
  for (const folder of ['bin', 'hooks', 'commands', 'agents']) assert.ok(!fs.existsSync(path.join(dir, folder)), `${folder}/ stays out: a top-level bin/ stops claude.ai and Cowork from installing the plugin`);
  assert.ok(!fs.existsSync(path.join(dir, '.mcp.json')));
});

test('the icon is a square PNG of 512 to 2048 pixels under 2 MB, which the directory takes once, at the first submission', () => {
  assert.equal(manifest.icon, `./${ICON}`);
  const bytes = fs.readFileSync(path.join(dir, ICON));
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  assert.equal(width, height);
  assert.ok(width >= 512 && width <= 2048, `${width} px`);
  assert.ok(bytes.length < 2 * 1024 * 1024);
});

test('the README has at least 40 words outside code blocks, and the license is there', () => {
  const words = readme.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
  assert.ok(words >= LIMITS.minReadmeWords, `${words} words`);
  assert.ok(files.includes('LICENSE'));
  assert.equal(HAND_WRITTEN.every((rel) => files.includes(rel)), true);
});

test('the README names every way the skills leave the machine or change a permission', () => {
  const skills = files.filter((rel) => rel.startsWith('skills/') && rel.endsWith('.md')).map((rel) => fs.readFileSync(path.join(dir, rel), 'utf8')).join('\n');
  const mustSay = [
    [/bypassPermissions/, 'bypassPermissions'],
    [/@cursor\/sdk/, '@cursor/sdk'],
    [/100x browsers/, '100x browsers'],
    [/deploy\.preview|preview URL/, 'preview'],
    [/Never push to a remote/, 'never pushes to a remote'],
  ];
  for (const [inSkills, inReadme] of mustSay) if (inSkills.test(skills)) assert.ok(readme.includes(inReadme), `the skills say ${inSkills}, so the README must say "${inReadme}"`);
});

test('.gitattributes stays free of what makes the directory refuse to read the repository', () => {
  const text = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8').replace(/#.*$/gm, '');
  assert.ok(!/export-ignore|export-subst|\bfilter=/.test(text));
});
