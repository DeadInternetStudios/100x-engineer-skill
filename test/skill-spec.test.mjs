import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { commandNames, commandUsages } from '../lib/commands/index.mjs';
import { COMPATIBILITY, readStamp, stampProblems, stampText } from '../lib/skill-meta.mjs';
import { skillHash } from '../lib/skill-hash.mjs';
import { parseSkillFrontmatter, specFindings } from '../lib/skill-spec.mjs';
import { validateRepo } from '../lib/validate.mjs';
import { cli, ROOT, sandbox, write } from './helpers.mjs';

const skill = (front, body = '# Demo\n\nRun `100x doctor`.\n') => `---\nname: 100x-demo\ndescription: "Use when testing the spec rules."\n${front}---\n${body}`;
const rulesOf = (text, extra = {}) => {
  const box = sandbox();
  const dir = path.join(box.dir, '100x-demo');
  write(path.join(dir, 'SKILL.md'), text);
  const found = specFindings({ name: '100x-demo', text, dir, ...extra }).map((f) => f.rule);
  box.cleanup();
  return found;
};

test('the front matter parser reads a metadata block and says what a YAML loader or the spec would reject', () => {
  const good = parseSkillFrontmatter(skill('license: MIT\nmetadata:\n  author: "me"\n  version: "0.1.0"\n'));
  assert.deepEqual(good.metadata, { author: 'me', version: '0.1.0' });
  assert.equal(good.fields.license, 'MIT');
  assert.deepEqual(good.problems, []);
  assert.match(parseSkillFrontmatter(skill('metadata:\n  version: 1.0\n')).problems[0], /version is 1\.0, which YAML reads as a boolean or a number\. Put it in double quotes/);
  assert.match(parseSkillFrontmatter(skill('metadata:\n  ready: yes\n')).problems[0], /ready is yes/);
  assert.match(parseSkillFrontmatter(skill('metadata: {a: b}\n')).problems[0], /metadata must be a block of key: value lines/);
  assert.match(parseSkillFrontmatter(skill('license: MIT\nlicense: Apache-2.0\n')).problems[0], /license is given twice/);
  assert.match(parseSkillFrontmatter(skill('compatibility: needs: node\n')).problems[0], /a plain compatibility cannot hold a colon and a space/);
  assert.match(parseSkillFrontmatter(skill('license: MIT\n  and more\n')).problems[0], /license runs over more than one line/);
  assert.equal(parseSkillFrontmatter('# no front matter\n'), null);
});

test('the name must be what the spec says: lowercase, digits and single hyphens, up to 64 characters, and the folder name', () => {
  const named = (name) => rulesOf(skill('').replace('name: 100x-demo', `name: ${name}`));
  assert.deepEqual(named('100x-demo'), []);
  for (const bad of ['Demo', '-demo', 'demo-', 'de--mo', 'de_mo', 'de mo', 'x'.repeat(65)]) assert.ok(named(bad).includes('spec-name'), `${bad} fails`);
  assert.ok(named('other').includes('name-matches-folder'));
  assert.ok(rulesOf(skill('').replace('name: 100x-demo\n', '')).includes('spec-name'), 'a missing name fails');
});

test('license, compatibility, metadata and allowed-tools follow the spec, and no other key is allowed', () => {
  assert.deepEqual(rulesOf(skill('license: MIT\ncompatibility: "Needs git."\nmetadata:\n  author: "me"\nallowed-tools: Read Grep\n')), []);
  assert.ok(rulesOf(skill('license: ""\n')).includes('spec-license'));
  assert.ok(rulesOf(skill(`compatibility: "${'x'.repeat(501)}"\n`)).includes('spec-compatibility'));
  assert.ok(rulesOf(skill('compatibility: ""\n')).includes('spec-compatibility'));
  assert.ok(rulesOf(skill('allowed-tools: Read, Grep\n')).includes('spec-allowed-tools'));
  assert.ok(rulesOf(skill('allowed-tools: [Read, Grep]\n')).includes('frontmatter-yaml'));
  assert.ok(rulesOf(skill('metadata:\n')).includes('spec-metadata'));
  assert.ok(rulesOf(skill('metadata:\n  version: 2\n')).includes('frontmatter-yaml'));
  assert.ok(rulesOf(skill('argument-hint: "[brief]"\n')).includes('frontmatter-key'), 'argument-hint is not a spec field, and metadata is where such a thing goes');
});

