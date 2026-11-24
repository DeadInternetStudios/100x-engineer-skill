import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { headingCount, readAsks, scan, section } from '../lib/project.mjs';
import { checkPrompt, PROMPT_MARKER, PROMPT_MARKER_TEXT, renderPrompt, SECTIONS, writtenSection } from '../lib/prompt.mjs';
import { triggerHits } from '../lib/triggers.mjs';
import { cli, ROOT, sandbox } from './helpers.mjs';
import { makeProject, PROJECT_MD, PROMPT_MD, runJson } from './projects.mjs';

const projectFile = (box) => path.join(box.project, '.100x', 'project.md');
const setProject = (box, text) => {
  fs.writeFileSync(projectFile(box), text);
  return box.project;
};
const run = (box, ...args) => cli(args, { cwd: box.project, env: box.env });
const init = (box) => assert.equal(run(box, 'init', '--no-git').code, 0);
const marker = (box) => path.join(box.project, '.100x', PROMPT_MARKER);

// A box with a new project.md in it, as `100x init` leaves it, holding `text`.
function promptBox(text) {
  const box = sandbox();
  init(box);
  setProject(box, text);
  return box;
}

// The two finished prompts in the guide are the tests' own material: a prompt the guide shows has to pass the check it teaches.
const examples = [...fs.readFileSync(path.join(ROOT, 'skills', '100x', 'references', 'prompt-example.md'), 'utf8').matchAll(/```markdown\n([\s\S]*?)\n```/g)].map((hit) => `${hit[1]}\n`);

const FULL = PROMPT_MD;

// FULL with the body of one section swapped for another.
const withSection = (name, body, text = FULL) => text.replace(new RegExp(`(## ${name}\\n)[\\s\\S]*?(?=\\n## |$)`), (_, head) => `${head}${body}\n`);
const messagesFor = (result, name) => result.problems.filter((problem) => problem.section === name).map((problem) => problem.message);
const check = (box, text) => checkPrompt(setProject(box, text));

