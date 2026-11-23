import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { commandNames, commandUsages } from '../lib/commands/index.mjs';
import { companionScript } from '../lib/companions.mjs';
import { GRIND_LIMIT, GRIND_STALL, grindWords } from '../lib/rounds.mjs';
import { validateRepo } from '../lib/validate.mjs';
import { cli, ROOT, sandbox, write } from './helpers.mjs';

const GOOD = `---
name: 100x-demo
description: Demo stage. Use when testing the validator with a sample skill.
---
# Demo

Read references/a.md before starting. Run \`100x doctor\` to check the install.
`;

function repo(box, overrides = {}) {
  const root = path.join(box.dir, 'repo');
  write(path.join(root, 'skills', '100x-demo', 'SKILL.md'), overrides.skill ?? GOOD);
  write(path.join(root, 'skills', '100x-demo', 'references', 'a.md'), overrides.reference ?? '# A\n\nBody.\n');
  for (const [file, text] of Object.entries(overrides.extra ?? {})) write(path.join(root, file), text);
  return root;
}

const rules = (root) => validateRepo(root, { commands: commandNames, usages: commandUsages }).map((f) => f.rule);

test('the command lists in the docs must match the CLI, and the real docs do', () => {
  const box = sandbox();
  const all = commandNames.join('|');
  const table = (names) => `## The CLI\n\n| Command | Does |\n|---|---|\n${names.map((name) => `| \`${name}\` | does it. |`).join('\n')}\n\n## Credits\n`;
  const ok = repo(box, { extra: { 'docs/design.md': `The commands are \`100x ${all}\`.\n`, 'README.md': table(commandNames) } });
  assert.deepEqual(rules(ok), []);
  const stale = repo(sandbox(), { extra: { 'docs/design.md': `The commands are \`100x ${commandNames.filter((name) => name !== 'install' && name !== 'run').join('|')}|retired\`.\n`, 'README.md': table(commandNames.filter((name) => name !== 'port')) } });
  const findings = validateRepo(stale, { commands: commandNames, usages: commandUsages }).filter((f) => f.rule === 'command-list');
  assert.equal(findings.length, 2);
  assert.match(findings[0].message, /the command list is out of date with the CLI\. Missing install, run\. Not commands retired/);
  assert.match(findings[1].message, /the CLI table is out of date with the CLI\. Missing port/);
  assert.equal(validateRepo(ROOT, { commands: commandNames, usages: commandUsages }).filter((f) => f.rule === 'command-list').length, 0);
});

test('a clean skill passes', () => {
  const box = sandbox();
  assert.deepEqual(rules(repo(box)), []);
  box.cleanup();
});

test('a name that does not match its folder fails', () => {
  const box = sandbox();
  assert.deepEqual(rules(repo(box, { skill: GOOD.replace('name: 100x-demo', 'name: other') })), ['name-matches-folder']);
  box.cleanup();
});

test('a description without trigger words fails', () => {
  const box = sandbox();
  assert.ok(rules(repo(box, { skill: GOOD.replace('Use when testing', 'Handy for testing') })).includes('description-trigger'));
  box.cleanup();
});

test('an overlong description fails', () => {
  const box = sandbox();
  assert.ok(rules(repo(box, { skill: GOOD.replace('sample skill.', `${'x'.repeat(1100)}.`) })).includes('description-length'));
  box.cleanup();
});

test('a description that a YAML parser would reject fails, a quoted one passes', () => {
  const box = sandbox();
  const plain = 'description: Demo stage. Use when testing the validator with a sample skill.';
  assert.deepEqual(rules(repo(box, { skill: GOOD })), []);
  for (const bad of ['description: Demo stage. Use when you pick the mode: mockup or report.', 'description: Demo stage. Use when testing #1 of the validator.', 'description: [Demo] Use when testing the validator.', 'description: "Demo stage. Use when a "quoted" word is in it."', "description: 'Demo stage. Use when it's wrong.'"]) {
    assert.ok(rules(repo(sandbox(), { skill: GOOD.replace(plain, bad) })).includes('frontmatter-yaml'), bad);
  }
  for (const good of ['description: "Demo stage. Use when you pick the mode: mockup or report."', "description: 'Demo stage. Use when it''s fine: really.'", 'description: "Demo stage. Use when a \\"quoted\\" word is in it."']) {
    assert.deepEqual(rules(repo(sandbox(), { skill: GOOD.replace(plain, good) })), [], good);
  }
  box.cleanup();
});

