import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { presentChecks } from '../lib/doctor.mjs';
import { markRun } from '../lib/eval/blind.mjs';
import { ASK, routingReport, scoreRouting, WRONG_SHOWN } from '../lib/eval/routing.mjs';
import { controlWords } from '../lib/eval/tally.mjs';
import { duration, plural, shellPath, wrap } from '../lib/eval/words.mjs';
import { bakeoff, folder, judge, ON, ORDERS, OFF, recordModels, sees } from './bakeoff-helpers.mjs';
import { cli, ROOT, sandbox } from './helpers.mjs';

// A path as the commands write it, with / on every system.
const fwd = (p) => p.replaceAll('\\', '/');

test('a path in a command is quoted when a shell would split or expand it, and not when it would not', () => {
  assert.equal(shellPath('/work/bake-off/arms'), '/work/bake-off/arms');
  assert.equal(shellPath('/work/with space/arms'), "'/work/with space/arms'");
  assert.equal(shellPath("/work/it's"), "'/work/it'\\''s'");
  assert.equal(shellPath('/Users/RUNNER~1/bake'), '/Users/RUNNER~1/bake', 'a short Windows folder name needs no quotes');
  assert.equal(shellPath('~/bake'), "'~/bake'", 'a path that starts with ~ would be expanded by sh');
  if (process.platform === 'win32') assert.equal(shellPath('C:\\Users\\me\\bake'), 'C:/Users/me/bake', 'on Windows the path is written with slashes');
});

// What a person sees in the terminal and in the help. The numbers are tested elsewhere. These tests read the words.
const ev = (box, ...args) => cli(['eval', ...args], { cwd: box.project, env: box.env });
// A path is as long as the folder it names, so the lines that carry one are left out.
const widest = (text, skip = '/') => Math.max(...text.split('\n').filter((line) => !line.includes(skip)).map((line) => line.length));