test('init writes every section of the prompt, in one order, each with a hint to write over, and the marker', () => {
  const box = sandbox();
  init(box);
  const text = fs.readFileSync(projectFile(box), 'utf8');
  assert.deepEqual([...text.matchAll(/^## (.+)$/gm)].map((hit) => hit[1]), SECTIONS.map((spec) => spec.name));
  assert.deepEqual([...text.matchAll(/^## .+\n<!--/gm)].length, SECTIONS.length, 'a hint under every heading');
  assert.equal(fs.readFileSync(marker(box), 'utf8'), PROMPT_MARKER_TEXT);
  assert.match(PROMPT_MARKER_TEXT, /Delete this file to turn that off\. `100x init` writes it again until the run has begun\./, 'the file says what it does, and when deleting it does not stay');
  assert.match(fs.readFileSync(path.join(box.project, '.100x', 'STATE.md'), 'utf8'), /write the prompt in project\.md.*100x prompt check/);
  box.cleanup();
});

test('check names every section that is still the template, and exits 1', () => {
  const box = sandbox();
  init(box);
  const result = run(box, 'prompt', 'check', '--json');
  assert.equal(result.code, 1);
  const report = JSON.parse(result.out);
  assert.equal(report.style, 'prompt');
  assert.deepEqual(report.problems.map((problem) => problem.section), ['Brief', 'Goal', 'Read first', 'Rules', 'Riskiest unknown', 'Asks', 'Scope', 'Test material', 'Do not', 'Assumptions', 'Must not break', 'Properties', 'Moment', 'Judge focus']);
  const text = run(box, 'prompt', 'check');
  assert.match(text.out, /## Rules in project\.md is still the template's hint\. Write it\./);
  assert.match(text.out, /## Read first in project\.md is still the template's hint\. Write it, or put "none: <reason>" under it\./);
  assert.match(text.out, /references\/prompt\.md in the skill says how/);
  box.cleanup();
});

test('a finished prompt passes, in any line ending, and the report counts it', () => {
  for (const text of [FULL, FULL.replace(/\n/g, '\r\n')]) {
    const box = promptBox(text);
    const result = JSON.parse(run(box, 'prompt', 'check', '--json').out);
    assert.deepEqual(result.problems, []);
    assert.equal(result.asks, 3, 'the asks that count, with CRLF too, and not the dropped one');
    assert.deepEqual(result.none, [{ name: 'Test material', reason: 'no outside files are needed' }]);
    assert.match(run(box, 'prompt', 'check').out, /^prompt ok\. 13 written, 1 marked none, 3 asks/);
    box.cleanup();
  }
});

test('a project.md from before the Moment heading still passes the check and still exports that section', () => {
  const box = promptBox(FULL.replace('## Moment', '## Wow'));
  const result = check(box, fs.readFileSync(projectFile(box), 'utf8'));
  assert.deepEqual(result.problems, []);
  assert.ok(result.written.includes('Moment'));
  const shown = run(box, 'prompt', 'show');
  assert.equal(shown.code, 0, shown.err);
  assert.match(shown.out, /\nMOMENT\nThe first tap lights the whole screen\./);
  box.cleanup();
});

test('a section may say none only where nothing at all can be the answer, and only with a reason that says something', () => {
  const box = promptBox(FULL);
  const readFirst = (body) => check(box, withSection('Read first', body));
  assert.deepEqual(readFirst('none: an empty folder and a brief that names nothing').problems, []);
  assert.match(messagesFor(readFirst('none'), 'Read first')[0], /"none" and no reason/);
  assert.match(messagesFor(readFirst('none:'), 'Read first')[0], /"none" and no reason/);
  assert.match(messagesFor(readFirst('none: n/a'), 'Read first')[0], /says none for a reason that says nothing \("n\/a"\)/);
  assert.match(messagesFor(readFirst('none: nothing'), 'Read first')[0], /a reason that says nothing/);
  assert.match(messagesFor(readFirst('none: no files'), 'Read first')[0], /a reason that says nothing \("no files"\)/, 'two words say little');
  assert.match(messagesFor(readFirst('none: an empty folder\n- but README.md names the glow'), 'Read first')[0], /starts with "none:" and goes on for more lines/, 'a none is one line');
  for (const name of ['Brief', 'Goal', 'Rules', 'Riskiest unknown', 'Scope', 'Must not break', 'Moment', 'Judge focus']) {
    assert.deepEqual(messagesFor(check(box, withSection(name, 'none: this one always applies')), name), [`## ${name} in project.md cannot be none. Write it.`], name);
  }
  const all = check(box, ['Read first', 'Test material', 'Do not', 'Assumptions'].reduce((text, name) => withSection(name, `none: nothing for ${name} here`, text), FULL));
  assert.deepEqual(all.none.map((one) => one.name), ['Read first', 'Test material', 'Do not', 'Assumptions']);
  assert.deepEqual(all.problems, [], 'all four may say none');
  const prose = withSection('Goal', 'None of the repos are public, so the tool reads them all and reports every export that nothing imports.');
  assert.deepEqual(messagesFor(check(box, prose), 'Goal'), [], 'a sentence that starts with None is a sentence');
  box.cleanup();
});

test('the check holds what has the wrong shape, and says so in the guide\'s own numbers', () => {
  const box = promptBox(FULL);
  const shape = [
    ['Rules', '- Be good, not bad. Stop somewhere.', /## Rules in project\.md has 1 line and needs at least 3\. Write three to six rules, one per line\./],
    ['Judge focus', '- Does it work?', /## Judge focus in project\.md has 1 line and needs at least 2\. Write two to six questions, one per line\./],
    ['Riskiest unknown', 'It might not work, so we stop.', /## Riskiest unknown in project\.md has no question mark\. Write the questions the first try answers/],
  ];
  for (const [name, body, message] of shape) {
    const result = check(box, withSection(name, body));
    assert.equal(result.ok, false, name);
    assert.match(messagesFor(result, name).join('\n'), message);
  }
  const two = check(box, withSection('Asks', '- [x] 1. a thing that glows (evidence: shots/final)\n- [x] 2. its total shows (evidence: `npm test`, 3 passing)'));
  assert.match(messagesFor(two, 'Asks')[0], /^## Asks in project\.md has 2 asks that count and needs at least 3\. List each as/);
  const dropped = check(box, withSection('Asks', '- [~] 1. a (dropped: no)\n- [~] 2. b (dropped: no)\n- [~] 3. c (dropped: no)'));
  assert.match(messagesFor(dropped, 'Asks')[0], /^## Asks in project\.md has no ask that counts, and dropped asks do not count\. List each as/, 'three dropped asks are not three asks');
  const four = check(box, withSection('Asks', '- [ ] 1. a\n- [ ] 2. b\n- [~] 3. c (dropped: no)\n- [ ] 4. d'));
  assert.deepEqual(four.problems, [], 'three that count and one dropped');
  box.cleanup();
});

test('a quotation and a subheading are not a section\'s own lines, the way a quoted ask is not an ask', () => {
  const box = promptBox(FULL);
  const rules = '- A, not b. Stop here.\n- C, not d. Stop there.\n- E, not f. Stop now.';
  const quoted = check(box, withSection('Rules', `\`\`\`\n${rules}\n\`\`\``));
  assert.match(messagesFor(quoted, 'Rules')[0], /^## Rules in project\.md has 0 lines and needs at least 3 \(lines in a code fence are a quotation and subheadings are titles, so they do not count\)\. Write three to six rules/);
  assert.equal(quoted.ok, false);
  assert.equal(quoted.written.includes('Rules'), false, 'a section that is only a quotation is not counted as written');
  const titled = check(box, withSection('Rules', '### Code\n- A, not b. Stop here.\n### Docs\n- C, not d. Stop there.'));
  assert.match(messagesFor(titled, 'Rules')[0], /has 2 lines and needs at least 3 \(lines in a code fence are a quotation and subheadings are titles/, 'a subheading is a title, not a rule, and the message says so');
  const indented = check(box, withSection('Rules', '  ### Code\n  ### Docs\n  ### Tests'));
  assert.match(messagesFor(indented, 'Rules')[0], /has 0 lines and needs at least 3/, 'an indented subheading is a title too, as in Markdown');
  assert.deepEqual(check(box, withSection('Rules', `### Code\n- A, not b. Stop here.\n- C, not d. Stop there.\n### Docs\n- E, not f. Stop now.`)).problems, [], 'rules under subheadings count');
  assert.deepEqual(check(box, withSection('Rules', `${rules}\n\n\`\`\`\n- a quoted line\n\`\`\``)).problems, [], 'a quotation beside enough rules of its own is fine');
  const asked = check(box, withSection('Riskiest unknown', 'It might not work, so we stop.\n```\nDoes it work?\n```'));
  assert.match(messagesFor(asked, 'Riskiest unknown')[0], /has no question mark/, 'a question inside a quotation is not the writer\'s question');
  box.cleanup();
});

test('the check counts what is there, so text of the right shape passes however thin, and the limit is said out loud', () => {
  const box = promptBox(FULL);
  let text = withSection('Goal', 'Make a thing.');
  text = withSection('Rules', '- a\n- b\n- c', text);
  text = withSection('Scope', 'In: stuff.', text);
  text = withSection('Moment', 'It glows.', text);
  assert.deepEqual(check(box, text).problems, [], 'filler of the right shape passes. No count can tell it from a short honest section');
  const help = run(box, 'prompt', '--help');
  assert.match(help.out + help.err, /counts what is there, and\s+does not judge how good it is/);
  const guide = fs.readFileSync(path.join(ROOT, 'skills', '100x', 'references', 'prompt.md'), 'utf8');
  assert.match(guide, /The check counts what is there\. It cannot tell a good prompt from a thin one/);
  for (const [where, text] of [['the guide', guide], ['the help', help.out + help.err]]) assert.ok(text.includes(`.100x/${PROMPT_MARKER}`), `${where} names the file init writes, so a reader can find it and delete it`);
  box.cleanup();
});

test('a heading counts once, the extra sections included', () => {
  const box = promptBox(FULL);
  assert.deepEqual(messagesFor(check(box, `${FULL}\n## Rules\n- one\n- two\n- three\n`), 'Rules'), ['## Rules is in project.md twice. Keep one.']);
  assert.deepEqual(messagesFor(check(box, `${FULL}\n## Asks\n- [ ] 5. another\n`), 'Asks'), ['## Asks is in project.md twice. Keep one.']);
  assert.deepEqual(messagesFor(check(box, `${FULL}\n## Assumptions\n- a later one\n`), 'Assumptions'), ['## Assumptions is in project.md twice. Keep one.']);
  for (const extra of ['Stack and run', 'Modifiers', 'Pre-flight']) {
    const twice = check(box, `${FULL}\n## ${extra}\none\n\n## ${extra}\ntwo\n`);
    assert.deepEqual(messagesFor(twice, extra), [`## ${extra} is in project.md twice. Keep one.`], extra);
  }
  assert.deepEqual(check(box, `${FULL}\n## Stack and run\nnode\n`).problems, [], 'one of them is fine');
  box.cleanup();
});

test('a heading inside a comment or a code fence is a quotation, whatever the fences and comments around it do', () => {
  const box = promptBox(FULL);
  const ok = (text, why) => assert.deepEqual(check(box, text).problems, [], why);
  ok(`${FULL}\n<!-- ## Rules\n- [ ] 9. a hint's example -->\n\n\`\`\`\n## Scope\nIn: a quotation.\n- [ ] 8. in a fence\n\`\`\`\n`, 'a comment and a fence');
  assert.equal(check(box, `${FULL}\n<!-- ## Rules\n- [ ] 9. a hint's example -->\n`).asks, 3, 'nor does a checkbox in them count');
  ok(`${FULL}\n\`\`\`\n## Rules\n- x\n\`\`\`\n\n~~~\n## Scope\nIn.\n~~~\n`, 'two pairs of two kinds');
  ok(`${FULL}\n\`\`\`\`\n\`\`\`\n## Rules\n\`\`\`\n\`\`\`\`\n`, 'a longer fence quotes a shorter one');
  ok(`${FULL}\n~~~~\n~~~\n## Rules\n~~~\n~~~~\n`, 'and so does a longer tilde fence');
  ok(`${FULL}\n\`\`\`\n<!-- note\n## Rules\n\`\`\`\nmore\n-->\n`, 'a comment that opens inside a fence is code, and does not run past the fence');
  ok(`${FULL}\n<!--\n\`\`\`\n-->\n\n\`\`\`\n## Rules\n\`\`\`\n`, 'a fence marker inside a comment is part of the comment');
  ok(FULL.replace('Make a thing that glows.', 'Make a thing that glows. It is a "```inline```" example, and a `<!--` in backticks.'), 'inline code is not a fence or a comment');
  ok(`${FULL}\n\`\`\`inline\`\`\` at the start of a line is inline code, so no fence opens.\n`, 'a line that starts with a fence marker and has a backtick after it is not a fence');
  ok(withSection('Read first', '- The tool treats `<!--` as a comment token, and `<!-- NOTE -->` is one of its examples.'), 'a <!-- in the middle of a sentence hides nothing after it');
  ok(withSection('Read first', '- To start a comment in HTML, write <!-- and then the note.\n- The next source.'), 'and one that is never closed is text as well');
  box.cleanup();
});

test('a fence opens after a list marker, and a comment can follow a comment on one line, without a section appearing or going missing', () => {
  const box = promptBox(FULL);
  const ok = (text, why) => assert.deepEqual(check(box, text).problems, [], why);
  ok(withSection('Brief', 'an idle game.\n\n- run it:\n- ```sh\n  npm test\n  ```\n- done'), 'a bullet that opens a fence, as a list item quotes code');
  ok(withSection('Brief', 'an idle game.\n\n1. ~~~\n## Rules\n   ~~~\n2) ```\n## Scope\n   ```'), 'numbered items, both ways, and a heading inside each fence');
  ok(withSection('Brief', 'an idle game.\n  * ```sh\n    ls\n    ```'), 'an indented bullet');
  ok(withSection('Brief', 'an idle game, and a bullet with ```inline``` code is not a fence.\n- ```inline``` code\n- more'), 'inline code after a bullet is not a fence');
  ok(`${FULL}\n<!-- one --> <!-- two\n## Rules\n-->\n`, 'a comment that closes and another that opens on the same line');
  ok(`${FULL}\n<!--\n--> \`\`\`\n## Rules\n\`\`\`\n`, 'a fence that opens where a comment closes');
  assert.equal(section('## Rules\n<!-- one --> <!-- two -->\n- r\n', 'Rules'), '- r', 'two comments on one line are both taken out');
  assert.equal(headingCount('<!-- a hint --> ## Rules\n', 'Rules'), 0, 'what follows a comment on its line is not a heading');
  const open = check(box, withSection('Brief', 'an idle game.\n- ```sh\n  npm test\n'));
  assert.match(messagesFor(open, 'file')[0], /^A code fence that opens on line \d+ of project\.md never closes/, 'a bullet fence that never closes is still named');
  const mirrored = check(box, withSection('Brief', 'an idle game.\n- ```sh\n  npm test\n- ```'));
  assert.match(messagesFor(mirrored, 'file')[0], /^A code fence that opens on line \d+ of project\.md never closes/, 'a bullet is a new list item and not a closing marker, so a fence closed that way fails loud and names the fix');
  assert.equal(scan('<!-->\n## Rules\n').unclosed, null, 'an empty comment closes where it opens');
  assert.equal(headingCount('<!-->\n## Rules\n', 'Rules'), 1, 'and hides nothing after it');
  box.cleanup();
});

test('a fence or a comment that never closes is named, because it hides every section after it', () => {
  const box = promptBox(FULL);
  const unclosed = (text, kind, line) => {
    const result = check(box, text);
    const own = messagesFor(result, 'file');
    assert.equal(own.length, 1, kind);
    assert.match(own[0], new RegExp(`^A ${kind} that opens on line ${line} of project\\.md never closes, so every section after it is hidden\\. Close it`));
    assert.equal(messagesFor(result, 'Rules').join(), '', 'no duplicate or missing heading is invented in front of it');
    return result;
  };
  const lines = FULL.split('\n').length;
  unclosed(`${FULL}\n\`\`\`\n## Rules\n- x\n`, 'code fence', lines + 1);
  unclosed(`${FULL}\n\`\`\`\n## Rules\n~~~\n`, 'code fence', lines + 1);
  unclosed(`${FULL}\n\`\`\`\`\n\`\`\`\n## Rules\n\`\`\`\n`, 'code fence', lines + 1);
  const comment = unclosed(`${FULL}\n<!-- a note that is never closed\n## Rules\n- x\n`, 'comment', lines + 1);
  assert.equal(comment.ok, false);
  const early = check(box, FULL.replace('## Moment', '<!-- note\n## Moment'));
  assert.match(messagesFor(early, 'file')[0], /^A comment that opens on line \d+/);
  assert.match(messagesFor(early, 'Moment')[0], /## Moment is missing/, 'what it hid, and the reason beside it');
  box.cleanup();
});

test('the readers see what is in the file and nothing else', () => {
  const box = promptBox('');
  const text = '## Asks\n<!-- ## Asks\n- [ ] 9. hidden -->\n- [ ] 1. real\r\n- [x] 2. closed (evidence: x)\r\n\n```\n## Rules\n- [ ] 3. fenced\n```\n## Rules\n- a\r\n- b\r\n';
  setProject(box, text);
  assert.deepEqual(readAsks(box.project).asks.map((ask) => [ask.status, ask.text]), [['open', '1. real'], ['done', '2. closed (evidence: x)']]);
  assert.equal(section(text, 'Rules'), '- a\n- b');
  assert.equal(section('## Rules\n  <!-- an indented hint -->\n- a\n```\ncode\n```\n', 'Rules'), '- a\n```\ncode\n```', 'a hint is taken out and a quotation is kept');
  assert.equal(section('## Rules\n<!-- one line --> and the rest\n', 'Rules'), 'and the rest', 'what follows a comment on its line stays');
  assert.equal(headingCount(text, 'Rules'), 1);
  assert.equal(headingCount(text, 'Asks'), 1);
  const shape = scan(text);
  assert.equal(shape.shape.length, text.split(/\r?\n/).length, 'line numbers do not move');
  assert.equal(shape.unclosed, null);
  assert.equal(writtenSection('## Test material\nnone\n', 'Test material'), '', 'a bare none is nothing to export');
  assert.equal(writtenSection('## Test material\nnone: no files\nbut one: a.txt\n', 'Test material'), 'none: no files\nbut one: a.txt', 'a none that goes on is text');
  const open = '## Asks\n```\n- [ ] 1. in a fence that never closes\n';
  setProject(box, open);
  assert.deepEqual(readAsks(box.project).asks.map((ask) => ask.text), ['1. in a fence that never closes'], 'the asks are read as they always were when the file is broken, and the check says so');
  box.cleanup();
});

test('a run is held to the prompt by the file init wrote, and by nothing in project.md', () => {
  const rewritten = promptBox(PROJECT_MD);
  assert.equal(JSON.parse(run(rewritten, 'prompt', 'check', '--json').out).style, 'prompt', 'the agent wrote over the template without a single new heading, and the gate still holds');
  assert.equal(run(rewritten, 'prompt', 'check').code, 1);
  fs.writeFileSync(marker(rewritten), 'banana');
  assert.equal(JSON.parse(run(rewritten, 'prompt', 'check', '--json').out).style, 'prompt', 'the file is there, so the step is on. Its text only explains');
  rewritten.cleanup();

  const old = sandbox();
  init(old);
  run(old, 'log', '--start', 'first-1');
  fs.rmSync(marker(old));
  setProject(old, PROJECT_MD);
  const older = run(old, 'prompt', 'check');
  assert.equal(older.code, 0);
  assert.match(older.out, /from before the prompt step/);
  const lookalike = `${PROJECT_MD}\n## Scope of work\nThe old plan.\n\n## Rules for contributors\nBe kind.\n\n<!-- ## Read first -->\n\n\`\`\`\n## Do not\n\`\`\`\n`;
  setProject(old, lookalike);
  assert.equal(JSON.parse(run(old, 'prompt', 'check', '--json').out).style, 'older', 'headings an old file happens to have do not make it a prompt');
  assert.equal(run(old, 'init', '--no-git').code, 0, 'init on a run that is already going');
  assert.equal(fs.existsSync(marker(old)), false, 'never stamps a run that began before the prompt step, whatever runs init on it again');
  assert.equal(run(old, 'prompt', 'check').code, 0);
  old.cleanup();

  const mock = sandbox();
  init(mock);
  assert.equal(run(mock, 'prompt', 'check').code, 1, 'the untouched template fails');
  assert.equal(run(mock, 'run', 'set', 'mode', 'mockup').code, 0);
  const result = run(mock, 'prompt', 'check');
  assert.equal(result.code, 0);
  assert.match(result.out, /A mockup does not need the prompt/);
  mock.cleanup();
});

test('a run that starts now is stamped, even in a folder that holds an older project.md, and one that is going is not', () => {
  const copied = sandbox();
  init(copied);
  fs.rmSync(marker(copied));
  setProject(copied, PROJECT_MD);
  assert.equal(run(copied, 'prompt', 'check').code, 0, 'before init: older, nothing to check');
  assert.equal(run(copied, 'init', '--no-git').code, 0);
  assert.ok(fs.existsSync(marker(copied)), 'no run is here, so this init starts one');
  const result = run(copied, 'prompt', 'check');
  assert.equal(result.code, 1);
  assert.match(result.out, /## Goal is missing in project\.md/, 'the older project.md is left as it was, and the check names what it lacks');
  assert.equal(fs.readFileSync(projectFile(copied), 'utf8'), PROJECT_MD, 'init never overwrites project.md');
  copied.cleanup();

  const box = sandbox();
  init(box);
  run(box, 'log', '--start', 'first-1');
  run(box, 'run', 'set', 'hero', 'shots/x.png');
  const info = JSON.parse(run(box, 'init', '--fresh', '--json').out);
  assert.ok(fs.existsSync(path.join(box.project, info.earlier.archivedTo, PROMPT_MARKER)), 'the earlier run keeps its marker');
  assert.ok(fs.existsSync(marker(box)), 'the new one has its own');
  assert.equal(run(box, 'prompt', 'check').code, 1);
  box.cleanup();
});

test('a run that is going is known by its state file too, so a start row written by hand and a lost run.json do not make it a new run', () => {
  const box = sandbox();
  init(box);
  fs.rmSync(marker(box));
  setProject(box, PROJECT_MD);
  fs.writeFileSync(path.join(box.project, '.100x', 'STATE.md'), '# State\n\nStage: 3 Depth\nNext: pass 2\n');
  fs.appendFileSync(path.join(box.project, '.100x', 'decisions.tsv'), '2026-11-18T10:00:00Z\tstart\tStarted the glow run\tnew project\tx\tok\n');
  assert.equal(run(box, 'init', '--no-git').code, 0);
  assert.equal(fs.existsSync(marker(box)), false, 'a stage past 0 says the run began, however its log row reads');
  const result = run(box, 'prompt', 'check');
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /from before the prompt step/);
  assert.equal(fs.readFileSync(path.join(box.project, '.100x', 'STATE.md'), 'utf8').includes('Stage: 3 Depth'), true, 'init leaves the state file as it was');
  box.cleanup();

  const fresh = sandbox();
  init(fresh);
  fs.rmSync(marker(fresh));
  fs.writeFileSync(path.join(fresh.project, '.100x', 'STATE.md'), '# State\n\nStage: 0 Open (prompt written)\nNext: core\n');
  assert.equal(run(fresh, 'init', '--no-git').code, 0);
  assert.ok(fs.existsSync(marker(fresh)), 'stage 0 is a run that has not begun, so a deleted file comes back, as the file says');
  fresh.cleanup();

  const blank = sandbox();
  init(blank);
  fs.rmSync(marker(blank));
  fs.writeFileSync(path.join(blank.project, '.100x', 'STATE.md'), '# State\n\nStage:\nNext: write the prompt\n');
  assert.equal(run(blank, 'init', '--no-git').code, 0);
  assert.ok(fs.existsSync(marker(blank)), 'a Stage line with no value has no stage, and the line after it is not its value');
  blank.cleanup();
});

test('both prompts the guide shows pass the check, so the guide cannot teach a prompt its own tool refuses', () => {
  assert.equal(examples.length, 2);
  for (const [index, example] of examples.entries()) {
    const box = promptBox(example);
    const result = run(box, 'prompt', 'check', '--json');
    assert.equal(result.code, 0, `example ${index + 1}: ${result.out}`);
    const report = JSON.parse(result.out);
    assert.ok(report.asks >= 6, 'real asks, proof asks among them');
    assert.deepEqual(report.problems, []);
    const shown = run(box, 'prompt', 'show');
    assert.equal(shown.code, 0);
    assert.equal(shown.err, '', `example ${index + 1} carries no word that turns on a mode: ${shown.err}`);
    box.cleanup();
  }
});

test('show prints one text that reads as the first message of a chat', () => {
  const box = promptBox(examples[0]);
  const { out, code } = run(box, 'prompt', 'show');
  assert.equal(code, 0);
  assert.match(out, /^Make a cozy idle game for a phone/, 'the goal comes first, with no title above it');
  assert.doesNotMatch(out, /^# lighthouse/m);
  const order = ['WHERE\n', 'READ FIRST\n', 'RULES\n', 'RISKIEST UNKNOWN\n', 'ASKS\n', 'SCOPE\n', 'DO NOT\n', 'CHOICES ALREADY MADE\n', 'MUST NOT BREAK\n', 'MOMENT\n', 'JUDGE FOCUS\n'].map((heading) => out.indexOf(`\n${heading}`));
  assert.ok(order.every((at) => at > 0), 'every section is there');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'in the order the guide gives them');
  assert.doesNotMatch(out, /TEST MATERIAL/, 'a section that says none is left out');
  assert.match(out, /\n1\. A lighthouse the player lights/, 'asks read as a numbered list');
  assert.doesNotMatch(out, /\[ \]|\[x\]|\(evidence:|\(dropped:/, 'the ledger marks stay in the ledger');
  assert.match(out, /Work in .*\. It is not a git repository yet\. Commit locally and often\. Never push, force or rewrite published history\./);
  assert.doesNotMatch(out, /THE OWNER'S WORDS/);
  box.cleanup();
});

test('show leaves the asks as they were written, except for the box and the closing note, and drops what was dropped', () => {
  const asks = [
    '- [ ] 1. keep it under 2 MB (roughly) (evidence: a file under (2 MB))',
    '- [x] 2. closed ask (evidence: `npm test`, 3 passing)',
    '2.5 seconds is the limit for a start.',
    '   - [ ] 2a. a nested ask (evidence: x)',
    '- [~] 3. dropped ask (dropped: out of scope)',
    '- [ ] 4. fix the parser (evidence: tests pass) and keep (legacy mode)',
    '- [ ] 5. last ask',
    '- [x] 6. two notes in a row (evidence: the first) (evidence: the second)',
    '',
    '```',
    '- [ ] 8. a quoted ask (evidence: nowhere)',
    '- [~] 9. a quoted dropped ask (dropped: no)',
    '```',
  ].join('\n');
  const box = promptBox(withSection('Asks', asks));
  const { out } = run(box, 'prompt', 'show');
  const want = [
    'ASKS',
    '1. keep it under 2 MB (roughly)',
    '2. closed ask',
    '2.5 seconds is the limit for a start.',
    '   2a. a nested ask',
    '4. fix the parser (evidence: tests pass) and keep (legacy mode)',
    '5. last ask',
    '6. two notes in a row',
    '',
    '```',
    '- [ ] 8. a quoted ask (evidence: nowhere)',
    '- [~] 9. a quoted dropped ask (dropped: no)',
    '```',
  ].join('\n');
  assert.ok(out.includes(`\n${want}\n\nSCOPE\n`), out);
  assert.doesNotMatch(out, /dropped ask \(dropped: out/);
  box.cleanup();
});

test('show says where the other chat works, adds the owner\'s words on request, and writes a file', () => {
  const box = promptBox(examples[1]);
  // The folder is written as the system writes it: /work/dead-exports on macOS and Linux, C:\work\dead-exports on Windows.
  const folder = path.resolve(box.project, '/work/dead-exports');
  const where = run(box, 'prompt', 'show', '--where', '/work/dead-exports', '--with-brief');
  assert.ok(where.out.includes(`\nWHERE\nWork in ${folder}. Commit locally and often.`), 'nothing about this folder or its git state');
  assert.match(where.out, /\nTHE OWNER'S WORDS\na cli that finds dead exports/);
  const file = path.join(box.dir, 'out', 'prompt.txt');
  const wrote = run(box, 'prompt', 'show', '--out', file);
  assert.match(wrote.out, /^prompt .*prompt\.txt \(\d+ lines\)/);
  assert.equal(fs.readFileSync(file, 'utf8'), run(box, 'prompt').out);
  box.cleanup();
});

test('a relative --where starts at the project folder, even from a folder inside it', () => {
  const box = promptBox(FULL);
  const deep = path.join(box.project, 'src', 'deep');
  fs.mkdirSync(deep, { recursive: true });
  const { out } = cli(['prompt', 'show', '--where', 'elsewhere'], { cwd: deep, env: box.env });
  assert.match(out, /\nWork in .*[\\/]elsewhere\. Commit locally/);
  assert.doesNotMatch(out, /src[\\/]deep/);
  box.cleanup();
});

test('show refuses a prompt that is not finished, and says so plainly for one that never had a prompt', () => {
  const box = sandbox();
  init(box);
  const refused = run(box, 'prompt', 'show');
  assert.equal(refused.code, 1);
  assert.equal(refused.out, '', 'nothing to paste');
  assert.match(refused.err, /The prompt is not finished, so there is nothing to export yet\.\n- ## Brief in project\.md is still the template's hint/);
  assert.match(refused.err, /Fix these, then run this again\./);
  setProject(box, withSection('Goal', ''));
  assert.equal(run(box, 'prompt', 'show').code, 1, 'an empty goal is refused too');
  setProject(box, withSection('Asks', '- [~] 1. a (dropped: no)\n- [~] 2. b (dropped: no)\n- [~] 3. c (dropped: no)'));
  const none = run(box, 'prompt', 'show');
  assert.equal(none.code, 1, 'a ledger of dropped asks would hand over a prompt with no asks');
  assert.match(none.err, /has no ask that counts/);

  fs.rmSync(marker(box));
  setProject(box, PROJECT_MD);
  const older = run(box, 'prompt', 'show');
  assert.equal(older.code, 0);
  assert.match(older.err, /note\. This project\.md is from before the prompt step/);
  setProject(box, withSection('Asks', '- [~] 1. a (dropped: no)\n- [~] 2. b (dropped: no)'));
  assert.doesNotMatch(run(box, 'prompt', 'show').out, /ASKS/, 'an older file with nothing but dropped asks gets no empty heading');

  assert.equal(run(box, 'run', 'set', 'mode', 'mockup').code, 0);
  const mock = run(box, 'prompt', 'show');
  assert.equal(mock.code, 0);
  assert.match(mock.err, /note\. A mockup has no prompt/);
  box.cleanup();
});

test('show lists the number phrases that would change a run after the skill name, with the line each is on, and still prints', () => {
  let text = withSection('Goal', 'Report the totals of a thing that glows, and keep the page up overnight, in 3 versions of one screen.');
  text = withSection('Scope', 'In: one screen, for 10 hours of play. Out: a mockup, wrap up mode.', text);
  text = withSection('Judge focus', '- status of the glow after a reload?\n- Does it glow in the first second?', text);
  const box = promptBox(text);
  const { out, err, code } = run(box, 'prompt', 'show');
  assert.equal(code, 0);
  assert.match(out, /^Report the totals/);
  const lineOf = (word) => out.split('\n').findIndex((line) => line.includes(word)) + 1;
  const wanted = [
    /Line 1 has "3 versions"\. After the skill name, that turns on several versions of the idea\./,
    new RegExp(`Line ${lineOf('for 10 hours')} has "for 10 hours"\\. .* a clock that uses all the time\\.`),
  ];
  for (const pattern of wanted) assert.match(err, pattern);
  for (const word of ['Report', 'overnight', 'mockup', 'wrap up', 'status']) assert.doesNotMatch(err, new RegExp(`has "${word}"`, 'i'), `"${word}" is a plain word in a brief. The mode is the skill that is called`);
  box.cleanup();
});

test('show lists a number phrase in the WHERE line it wrote, and no mode word', () => {
  const box = promptBox(FULL);
  const { out, err } = run(box, 'prompt', 'show', '--where', '/work/mockup-overnight-3 versions');
  const line = out.split('\n').findIndex((one) => one.startsWith(`Work in ${path.resolve(box.project, '/work/mockup-overnight-3 versions')}`)) + 1;
  assert.match(err, new RegExp(`Line ${line} has "3 versions"\\.`));
  assert.doesNotMatch(err, /has "(mockup|overnight)"/);
  box.cleanup();
});

test('the phrases the lint looks for are the phrases in the router\'s number table, and a mode word is not one of them', () => {
  const lines = fs.readFileSync(path.join(ROOT, 'skills', '100x', 'SKILL.md'), 'utf8').split('\n');
  const from = lines.findIndex((line) => line.startsWith('| You write |'));
  assert.notEqual(from, -1, 'the router has a number phrases table');
  const rows = [];
  for (const line of lines.slice(from + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|')[1]);
  }
  const phrases = rows.flatMap((cell) => [...cell.matchAll(/`([^`]+)`/g)].map((hit) => hit[1]));
  assert.deepEqual(phrases, ['3 versions', 'for 10 hours', 'for 2 days', 'until 6am', '5 rounds of judging', 'max 5 subagents']);
  assert.ok(lines.join('\n').includes('`no verification`'), 'the router names the phrase that switches property checks off');
  assert.equal(triggerHits('Keep it small, no verification please.')[0]?.word, 'verification');
  for (const phrase of phrases) assert.ok(triggerHits(phrase).length > 0, `"${phrase}" is in the router's table and the lint does not know it`);
  const modeWords = 'a status page for my shop, an overnight oats app, a mockup tool, wrap up the resume builder, report cards, explain this page, morning habits, continue reading, judge a contest, setup guide, an adhd planner, a quick fast rapid prototype mvp';
  assert.deepEqual(triggerHits(modeWords), [], 'a word that names a mode is a plain word in a brief');
  assert.equal(triggerHits('Morning habits, and a long line.\nKeep it up for 2 days.').map((hit) => `${hit.word}@${hit.line}`).join(), 'a length of work@2');
});

test('each number phrase says what it turns on, and the right thing', () => {
  const phrases = [
    ['3 versions', 'versions', /^several versions of the idea$/],
    ['for 10 hours', 'a length of work', /^a clock that uses all the time$/],
    ['until 6am', 'a length of work', /^a clock that uses all the time$/],
    ['3 rounds of judging', 'rounds of judging', /^a number of judge rounds$/],
    ['max 2 subagents', 'subagents', /^a cap on helpers$/],
  ];
  for (const [text, word, turns] of phrases) {
    const hits = triggerHits(`please, ${text}`);
    assert.deepEqual(hits.map((hit) => hit.word), [word], text);
    assert.match(hits[0].turns, turns, text);
  }
});

test('finish holds a run with a half-written or thin prompt, and lets an older one, a mockup and a finished one through', () => {
  const finished = sandbox();
  makeProject(finished, { projectMd: FULL, prompted: true });
  const ready = run(finished, 'finish', '--check');
  assert.equal(ready.code, 0, ready.out);
  assert.match(ready.out, /ready to finish/);
  finished.cleanup();

  const half = sandbox();
  makeProject(half, { projectMd: withSection('Rules', '<!-- Three to six rules. -->'), prompted: true });
  const held = run(half, 'finish', '--check');
  assert.equal(held.code, 1);
  assert.match(held.out, /error The prompt in project\.md is not finished\. references\/prompt\.md in the skill says how to write it\./);
  assert.match(held.out, /error ## Rules in project\.md is still the template's hint\./);
  assert.doesNotMatch(held.out, /Asks in project\.md has no ask/, 'the asks have their own check, said once');
  half.cleanup();

  const thin = sandbox();
  makeProject(thin, { projectMd: withSection('Asks', '- [x] 1. a thing that glows (evidence: shots/final)\n- [x] 2. its total shows (evidence: `npm test`, 3 passing)'), prompted: true });
  const few = run(thin, 'finish', '--check');
  assert.equal(few.code, 1);
  assert.match(few.out, /error ## Asks in project\.md has 2 asks that count and needs at least 3\./);
  thin.cleanup();

  const bare = sandbox();
  makeProject(bare, { projectMd: FULL.replace(/## Asks[\s\S]*?(?=\n## Scope)/, ''), prompted: true });
  const noLedger = run(bare, 'finish', '--check').out;
  assert.match(noLedger, /error project\.md has no "## Asks" ledger\./);
  assert.doesNotMatch(noLedger, /## Asks is missing in project\.md/, 'a missing ledger is said once, by the check that owns it');
  bare.cleanup();

  const dead = sandbox();
  makeProject(dead, { projectMd: withSection('Asks', '- [~] 1. a (dropped: out of scope)\n- [~] 2. b (dropped: out of scope)\n- [~] 3. c (dropped: out of scope)'), prompted: true });
  assert.match(run(dead, 'finish', '--check').out, /error ## Asks in project\.md has no ask that counts, and dropped asks do not count\./);
  dead.cleanup();

  const old = sandbox();
  makeProject(old);
  const passed = run(old, 'finish', '--check');
  assert.equal(passed.code, 0, passed.out);
  assert.doesNotMatch(passed.out, /project\.md/);
  old.cleanup();

  const mock = sandbox();
  makeProject(mock, { run: runJson({ mode: 'mockup', polishPasses: 0 }), prompted: true, projectMd: PROJECT_MD });
  const mocked = run(mock, 'finish', '--check');
  assert.match(mocked.out, /MOCKUP\.md/, 'finish did look at this run as a mockup');
  assert.doesNotMatch(mocked.out, /The prompt in project\.md is not finished|still the template/);
  mock.cleanup();
});

test('the judge is told the builder\'s own rules, scope and promises, and nothing when a section says none', () => {
  const box = sandbox();
  makeProject(box, { projectMd: FULL, prompted: true });
  assert.equal(run(box, 'brief').code, 0);
  const brief = fs.readFileSync(path.join(box.project, '.100x', 'review', 'brief.md'), 'utf8');
  assert.match(brief, /The builder's own rules\. Check that the product keeps them\.\n- Glow, not flicker\./);
  assert.match(brief, /Out of scope, and what the product says it cannot do\. .*\.\nIn: one screen at 390 wide\. Out: accounts and sound\./);
  assert.match(brief, /What the builder promised not to do\.\n- Do not play sound\./);
  assert.doesNotMatch(brief, /still the template/);
  box.cleanup();

  const none = sandbox();
  makeProject(none, { projectMd: withSection('Do not', 'none: no hazard of its own here'), prompted: true });
  assert.equal(run(none, 'brief').code, 0);
  const text = fs.readFileSync(path.join(none.project, '.100x', 'review', 'brief.md'), 'utf8');
  assert.doesNotMatch(text, /What the builder promised not to do/);
  assert.match(text, /The builder's own rules\./);
  none.cleanup();

  const older = sandbox();
  makeProject(older, { projectMd: FULL });
  assert.equal(run(older, 'brief').code, 0);
  const asBefore = fs.readFileSync(path.join(older.project, '.100x', 'review', 'brief.md'), 'utf8');
  assert.doesNotMatch(asBefore, /The builder's own rules|What the builder promised not to do|Out of scope, and what the product says/, 'a run from before the prompt step has no terms of its own, even if its project.md has the headings');
  older.cleanup();
});

test('the loop judges\' asks are told to carry the same terms the review judge gets, when the run has them', () => {
  const skill = (...parts) => fs.readFileSync(path.join(ROOT, 'skills', '100x', ...parts), 'utf8');
  for (const file of ['polish.md', 'fill.md']) {
    assert.match(skill('references', file), /the Rules, Scope and Do not lines from `\.100x\/project\.md` when it has them/, `${file}: a run from before the prompt step has no such lines, and is not told to look for them`);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'skills', '100x-continue', 'SKILL.md'), 'utf8'), /and its rules and do-nots when it has them/, 'continue reads an older project.md too');
  assert.match(skill('references', 'core.md'), /when `project\.md` has `Read first` lines marked `\(not read\)`/, 'and so does the core stage');
});

test('prompt says what to do when there is no project.md, the word is wrong, or a flag belongs to the other word', () => {
  const box = sandbox();
  assert.match(run(box, 'prompt').err, /No \.100x folder found here/);
  init(box);
  assert.match(run(box, 'prompt', 'nope').err, /unknown prompt command "nope"\. Use show or check\./);
  assert.match(run(box, 'prompt', 'show', '--json').err, /--json is for `100x prompt check`, not show\./);
  assert.match(run(box, 'prompt', 'check', '--out', 'x.txt').err, /--out is for `100x prompt show`, not check\./);
  assert.match(run(box, 'prompt', 'check', '--where', 'x').err, /--where is for `100x prompt show`, not check\./);
  fs.rmSync(projectFile(box));
  assert.match(run(box, 'prompt', 'check').err, /There is no \.100x\/project\.md here\./);
  box.cleanup();
});

test('the export is built once, so what the in-process reader says is what the command prints', () => {
  const box = promptBox(FULL);
  // The same folder for both, whatever drive the test itself runs on.
  const where = path.resolve(box.project, '/work/x');
  const { text, notes } = renderPrompt(box.project, { where });
  assert.equal(text, run(box, 'prompt', 'show', '--where', where).out);
  assert.deepEqual(notes, []);
  box.cleanup();
});