test('a body over 5000 tokens fails, and so does a file over 500 lines', () => {
  assert.ok(rulesOf(skill('', `${'word '.repeat(4200)}\n`)).includes('spec-body-tokens'));
  assert.deepEqual(rulesOf(skill('', `${'word '.repeat(3000)}\n`)), []);
  assert.ok(rulesOf(skill('', `${'a\n'.repeat(501)}`)).includes('spec-body-lines'));
});

test('a skill that names a file in a sibling skill fails, and a shell path that only starts with ../ does not', () => {
  const body = (line) => `# Demo\n\n${line}\n`;
  const siblings = ['100x-demo', '100x-other', '100x'];
  assert.ok(rulesOf(skill('', body('Read ../100x/references/words.md first.')), { siblings }).includes('spec-escape'));
  assert.ok(rulesOf(skill('', body('Follow ../100x-other/SKILL.md.')), { siblings }).includes('spec-escape'));
  assert.ok(rulesOf(skill('', body('Read ../100x-other/notes.txt.')), { siblings }).includes('spec-escape'), 'any file of a sibling skill, not only the usual ones');
  assert.deepEqual(rulesOf(skill('', body('Run `git worktree add --detach ../wrapup-check`.')), { siblings }), []);
  assert.deepEqual(rulesOf(skill('', body('Follow the `100x-other` skill, and print the guide with `100x ref words`.')), { siblings }), []);
});

test('every bundled reference is named in SKILL.md itself, one hop away, and a script is named somewhere', () => {
  const box = sandbox();
  const root = path.join(box.dir, 'repo');
  const dir = path.join(root, 'skills', '100x-demo');
  write(path.join(dir, 'SKILL.md'), skill('', '# Demo\n\nRead references/a.md. Run `node assets/check.mjs`.\n'));
  write(path.join(dir, 'references', 'a.md'), '# A\n\nThen read references/b.md.\n');
  write(path.join(dir, 'references', 'b.md'), '# B\n');
  write(path.join(dir, 'assets', 'check.mjs'), '// check\n');
  write(path.join(dir, 'assets', 'unused.mjs'), '// unused\n');
  const found = validateRepo(root, { commands: commandNames, usages: commandUsages }).map((f) => `${f.rule} ${f.file}`);
  assert.deepEqual(found, ['reference-depth skills/100x-demo/references/b.md', 'reference-orphan skills/100x-demo/assets/unused.mjs']);
  box.cleanup();
});

test('the stamp comes from package.json, is written once, and a skill that disagrees with it fails the validator', () => {
  const box = sandbox();
  const root = path.join(box.dir, 'repo');
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'x', version: '2.0.1', license: 'MIT', repository: { type: 'git', url: 'git+https://github.com/Acme/tools.git' } }));
  write(path.join(root, 'skills', '100x-demo', 'SKILL.md'), skill('', '# Demo\n'));
  write(path.join(root, 'skills', '100x-demo', 'references', 'a.md'), '# A\n');
  const stamp = readStamp(root);
  assert.deepEqual(stamp.metadata, { author: 'Acme', version: '2.0.1', repository: 'https://github.com/Acme/tools' });
  const found = validateRepo(root, { commands: commandNames, usages: commandUsages }).filter((f) => f.rule === 'skill-stamp').map((f) => f.message);
  assert.equal(found.length, 5, 'license, compatibility and the three metadata keys are each named');
  const file = path.join(root, 'skills', '100x-demo', 'SKILL.md');
  const stamped = stampText(fs.readFileSync(file, 'utf8'), stamp);
  assert.equal(stampText(stamped, stamp), stamped, 'stamping twice changes nothing');
  assert.deepEqual(stampProblems(stamped, stamp), []);
  assert.ok(parseSkillFrontmatter(stamped).problems.length === 0 && stamped.startsWith('---\nname: 100x-demo\ndescription:'), 'the name and description stay first and untouched');
  fs.writeFileSync(file, stamped.replace('"2.0.1"', '"1.0.0"'));
  assert.match(validateRepo(root, { commands: commandNames, usages: commandUsages }).find((f) => f.rule === 'skill-stamp').message, /metadata version is "1\.0\.0", it should be "2\.0\.1"\. Run `node scripts\/stamp-skills\.mjs`/);
  box.cleanup();
});