test('score prints a screen for a person, not the report file: counts, a verdict line, one bullet for each reason, no table, and where the whole report is', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, sees(() => ON));
  const ahead = ev(box, 'bakeoff', 'score', dir);
  assert.equal(ahead.code, 0, ahead.err);
  assert.match(ahead.out, /^Bake-off in /);
  assert.match(ahead.out, /\nskill-on won 6 of 6 pairs, skill-off won 0, 0 tied\.\n/);
  assert.match(ahead.out, /\nVerdict: skill-on is ahead\. 6 decisive pairs, exact two-sided sign test p = 0\.03125\.\n/);
  assert.match(ahead.out, /\nControls: the judge passed both\.\n/);
  assert.match(ahead.out, /\nMedian time: skill-off 10 min, skill-on 10 min\.\n/);
  assert.match(ahead.out, new RegExp(`\\nThe whole report, with the interval, the models and the limits: ${path.join(dir, 'report.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  assert.doesNotMatch(ahead.out, /^\||^#|\*\*/m, 'no markdown source on a terminal');
  assert.ok(widest(ahead.out, dir) <= 110, `no line wider than a terminal can show, got ${widest(ahead.out, dir)}`);
  assert.match(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), /\| pair \| brief \| result \|/, 'the file keeps the table');
  assert.match(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), /Key hash [0-9a-f]{64}\. Protocol text hash [0-9a-f]{16}, the hash of evals\/PROTOCOL\.md when this run was made\./, 'the report names the protocol text the run was made under');
  box.cleanup();

  const typed = sandbox();
  const made = bakeoff(typed, { n: 6, record: false });
  recordModels(made.dir, made.briefs, { typed: true });
  judge(made.dir, sees(() => ON));
  const withheld = ev(typed, 'bakeoff', 'score', made.dir);
  assert.equal(withheld.code, 2, 'a withheld verdict is not a success');
  assert.match(withheld.out, /\nVerdict: withheld\. No verdict can be printed, because:\n  - the model of 13 of 13 records /);
  assert.match(withheld.out.replace(/\s+/g, ' '), /backs it, so a lead for skill-on would be a claim about a model nobody checked\. Record each run with mark <key> stop --receipt <file>\./, 'the reason is whole, wrapped across lines');
  assert.match(withheld.out, /because:\n  - .*\n    \S/, 'and the continuation lines sit under the bullet');
  assert.ok(widest(withheld.out, made.dir) <= 110, `wrapped, got ${widest(withheld.out, made.dir)}`);
  assert.equal(JSON.parse(ev(typed, 'bakeoff', 'score', made.dir, '--json').out).verdict.withheld, true);
  typed.cleanup();
});

test('a score with no verdicts in says what is missing and prints no empty table, in the terminal and in the file', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 2 });
  const none = ev(box, 'bakeoff', 'score', dir);
  assert.equal(none.code, 2);
  assert.match(none.out, /\nNo pair has both its verdicts yet\.\nNext: judge pair-\d\d-o\d, pair-\d\d-o\d, pair-\d\d-o\d, and 5 more folders\. `100x eval bakeoff status \S+` lists them all and the command for each\.\n/);
  const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
  assert.doesNotMatch(report, /\| pair \| brief \| result \|/, 'a table with no rows is not printed');
  assert.doesNotMatch(report, /\| control \| what it is \| result \|/);
  assert.match(report, /No pair has both its verdicts yet\. Missing: pair-\d\d-o\d, pair-\d\d-o\d, pair-\d\d-o\d, and 5 more\./);
  assert.match(report, /No control has both its verdicts yet\./);
  box.cleanup();
});

test('status lists the runs in the order to run them and says so, names the judge folders still waiting, and gives a short run in seconds', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 2, pairs: false, record: false });
  const start = new Date('2026-11-20T10:00:00Z');
  markRun(dir, { key: 'brief-1/skill-off', action: 'start', now: start, model: 'm', source: 'self' });
  markRun(dir, { key: 'brief-1/skill-off', action: 'stop', now: new Date(start.getTime() + 12_000), ran: 'm' });
  const before = ev(box, 'bakeoff', 'status', dir).out;
  assert.match(before, /Arms skill-off and skill-on, 2 briefs, seed 11\. The runs are listed in the order to run them\./);
  assert.match(before, /brief-1\/skill-off +index\.html there, 12 s/);
  assert.doesNotMatch(before, / 0 min\b/, 'seconds are not zero minutes');

  fs.mkdirSync(path.join(dir, '.build-abc123'));
  assert.match(ev(box, 'bakeoff', 'status', dir).out, /An earlier pairs run was interrupted and left \.build-abc123\. No key was sealed\. Delete it and run pairs again\./);
  fs.rmdirSync(path.join(dir, '.build-abc123'));

  const one = bakeoff(sandbox(), { n: 1, pairs: false });
  assert.match(ev(box, 'bakeoff', 'status', one.dir).out, /, 1 brief, seed/, 'one brief, not 1 briefs');

  const built = bakeoff(box, { n: 2, where: path.join(box.dir, 'second') });
  judge(built.dir, sees(() => ON));
  fs.rmSync(path.join(built.dir, 'judge', 'pair-02-o1', 'verdict.json'));
  fs.rmSync(path.join(built.dir, 'judge', 'pair-03-o2', 'verdict.json'));
  const ask = fs.readFileSync(path.join(built.dir, 'judge', 'pair-01-o1', 'ask.md'), 'utf8');
  assert.match(ask, /No screenshots were taken, so the pages are all there is to see\./, 'built with --no-capture, the judge is not told to look for any');
  assert.doesNotMatch(ask, /A screens folder/);
  const mid = ev(box, 'bakeoff', 'status', built.dir).out;
  assert.match(mid, /Pairs built and the key is sealed\. 6 of 8 verdicts are in\./);
  assert.match(mid, /Waiting: pair-02-o1, pair-03-o2\./, 'the folders that are missing, by name');
  box.cleanup();
});

test('the help teaches the first minute and each command prints only its own page', () => {
  const box = sandbox();
  const top = ev(box, '--help');
  assert.equal(top.code, 0, top.err);
  assert.match(top.out, /Two things to try first\./);
  assert.match(top.out, /100x eval triggers score --bundle <run\.json>/, 'the one-second replay leads');
  assert.match(top.out, /1\. 100x eval bakeoff init[\s\S]*6\. 100x eval bakeoff gallery/, 'the bake-off in order');
  assert.ok(top.out.split('\n').length < 45, `a screen and a bit, not a wall: ${top.out.split('\n').length} lines`);
  assert.doesNotMatch(top.out, /holdout was written by a model/, 'the rules are behind a pointer');
  assert.match(top.out, /evals\/PROTOCOL\.md/);
  assert.equal(ev(box, 'help').out.includes('Two things to try first.'), true, '`100x eval help` is `100x eval --help`');
  assert.equal(ev(box).out.includes('Two things to try first.'), true, 'and so is a bare `100x eval`');

  const score = cli(['eval', 'bakeoff', 'score', '--help'], { cwd: box.project, env: box.env }).out;
  assert.match(score, /100x eval bakeoff score <dir> \[--json\] \[--no-write\]/);
  assert.match(score, /Exit codes\. 0 when it printed a verdict/);
  assert.doesNotMatch(score, /holdout|ollama|--blank-missing/, 'the page for score is the page for score');
  assert.ok(score.split('\n').length < 25);
  const routing = cli(['eval', 'triggers', '--help'], { cwd: box.project, env: box.env }).out;
  assert.match(routing, /holdout was written by a model/);
  assert.doesNotMatch(routing, /bakeoff/i);
  assert.match(cli(['help', 'eval', 'bakeoff', 'mark'], { cwd: box.project, env: box.env }).out, /refuses a receipt that was not signed/);

  const version = ev(box, '--version');
  assert.equal(version.code, 1);
  assert.match(version.err, /has no version of its own\. `100x --version` prints it\./);
  const flag = ev(box, 'bakeoff', 'score', '--bogus');
  assert.match(flag.err, /Unknown option '--bogus'\. The flags 100x eval bakeoff score takes are in `100x eval bakeoff score --help`\./);
  assert.doesNotMatch(flag.err, /place it at the end|positional/, 'the runtime\'s own advice is for another job');
  assert.match(ev(box, 'nonsense').err, /takes triggers or bakeoff, and nonsense is neither/);
  box.cleanup();
});

test('every flag the eval commands take is on the page of a command and in the combined usage', async () => {
  const { usage } = await import('../lib/eval/help.mjs');
  const parsed = fs.readFileSync(new URL('../lib/commands/eval.mjs', import.meta.url), 'utf8').match(/options: \{(.*)\n/)[1];
  const flags = [...parsed.matchAll(/(?:^|[ ,{])'?([a-z-]+)'?: \{/g)].map((m) => m[1]);
  assert.ok(flags.length >= 20, `found ${flags.length} flags`);
  for (const flag of flags) assert.ok(usage.includes(`--${flag}`), `--${flag} is in the usage`);
});

test('a routing report prints the whole message for each wrong answer, stops a long list and says how to see the rest, flags a name that is no skill, and glosses the hash', () => {
  const skills = [{ name: 'alpha', description: 'does a' }, { name: 'beta', description: 'does b' }];
  const long = 'We need a polished build with QA and a report and a plain summary of every decision that was made along the way, so please write all of it down for the team.';
  const prompts = [];
  const answers = {};
  for (let i = 1; i <= 40; i += 1) {
    const id = `tune-${String(i).padStart(3, '0')}`;
    prompts.push({ id, set: 'tune', text: i === 1 ? long : `message ${i}`, expect: 'alpha', ...(i === 2 ? { near: 'alpha' } : i === 3 ? { near: 'beta' } : {}) });
    if (i <= 30) answers[id] = 'beta';
  }
  answers['tune-001'] = 'bogus-skill';
  answers['p-001'] = 'alpha';
  const result = scoreRouting({ prompts, distractors: [] }, answers, { set: 'tune', skills });
  assert.equal(result.unanswered, 10);
  assert.deepEqual(result.unlisted, [{ id: 'tune-001', answered: 'bogus-skill' }]);
  assert.deepEqual(result.unmatched, ['p-001']);
  assert.equal(result.wrong.length, 40, '--json carries every miss');

  const text = routingReport(result);
  const flat = text.replace(/\s+/g, ' ');
  assert.match(text, /Descriptions [0-9a-f]{12} \(a hash of the descriptions scored\)\./);
  assert.ok(text.replace(/\s+/g, ' ').includes(long), 'the whole message, wrapped and not cut at 87 characters');
  assert.doesNotMatch(text, /\.\.\."/);
  assert.match(flat, /1 answer named no skill in the list and scored as a miss, so a typo reads as a wrong pick: tune-001 "bogus-skill"\./);
  assert.match(flat, /1 id in the answers matches no message in the tune set \("p-001"\)\. Check that the answers are keyed by the ids in prompts\.json\./);
  assert.equal([...text.matchAll(/^tune-\d{3} /gm)].length, WRONG_SHOWN);
  assert.match(text, new RegExp(`and ${30 - WRONG_SHOWN} more wrong answers\\. --all lists every one, and --json carries them\\.`));
  assert.match(text, /10 messages have no answer\. --all lists them\./);
  assert.match(text, /needed alpha, answered beta, written to be confused with alpha/);
  assert.match(text, /needed alpha, answered beta, the near-miss this message was written to test/);
  assert.ok(widest(text, 'Routing, tune set') <= 110, 'the headline is one line, and the rest is wrapped');

  const everything = routingReport(result, { all: true });
  assert.equal([...everything.matchAll(/^tune-\d{3} /gm)].length, 40);
  assert.doesNotMatch(everything, /more wrong answers/);
  assert.match(everything, /needed alpha, answered nothing/);
});

test('a count and a time are said once, in one way', () => {
  assert.equal(plural(1, 'pair'), '1 pair');
  assert.equal(plural(0, 'pair'), '0 pairs');
  assert.equal(plural(2, 'decisive pair'), '2 decisive pairs');
  assert.equal(plural(1, 'is', 'are'), '1 is');
  assert.equal(duration(0.01), '1 s');
  assert.equal(duration(0), 'under 1 s');
  assert.equal(duration(0.5), '30 s');
  assert.equal(duration(5.25), '5.3 min');
  assert.equal(duration(20), '20 min');
  assert.equal(duration(67.4), '67 min');
  assert.equal(duration(undefined), 'not recorded');
  assert.equal(wrap('one two three four', { width: 9, indent: '  ' }), 'one two\n  three\n  four');
});

test('doctor puts a judge warning first, folds skill links that fail alike into one row, and ends with a tally', () => {
  const fix = 'Run scripts/install.sh from the 100x repo.';
  const checks = [
    { status: 'ok', name: 'node', detail: 'v26' },
    ...['a', 'b', 'c', 'd'].map((name) => ({ status: 'fail', name: `skill ${name}`, detail: `/skills/${name} is conflict`, fix })),
    { status: 'warn', name: 'skill e', detail: '/skills/e is missing', fix },
    { status: 'warn', name: 'judge ran', detail: 'no helper ran the judge model', fix: 'Start the judge as a command.' },
    { status: 'ok', name: 'judge', detail: 'a model' },
  ];
  const { first, rows, tally } = presentChecks(checks);
  assert.deepEqual(first.map((c) => c.name), ['judge ran']);
  const skills = rows.find((c) => c.name === 'skills');
  assert.equal(skills.status, 'fail');
  assert.equal(skills.detail, '4 skills show "conflict": a, b, c, d');
  assert.ok(rows.some((c) => c.name === 'skill e'), 'one that fails differently stays as it is');
  assert.equal(rows.filter((c) => c.name.startsWith('skill ') && c.name !== 'skill e').length, 0);
  assert.equal(tally, '1 fail, 2 warn, 2 ok.');
  const shell = sandbox();
  const full = cli(['doctor', '--json'], { cwd: shell.project, env: shell.env });
  assert.ok(JSON.parse(full.out).length >= 5, '--json keeps every check');
  shell.cleanup();
});

test('the routing ask.md shows the answer format with the ids that were staged', () => {
  assert.match(ASK(2, 5, ['tune-001', 'hold-017']), /\{ "tune-001": "some-skill", "hold-017": "none" \}/);
  assert.match(ASK(0, 5), /\{ "p-001": "some-skill", "p-002": "none" \}/, 'a stand-in only when there is nothing staged');
  const box = sandbox();
  const out = path.join(box.dir, 'staged');
  assert.equal(ev(box, 'triggers', 'stage', out).code, 0);
  const ids = JSON.parse(fs.readFileSync(path.join(out, 'prompts.json'), 'utf8')).map((prompt) => prompt.id);
  assert.ok(fs.readFileSync(path.join(out, 'ask.md'), 'utf8').includes(`{ "${ids[0]}": "some-skill", "${ids[1]}": "none" }`));
  box.cleanup();
});

test('status prints the next step as commands that run as they stand, lists every waiting folder, and a score with no key points at status', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 2, pairs: false });
  const keyless = ev(box, 'bakeoff', 'score', dir);
  assert.equal(keyless.code, 1);
  assert.match(keyless.err, /No key yet, so there is nothing to score\. `100x eval bakeoff status \S+` says what to run next\./);
  assert.match(ev(box, 'bakeoff', 'gallery', dir, '--out', path.join(box.dir, 'g')).err, /status \S+` says what to run next/);

  const built = bakeoff(box, { n: 2, where: path.join(box.dir, 'second') });
  const waiting = ev(box, 'bakeoff', 'status', built.dir).out;
  const block = waiting.slice(waiting.indexOf('Waiting:'), waiting.indexOf('For pair-'));
  for (let n = 1; n <= 4; n += 1) for (const order of ORDERS) assert.equal(block.split(`pair-0${n}-${order}`).length, 2, `pair-0${n}-${order} is listed once`);
  assert.ok(!/ and \d+ more/.test(block), 'a list that says "and 12 more" cannot be copied');
  assert.match(waiting, new RegExp(`\\nFor pair-0\\d-o\\d, then for each of the others:\\n {2}100x helper run --model <model id> --effort <level> --context <size> --cwd ${fwd(built.dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/judge/pair-0\\d-o\\d --minutes 30 --receipt \\S+/helper-receipts/pair-0\\d-o\\d\\.json --json --task "Open this folder and follow ask\\.md in it\\."\\n {2}100x eval bakeoff mark \\S+ judge/pair-0\\d-o\\d stop --receipt \\S+\\.json\\n?$`), 'the judge command is whole');

  const spaced = path.join(box.dir, 'with space');
  const odd = bakeoff(box, { n: 1, pairs: false, where: spaced });
  assert.match(ev(box, 'bakeoff', 'status', odd.dir).out, /Next: 100x eval bakeoff pairs '[^']*with space[^']*'\./, 'a path with a space is quoted so the command can be pasted');
  box.cleanup();
});