test('a modes folder fails because a mode is a skill of its own, and a skill names another skill by its name, never by a path', () => {
  const OTHER = '---\nname: 100x-other\ndescription: Other mode. Use when testing a pointer between skills.\n---\n# Other\n';
  assert.ok(rules(repo(sandbox(), { extra: { 'skills/100x-demo/modes/lonely.md': '# Lonely\n' } })).includes('modes-folder'));
  assert.deepEqual(rules(repo(sandbox(), { skill: `${GOOD}\nThe other mode is the \`100x-other\` skill.\n`, extra: { 'skills/100x-other/SKILL.md': OTHER } })), []);
  assert.deepEqual(rules(repo(sandbox(), { skill: `${GOOD}\nThe other mode is ../100x-other/SKILL.md.\n`, extra: { 'skills/100x-other/SKILL.md': OTHER } })), ['spec-escape'], 'a path into a sibling skill fails even when the file is there, because a skill installed alone has no sibling');
  assert.ok(rules(repo(sandbox(), { skill: `${GOOD}\nThe other mode is ../100x-ghost/SKILL.md.\n` })).includes('spec-escape'), 'so does a path to a skill that is not there');
  assert.ok(rules(repo(sandbox(), { skill: `${GOOD}\nThe other mode is the \`100x-ghost\` skill.\n` })).includes('skill-unknown'), 'a skill named by its name has to exist');
  assert.ok(rules(repo(sandbox(), { skill: `${GOOD}\nThe status mode is modes/status.md.\n` })).includes('reference-missing'), 'the old home of the modes is not a place to point at');
  const shared = { 'skills/100x-other/SKILL.md': `${OTHER}\nIts guide is references/b.md.\n`, 'skills/100x-other/references/b.md': '# B\n' };
  assert.deepEqual(rules(repo(sandbox(), { skill: `${GOOD}\nThe shared guide is ../100x-other/references/b.md.\n`, extra: shared })), ['spec-escape'], 'a path to a guide in a sibling fails, and the guide is printed with 100x ref instead');
});

test('disable-model-invocation fails because the agent could not call such a skill', () => {
  const box = sandbox();
  assert.ok(rules(repo(box, { skill: GOOD.replace('---\n# Demo', 'disable-model-invocation: true\n---\n# Demo') })).includes('model-invocation'));
  box.cleanup();
});

test('a skill file over the line budget fails', () => {
  const box = sandbox();
  assert.ok(rules(repo(box, { skill: `${GOOD}${'line\n'.repeat(140)}` })).includes('line-budget'));
  box.cleanup();
});

test('a missing referenced file fails', () => {
  const box = sandbox();
  assert.ok(rules(repo(box, { skill: `${GOOD}\nAlso read references/ghost.md.\n` })).includes('reference-missing'));
  box.cleanup();
});

test('a reference nothing points to fails', () => {
  const box = sandbox();
  assert.ok(rules(repo(box, { extra: { 'skills/100x-demo/references/lonely.md': '# Lonely\n' } })).includes('reference-orphan'));
  box.cleanup();
});

test('a broken markdown link fails', () => {
  const box = sandbox();
  assert.ok(rules(repo(box, { skill: `${GOOD}\nSee [x](references/nope.md).\n` })).includes('link-missing'));
  box.cleanup();
});

test('a command the CLI does not have fails, in prose and in code blocks', () => {
  const box = sandbox();
  assert.ok(rules(repo(box, { skill: `${GOOD}\nRun \`100x frobnicate now\`.\n` })).includes('command-unknown'));
  assert.ok(rules(repo(box, { skill: `${GOOD}\n\`\`\`\n~/.100x/bin/100x frobnicate\n\`\`\`\n` })).includes('command-unknown'));
  box.cleanup();
});