test('the skills of this repo carry the stamp, fit the spec, and say what they need in 500 characters', () => {
  assert.ok(COMPATIBILITY.length <= 500);
  assert.deepEqual(validateRepo(ROOT, { commands: commandNames, usages: commandUsages }).filter((f) => /^(spec-|skill-stamp|frontmatter|reference-depth)/.test(f.rule)), []);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const slug = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository.url)[1];
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes(`npx skills add ${slug}`), 'the README install line names the repository package.json names');
  assert.ok(readme.includes(`badgen.net/github/stars/${slug}`), 'the stars badge names it too');
});

test('the content hash is the one the skills CLI writes as skillFolderHash to ~/.agents/.skill-lock.json (computedHash in a project skills-lock.json), for text with CRLF, binary files and a path with accents', () => {
  const box = sandbox();
  const dir = path.join(box.dir, 'demo-skill');
  write(path.join(dir, 'SKILL.md'), '---\nname: demo-skill\ndescription: "Use when testing the hash."\n---\n# Demo\n\nSee references/b.md.\n');
  write(path.join(dir, 'references', 'b.md'), 'line one\r\nline two\r\n');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'data.bin'), Buffer.from([0, 1, 255, 254, 13, 10, 128]));
  write(path.join(dir, 'übung', 'ä.md'), 'ä\n');
  write(path.join(dir, 'metadata.json'), '{"x":1}');
  write(path.join(dir, '__pycache__', 'x.pyc'), 'junk');
  // Written by `npx skills@1.9.0 add <folder> --skill demo-skill` for this exact folder.
  assert.equal(skillHash(dir), 'e9d0bd5f76e82dff875e4318541c018bacff306dadd688cc638c51d054760d79');
  box.cleanup();
});

test('ref prints a shared reference by name, lists them with no name, and refuses a path', () => {
  const list = cli(['ref']);
  assert.equal(list.code, 0, list.err);
  for (const name of ['apps', 'words', 'finish', 'looks', 'watchdog', 'unattended', 'fill']) assert.match(list.out, new RegExp(`^${name}\\s{2,}\\S`, 'm'));
  const apps = cli(['ref', 'apps']);
  assert.equal(apps.out, fs.readFileSync(path.join(ROOT, 'skills', '100x', 'references', 'apps.md'), 'utf8'));
  for (const bad of ['../SKILL', 'nope', 'apps.md', 'apps words']) {
    const refused = cli(['ref', ...bad.split(' ')]);
    assert.equal(refused.code, 1, bad);
    assert.match(refused.err, /No reference called/);
  }
  const named = new Set(fs.readdirSync(path.join(ROOT, 'skills')).flatMap((dir) => [...fs.readFileSync(path.join(ROOT, 'skills', dir, 'SKILL.md'), 'utf8').matchAll(/`100x ref ([a-z-]+)`/g)].map((m) => m[1])));
  for (const name of named) assert.equal(cli(['ref', name]).code, 0, `${name} is a reference that exists`);
});

test('a symlink that loops back to a folder above it is left out of the hash instead of crashing it, and a tab in front matter indentation is a problem', () => {
  const box = sandbox();
  const skill = path.join(box.dir, 'looping');
  write(path.join(skill, 'SKILL.md'), '---\nname: looping\ndescription: Use for a loop. Do it.\n---\nBody.\n');
  const plain = skillHash(skill);
  fs.symlinkSync('.', path.join(skill, 'self'));
  assert.equal(skillHash(skill), plain, 'the loop adds no file');
  const tabbed = parseSkillFrontmatter('---\nname: a\ndescription: Use it.\nmetadata:\n\tauthor: "me"\n---\n');
  assert.ok(tabbed.problems.some((problem) => /tab characters must not be used in indentation/.test(problem)), tabbed.problems.join('; '));
  box.cleanup();
});

// The specification's own validator, `skills-ref`, on every skill folder. It needs the network the first time, so the fast lane leaves it out and an offline run
// says so instead of failing. Any other failure is a real one.
test('every skill passes the specification\'s own validator, skills-ref', { skip: process.env.X100_FAST ? 'the fast lane leaves out the network check' : false }, (t) => {
  const skillsRoot = path.join(ROOT, 'skills');
  for (const name of fs.readdirSync(skillsRoot).sort()) {
    const run = spawnSync('npx', ['-y', 'skills-ref', 'validate', path.join(skillsRoot, name)], { encoding: 'utf8', timeout: 120000 });
    const out = `${run.stdout}${run.stderr}`;
    if (run.status !== 0 && /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network/i.test(out)) return t.skip('skills-ref could not be fetched, the network is down');
    assert.equal(run.status, 0, `${name}: ${out}`);
    assert.match(out, /Valid skill/, name);
  }
});