test('help after the area is its page, an unknown word names the area help, and a bare area asks for a command', () => {
  const box = sandbox();
  for (const area of ['bakeoff', 'triggers']) {
    const page = ev(box, area, 'help');
    assert.equal(page.code, 0, page.err);
    assert.equal(page.out, ev(box, area, '--help').out.split('\n\n').slice(2).join('\n\n'), `${area} help is the page ${area} --help shows`);
    const nonsense = ev(box, area, 'nope');
    assert.equal(nonsense.code, 1);
    assert.match(nonsense.err, new RegExp(`100x eval ${area} has no command called nope: .*Run \`100x eval ${area} --help\``));
    assert.match(ev(box, area).err, new RegExp(`100x eval ${area} needs a command: .*Run \`100x eval ${area} --help\``));
  }
  box.cleanup();
});

test('a control says what the judge did in the words of what it was asked, and a flip on the identical page is not called a pass with no reason', () => {
  assert.equal(controlWords({ kind: 'planted', pass: true, outcome: 'win', winner: 'intact' }), 'passed (picked the intact page in both orders)');
  assert.equal(controlWords({ kind: 'planted', pass: false, outcome: 'win', winner: 'blurred' }), 'failed (picked the blurred page in both orders)');
  assert.equal(controlWords({ kind: 'planted', pass: false, outcome: 'tie' }), 'failed (no winner)');
  assert.equal(controlWords({ kind: 'identical', pass: true, outcome: 'tie' }), 'passed (no winner)');
  assert.equal(controlWords({ kind: 'identical', pass: true, outcome: 'flip' }), 'passed (picked by place, not by page)');
  assert.equal(controlWords({ kind: 'identical', pass: false, outcome: 'win', winner: 'copy-1' }), 'failed (picked one of two identical pages in both orders)');
});