test('a flag the command does not have fails, and real flags pass, in spans and in code blocks', () => {
  const box = sandbox();
  assert.deepEqual(rules(repo(box, { skill: `${GOOD}\nRun \`100x shots index.html --label review --matrix phone\` then \`100x config set review.model x --global\`.\n` })), []);
  assert.ok(rules(repo(box, { skill: `${GOOD}\nRun \`100x doctor --frobnicate\`.\n` })).includes('flag-unknown'));
  assert.ok(rules(repo(box, { skill: `${GOOD}\n\`\`\`\n100x shots index.html --label x --bogus\n\`\`\`\n` })).includes('flag-unknown'));
  assert.deepEqual(rules(repo(box, { skill: `${GOOD}\nRun \`100x shots x --label a && git commit --message b\`.\n` })), [], 'flags after && belong to another command');
  box.cleanup();
});

test('the typed token and sibling skill names are not mistaken for commands', () => {
  const box = sandbox();
  assert.deepEqual(rules(repo(box, { skill: `${GOOD}\nType \`$100x variants 3\` or use \`100x-setup\` and the 100x skill.\n` })), []);
  box.cleanup();
});

test('long dashes and placeholder words fail in prose', () => {
  const box = sandbox();
  const dash = String.fromCharCode(0x2014);
  assert.ok(rules(repo(box, { skill: `${GOOD}\nA thing ${dash} another thing.\n` })).includes('long-dash'));
  assert.ok(rules(repo(box, { skill: `${GOOD}\nTODO finish this.\n` })).includes('placeholder'));
  box.cleanup();
});

test('the real repository passes its own gate', () => {
  const findings = validateRepo(ROOT, { commands: commandNames, usages: commandUsages });
  assert.deepEqual(findings.map((f) => `${f.rule} ${f.file}: ${f.message}`), []);
  assert.ok(fs.existsSync(path.join(ROOT, 'package.json')));
});

const UNSLOP_TEXT = companionScript('unslop-text');
const proseSkip = fs.existsSync(UNSLOP_TEXT) ? false : 'the pinned unslop-text is missing from vendor/';

test('validate --prose passes the real repository', { skip: proseSkip }, () => {
  const result = cli(['validate', '--prose'], { env: { X100_UNSLOP_TEXT: UNSLOP_TEXT } });
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /prose lint ok/);
});

test('validate --prose fails padded, tell-heavy writing and says why', { skip: proseSkip }, () => {
  const box = sandbox();
  const slop = `In today's fast-paced world, it's important to note that this robust, seamless solution will delve into a rich tapestry of cutting-edge synergies. Let's dive in and unlock the full potential of your main-flow. `.repeat(12);
  const root = repo(box, { skill: `${GOOD}\n${slop}\n` });
  const result = cli(['validate', '--prose', '--root', root], { env: { X100_UNSLOP_TEXT: UNSLOP_TEXT } });
  assert.equal(result.code, 1);
  assert.match(result.out, /prose-lint/);
  box.cleanup();
});

test('validate --prose is skipped with a note when unslop-text is missing', () => {
  const box = sandbox();
  const result = cli(['validate', '--prose', '--root', repo(box)], { env: { X100_UNSLOP_TEXT: path.join(box.dir, 'missing.mjs') } });
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /prose lint skipped/);
  box.cleanup();
});

const skillFolders = () => fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, 'skills', d.name, 'SKILL.md'))).map((d) => d.name).sort();
const routerFile = path.join(ROOT, 'skills', '100x', 'SKILL.md');

test('the router and the README list exactly the skills in skills/, and the number phrases are the same table in both', () => {
  const table = (file, head) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const start = lines.findIndex((line) => line.startsWith(head));
    assert.notEqual(start, -1, `${file} has no table that starts with ${head}`);
    const rows = [];
    for (const line of lines.slice(start)) {
      if (!line.startsWith('|')) break;
      rows.push(line);
    }
    return rows;
  };
  const called = (file, head = '| You call |') => table(file, head).slice(2).map((row) => row.split('|')[1].replace(/[`$/\s]/g, '')).sort();
  const folders = skillFolders().filter((name) => /^100x(-|$)/.test(name));
  assert.ok(folders.length >= 9, `the router and each mode are skills: ${folders.join(', ')}`);
  assert.deepEqual(called(routerFile), folders, 'the router lists every skill, and only skills that exist');
  assert.deepEqual(called(path.join(ROOT, 'README.md'), '| Type this |'), folders, 'the README lists every skill, and only skills that exist');
  // The phrases are the same in both. The README says what each does in its own plain words.
  const phrases = (file) => table(file, '| You write |').slice(2).map((row) => row.split('|')[1].trim());
  assert.deepEqual(phrases(routerFile), phrases(path.join(ROOT, 'README.md')));
});

test('no skill keeps a table of trigger words: the owner picks a mode by calling the skill, and no word in a brief does', () => {
  const router = fs.readFileSync(routerFile, 'utf8');
  assert.match(router, /## Modes are skills\n\nEach mode is its own skill, and the owner picks it by calling it\. A word inside a brief never picks a mode/);
  const files = skillFolders().filter((name) => /^100x(-|$)/.test(name)).map((name) => path.join(ROOT, 'skills', name, 'SKILL.md'));
  for (const file of [...files, path.join(ROOT, 'README.md')]) {
    const body = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(body, /trigger word|\| You write \| What happens \|\n\|---\|---\|\n\| `(mockup|report|status)`/i, `${path.relative(ROOT, file)} brings back trigger words`);
    assert.doesNotMatch(body, /[$/]100x (status|report|setup|continue|judge|resume|explain|morning|mockup|overnight|wrap)\b/, `${path.relative(ROOT, file)} tells the owner to put a mode word after the skill name`);
  }
});

const docs = () => {
  const out = [path.join(ROOT, 'README.md')];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.md')) out.push(file);
    }
  };
  for (const name of skillFolders().filter((one) => /^100x(-|$)/.test(one))) walk(path.join(ROOT, 'skills', name));
  return out;
};

test('the owner is never told to run morning: only the report skill, which runs the command itself, names it', () => {
  const allowed = ['README.md', path.join('skills', '100x-report', 'SKILL.md')];
  const unexpected = docs().map((file) => path.relative(ROOT, file)).filter((file) => /`100x morning\b/.test(fs.readFileSync(path.join(ROOT, file), 'utf8')) && !allowed.includes(file));
  assert.deepEqual(unexpected, [], 'only the report skill names the command, because it is the one that runs it');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').split('\n').filter((line) => /`100x morning\b/.test(line));
  assert.ok(readme.every((line) => /^\| `morning` \|/.test(line)), `the README names the command only in its table of commands: ${readme.join(' | ')}`);
});

test('the skill asks back when it cannot tell what the owner wants, and never when the owner is away', () => {
  const skill = fs.readFileSync(routerFile, 'utf8');
  assert.match(skill, /\*\*Ask back when you cannot tell\.\*\*/);
  assert.match(skill, /## When you are not sure[\s\S]*The message is not a brief:[\s\S]*never ask: take the most reasonable reading and log it/);
  assert.match(skill, /A taste fork is not one of those times: build both\./);
  assert.match(skill, /A message that is not a brief gets the question from "When you are not sure"\. Create nothing until it is answered\./);
  assert.match(skill, /A word you do not know is not the name of a prototype to make\./, 'a normal build is for a brief, not for any message');
  assert.match(skill, /A lone word that is the name of a mode in the table above, without the `100x-` \(`status`, `report`, `mockup` and the rest\) gets the question with that skill as the guess, "Do you mean `100x-status`\?" for `status`, because the mode is picked by calling the skill\./, 'a lone mode word is asked about, not built and not run');
  assert.match(fs.readFileSync(path.join(ROOT, 'skills', '100x-overnight', 'SKILL.md'), 'utf8'), /Never ask what a brief means: take the most reasonable reading and log it\./, 'a sleeping owner answers nothing');
  for (const file of docs()) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /only question (100x asks|is a missing brief)|That is the only question|Nobody answers questions at night/, `${path.relative(ROOT, file)} still says 100x asks one question only`);
});

test('every skill the code tells the owner to call is a skill in this repository', () => {
  const folders = new Set(skillFolders());
  const temp = new Set(['100x-shots', '100x-readme-stamp', '100x-facts-']);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.mjs') ? [path.join(dir, entry.name)] : []));
  const named = new Map();
  for (const file of [...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'bin'))]) {
    for (const [name] of fs.readFileSync(file, 'utf8').matchAll(/\b100x-[a-z][a-z-]*/g)) if (!temp.has(name)) named.set(name, path.relative(ROOT, file));
  }
  assert.ok(named.size >= 5, 'the code names the skills it points the owner to');
  for (const [name, file] of named) assert.ok(folders.has(name), `${file} tells the owner to call ${name}, and there is no such skill`);
});