test('the report opens with the counts, the verdict and a bullet for each reason or caution, and the screen uses the same words', () => {
  const box = sandbox();
  const made = bakeoff(box, { n: 6, record: false });
  recordModels(made.dir, made.briefs, { typed: true });
  judge(made.dir, sees(() => ON));
  const screen = ev(box, 'bakeoff', 'score', made.dir);
  const report = fs.readFileSync(path.join(made.dir, 'report.md'), 'utf8');
  assert.match(report, /^# Bake-off report\n\nskill-on won 6 of 6 pairs, skill-off won 0, 0 tied\.\n\n\*\*Verdict:\*\* withheld\. No verdict can be printed, because:\n\n- the model of 13 of 13 records [^\n]*\.\n\nThe word is "ahead" only with/, 'a sentence of counts, a verdict line, then one bullet, and not one 90-word line');
  assert.ok(Math.max(...report.split('\n').slice(0, 9).filter((line) => !line.startsWith('- ')).map((line) => line.length)) <= 200, 'no opening line runs on');
  const flat = screen.out.replace(/\s+/g, ' ');
  for (const [, bullet] of report.matchAll(/^- (the model of 13 of 13 records.*)\.$/gm)) assert.ok(flat.includes(bullet.replace(/\s+/g, ' ')), 'the screen says what the report says');
  box.cleanup();

  // Two decisive pairs cannot lead, so nothing is withheld, and the typed model names are a caution under the verdict.
  const few = sandbox();
  const small = bakeoff(few, { n: 2, record: false });
  recordModels(small.dir, small.briefs, { typed: true });
  judge(small.dir, sees(() => ON));
  const shown = ev(few, 'bakeoff', 'score', small.dir);
  assert.equal(shown.code, 0, shown.err);
  const smallReport = fs.readFileSync(path.join(small.dir, 'report.md'), 'utf8');
  const [, caution] = /\*\*Caution:\*\*\n\n- (the model of [^\n]*typed by hand[^\n]*)\.\n/.exec(smallReport) ?? [];
  assert.ok(caution, 'the report carries a caution as a bullet under the verdict');
  assert.match(smallReport, /\*\*Verdict:\*\* not shown\. 2 decisive pairs, 6 are needed\.\n\n\*\*Caution:\*\*/);
  assert.ok(shown.out.replace(/\s+/g, ' ').includes(`Caution: - ${caution}.`), 'and the screen says the same under its Verdict line');
  few.cleanup();
});

test('the routing screen puts the wrong answers before the table, and says what each column of the table counts', () => {
  const skills = [{ name: 'alpha', description: 'one' }, { name: 'beta', description: 'two' }];
  const prompts = { prompts: [{ id: 'tune-001', set: 'tune', text: 'a message', expect: 'alpha', class: 'expect' }, { id: 'tune-002', set: 'tune', text: 'another', expect: 'beta', class: 'expect' }], distractors: [] };
  const result = scoreRouting(prompts, { 'tune-001': 'beta', 'tune-002': 'beta' }, { set: 'tune', skills });
  const text = routingReport(result);
  assert.ok(text.indexOf('Wrong answers') < text.indexOf('Per skill.'), 'what to fix comes before the table of every skill');
  assert.match(text.replace(/\s+/g, ' '), /Per skill\. expected: messages that needed it\. answered: times it was picked\. precision: of the picks, the share that were right\. recall: of the messages that needed it, the share it got\. A dash means it was never picked\./);
  assert.ok(text.indexOf('Per skill.') < text.indexOf('class '), 'and the words come before the columns they explain');
});

test('an answers file that answers none of the tune messages is refused, as it is for the holdout', () => {
  const box = sandbox();
  const file = path.join(box.dir, 'answers.json');
  fs.writeFileSync(file, JSON.stringify({ 'nothing-001': 'alpha' }));
  const refused = ev(box, 'triggers', 'score', file);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /None of the \d+ messages in the tune set has an answer in .*answers\.json\. Check that the file answers the tune set\.$/m);
  assert.doesNotMatch(refused.err, /holdout/, 'no look at the holdout is in question for the tune set');
  box.cleanup();
});

test('the mutation script prints its usage for --help and for a flag it does not know, and not a stack trace', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'eval-mutations.mjs'), ...args], { encoding: 'utf8' });
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^node scripts\/eval-mutations\.mjs \[--list\] \[--only <name>\]\.\.\. \[--help\]\n {2}--list /);
  const unknown = run('--nope');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown option '--nope'\.\nnode scripts\/eval-mutations\.mjs/);
  assert.doesNotMatch(unknown.stderr, /\bat .*node:internal|ERR_PARSE_ARGS/, 'no stack from node internals');
  assert.ok(run('--list').stdout.split('\n').filter(Boolean).length > 100, '--list still lists the bugs');
});