test('the grind skill, the router and the README name the words the command prints and the numbers it stops at', () => {
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
  const skill = read('skills', '100x-grind', 'SKILL.md');
  const printed = [grindWords({ state: 'green', round: 1 }), grindWords({ state: 'stalled', best: 1, serious: 1, flags: 1, since: GRIND_STALL }), grindWords({ state: 'limit', rounds: GRIND_LIMIT })];
  for (const words of printed) assert.ok(skill.includes(words.split('.')[0]), `the skill reads "${words.split('.')[0]}", which is what 100x triage prints`);
  assert.ok(skill.includes('"Not green yet."'), 'the skill knows how triage says another round is planned');
  const stall = { 3: 'three', 4: 'four', 5: 'five' }[GRIND_STALL];
  // The README says it in plain words, "reviews", where the skills say "ship tests".
  for (const [name, text, said] of [['skill', skill, 'ship tests'], ['router', read('skills', '100x', 'SKILL.md'), 'ship tests'], ['README', read('README.md'), 'reviews']]) {
    assert.ok(text.includes(`${stall} ${said} in a row`), `${name} says a stall is ${stall} ${said} in a row, as the code counts them`);
    assert.ok(text.includes(`${GRIND_LIMIT} rounds`), `${name} says the round limit is ${GRIND_LIMIT}, as the code counts it`);
  }
});

test('the router and the adhd skill give a turn and a long answer the same limits, and the README and the router name the skill', () => {
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
  const skill = read('skills', '100x-adhd', 'SKILL.md');
  const router = read('skills', '100x', 'SKILL.md');
  for (const [name, text] of [['skill', skill], ['router', router]]) assert.match(text, /at most three points, one idea per line/i, `the ${name} states the limit of a turn`);
  assert.match(router, /at most six lines/, 'the router states the limit of a status answer');
  assert.match(skill, /More than six lines of material: give the first three/, 'the skill cuts a long answer at the same six lines');
  assert.match(router, /`100x-adhd` skill holds a whole thread/, 'the router sends a whole thread to the skill');
  assert.match(read('README.md'), /\| `\/100x-adhd` \|/, 'the README lists the skill in its table');
});

test('every line of prose that lists the mode skills lists all of them', () => {
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
  const modes = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith('100x-')).map((d) => d.name);
  assert.ok(modes.length >= 10, 'the skills folder holds the mode skills');
  const places = [
    ['docs/install.md', 'One link for each skill in'],
    ['docs/contributing.md', 'Each other mode is a folder next to it'],
    ['docs/design.md', 'Each other mode is a skill of its own'],
    ['skills/100x/SKILL.md', 'The other modes are skills of their own'],
  ];
  for (const [file, anchor] of places) {
    const line = read(...file.split('/')).split('\n').find((text) => text.includes(anchor));
    assert.ok(line, `${file} has the line with "${anchor}"`);
    for (const name of modes) assert.ok(line.includes(name), `${file}, the line with "${anchor}", lists ${name}`);
  }
});

test('every row a skill tells the agent to log uses a phase the decisions guide lists', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'skills', '100x', 'references', 'decisions.md'), 'utf8');
  const listed = new Set([...(/^\| phase \| (.+) \|$/m.exec(guide)?.[1] ?? '').matchAll(/`([a-z-]+)`/g)].map((hit) => hit[1]));
  assert.ok(listed.size >= 10, 'the guide lists the phases');
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.md') ? [path.join(dir, entry.name)] : []));
  const unlisted = [];
  for (const file of files(path.join(ROOT, 'skills'))) {
    for (const hit of fs.readFileSync(file, 'utf8').matchAll(/`100x log ([a-z][a-z-]*) "/g)) if (!listed.has(hit[1])) unlisted.push(`${path.relative(ROOT, file)}: ${hit[1]}`);
  }
  assert.deepEqual(unlisted, [], 'a phase that is not in skills/100x/references/decisions.md');
});
