import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { markRun } from '../lib/eval/blind.mjs';
import { ARMS, bakeoff, folder, judge, keyOf, makeReceipt, ON, OFF, ORDERS, page, recordModels, sees, split } from './bakeoff-helpers.mjs';
import { browserSkip, cli, ROOT, sandbox, write } from './helpers.mjs';

const score = (box, dir) => cli(['eval', 'bakeoff', 'score', dir, '--json'], { cwd: box.project, env: box.env });
// Every score in this file also checks the exit code: 2 when the verdict was withheld, 0 when one was printed, whatever it said.
const scored = (box, dir) => {
  const result = score(box, dir);
  const parsed = JSON.parse(result.out);
  assert.equal(result.code, parsed.verdict.withheld ? 2 : 0, result.err);
  return parsed;
};

test('init makes a task per brief and arm that differ only in the method note, and refuses repeated ids, a third arm and an existing folder', () => {
  const box = sandbox();
  write(path.join(box.dir, 'method.md'), 'Follow the mockup skill.\n');
  const briefs = [{ id: 'a', title: 'A', text: 'Make a clock.' }, { id: 'b', title: 'B', text: 'Make a map.' }];
  write(path.join(box.dir, 'briefs.json'), JSON.stringify(briefs));
  const dir = path.join(box.dir, 'made');
  const made = cli(['eval', 'bakeoff', 'init', dir, '--briefs', path.join(box.dir, 'briefs.json'), '--note', `${ON}=${path.join(box.dir, 'method.md')}`, '--minutes', '20'], { cwd: box.project, env: box.env });
  assert.equal(made.code, 0, made.err);
  assert.match(made.out, /Each task names the folder its arm works in, arm-1 for skill-off and arm-2 for skill-on/);
  assert.match(made.out, /Heads up: the path to this folder holds 100x, and the tasks and the judge see it\./);
  const off = fs.readFileSync(path.join(dir, 'tasks', `a--${OFF}.md`), 'utf8');
  const on = fs.readFileSync(path.join(dir, 'tasks', `a--${ON}.md`), 'utf8');
  assert.match(on, /## Method\nFollow the mockup skill\./);
  assert.doesNotMatch(off, /## Method/, 'the control arm has no method paragraph, and its folder is called arm-1');
  assert.match(off, /Use no skill from your list of installed skills, and open no SKILL\.md file except one that a Method section below names\./);
  assert.match(on, /Use no skill from your list of installed skills, and open no SKILL\.md file except one that a Method section below names\./, 'both arms are told the same thing about skills');
  assert.match(off, /\/arms\/a\/arm-1\./);
  assert.match(on, /\/arms\/a\/arm-2\./);
  const strip = (text) => text.replace(/\n## Method[\s\S]*$/, '').replace(/\/arms\/a\/arm-[12]\./, '/arms/a/ARM.');
  assert.equal(strip(on), strip(off), 'the same brief, the same minutes, the same deliverable');
  assert.match(off, /You have 20 minutes/);
  assert.ok(fs.existsSync(folder(dir, 'b', ON)));
  const run = (...args) => cli(['eval', 'bakeoff', 'init', ...args], { cwd: box.project, env: box.env });
  assert.match(run(dir, '--briefs', path.join(box.dir, 'briefs.json')).err, /already holds a bake-off/);
  assert.match(run(path.join(box.dir, 'x'), '--briefs', path.join(box.dir, 'briefs.json'), '--arms', 'a,b,c').err, /exactly two arms/);
  write(path.join(box.dir, 'twice.json'), JSON.stringify([{ id: 'a', title: 'A', text: 't' }, { id: 'a', title: 'A', text: 't' }]));
  assert.match(run(path.join(box.dir, 'y'), '--briefs', path.join(box.dir, 'twice.json')).err, /Brief id a appears twice/);
  box.cleanup();
});

test('pairs builds each pair twice with the sides swapped, adds both controls, seals the key outside the judge folders, and the same seed draws the same key', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6, seed: 5 });
  const key = keyOf(dir);
  assert.equal(key.items.length, 8, '6 real pairs and 2 controls');
  assert.deepEqual(key.items.map((i) => i.kind).sort(), ['identical', 'planted', ...Array(6).fill('real')].sort());
  assert.deepEqual(key.items.map((i) => i.id), Array.from({ length: 8 }, (_, i) => `pair-0${i + 1}`), 'numbered after the shuffle, so the number gives nothing away');
  const packs = fs.readdirSync(path.join(dir, 'judge')).sort();
  assert.equal(packs.length, 16);
  for (const pack of packs) assert.deepEqual(fs.readdirSync(path.join(dir, 'judge', pack)).sort(), ['A', 'B', 'ask.md']);
  const real = key.items.find((i) => i.kind === 'real');
  const read = (pack, side) => fs.readFileSync(path.join(dir, 'judge', pack, side, 'index.html'), 'utf8');
  assert.equal(read(`${real.id}-o1`, 'A'), read(`${real.id}-o2`, 'B'), 'the page in A in the first order is in B in the second');
  assert.equal(read(`${real.id}-o1`, 'B'), read(`${real.id}-o2`, 'A'));
  assert.notEqual(read(`${real.id}-o1`, 'A'), read(`${real.id}-o1`, 'B'));
  const sealed = fs.readFileSync(path.join(dir, 'key.sha256'), 'utf8').trim().split(/\s+/)[0];
  assert.equal(sealed, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'key.json'))).digest('hex'));
  assert.ok(!path.join(dir, 'key.json').startsWith(path.join(dir, 'judge')), 'the key is not in a folder a judge is pointed at');
  const all = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(folder, e.name)) : [path.join(folder, e.name)]));
  for (const file of all(path.join(dir, 'judge'))) {
    assert.doesNotMatch(path.relative(dir, file), /RUN\.md|TASK\.md|key|sha256/, 'the files an arm writes about itself are not handed over');
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /skill-o(n|ff)|100x|bake-?off/i, `${file} names an arm or the skill`);
  }
  const again = sandbox();
  const second = bakeoff(again, { n: 6, seed: 5 });
  assert.equal(fs.readFileSync(path.join(second.dir, 'key.json'), 'utf8'), fs.readFileSync(path.join(dir, 'key.json'), 'utf8'), 'the same seed redraws the same key');
  const other = sandbox();
  const third = bakeoff(other, { n: 6, seed: 6 });
  assert.notEqual(fs.readFileSync(path.join(third.dir, 'key.sha256'), 'utf8'), fs.readFileSync(path.join(dir, 'key.sha256'), 'utf8'));
  const twice = cli(['eval', 'bakeoff', 'pairs', dir, '--no-capture'], { cwd: box.project, env: box.env });
  assert.equal(twice.code, 1);
  assert.match(twice.err, /already built and the key is sealed/);
  for (const b of [box, again, other]) b.cleanup();
});

test('the planted control is a page beside a blurred copy of itself and the identical control is one page twice', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 3, seed: 2 });
  const key = keyOf(dir);
  const planted = key.items.find((i) => i.kind === 'planted');
  const identical = key.items.find((i) => i.kind === 'identical');
  const html = (item, order, side) => fs.readFileSync(path.join(dir, 'judge', `${item.id}-${order}`, side, 'index.html'), 'utf8');
  const [a, b] = [html(planted, 'o1', 'A'), html(planted, 'o1', 'B')];
  const [blurred, intact] = a.includes('blur(6px)') ? [a, b] : [b, a];
  assert.ok(blurred.includes('<style>html{filter:blur(6px)!important}</style>'));
  assert.equal(blurred.replace('<style>html{filter:blur(6px)!important}</style>', ''), intact, 'the copy differs from the page by the blur and nothing else');
  assert.equal(html(identical, 'o1', 'A'), html(identical, 'o1', 'B'));
  box.cleanup();
});

test('pairs refuses and names the file and line when an arm folder carries an arm name or the skill, writes no key, and passes on a clean copy', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 3, pairs: false });
  const target = path.join(folder(dir, briefs[1].id, OFF), 'index.html');
  const clean = fs.readFileSync(target, 'utf8');
  const attempt = (...extra) => cli(['eval', 'bakeoff', 'pairs', dir, '--no-capture', ...extra], { cwd: box.project, env: box.env });
  fs.writeFileSync(target, clean.replace('<body>', `<body>\n<!-- built by the ${OFF} agent -->`));
  const refused = attempt();
  assert.equal(refused.code, 1);
  assert.match(refused.err, /The blind is broken\. A judge would see the skill or an arm named in 1 place:/, 'one file in the arm folder, however many judge folders hold it');
  const named = refused.err.match(new RegExp(`(arms/\\S+/arm-\\d/index\\.html):\\d+ +<!-- built by the ${OFF} agent -->.*  \\(in 2 judge folders\\)`));
  assert.ok(named, `the line names the file to fix in the arm folder and how many judge folders carry it: ${refused.err}`);
  assert.equal(path.join(dir, named[1]), target, 'and that path is the file to edit');
  assert.ok(!fs.existsSync(path.join(dir, 'key.json')), 'a refused build leaves no key');
  assert.ok(!fs.existsSync(path.join(dir, 'judge')), 'and no judge folder');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.build-')), [], 'and no half built work');
  fs.writeFileSync(target, clean);
  write(path.join(folder(dir, briefs[0].id, ON), 'app.js'), 'console.log("made with 100x");\n');
  assert.match(attempt().err, /app\.js:1 +console\.log\("made with 100x"\)/);
  fs.rmSync(path.join(folder(dir, briefs[0].id, ON), 'app.js'));
  write(path.join(folder(dir, briefs[0].id, ON), '100x-notes.txt'), 'hello\n');
  assert.match(attempt().err, /100x-notes\.txt {2}the file name holds "100x"/);
  fs.rmSync(path.join(folder(dir, briefs[0].id, ON), '100x-notes.txt'));
  write(path.join(folder(dir, briefs[2].id, ON), 'SKILL.md'), '# a skill\n');
  assert.match(attempt().err, /SKILL\.md {2}the file name holds "SKILL\.md"/);
  fs.rmSync(path.join(folder(dir, briefs[2].id, ON), 'SKILL.md'));
  fs.writeFileSync(target, clean.replace('<h1>', `<h1>The ${OFF} look: `));
  assert.equal(attempt().code, 1);
  const allowed = attempt('--allow', OFF);
  assert.equal(allowed.code, 0, allowed.err);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'leakscan.json'), 'utf8')).allowed, [OFF], 'what was let through is written down');
  box.cleanup();
  const second = sandbox();
  const fresh = bakeoff(second, { n: 3 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(fresh.dir, 'leakscan.json'), 'utf8')).ok, true);
  second.cleanup();
});

test('ordinary English that happens to hold the word plain, off or on is not a leak', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 2, pairs: false });
  const target = path.join(folder(dir, briefs[0].id, OFF), 'index.html');
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('<body>', '<body><p>A plain page. Switch the skill on or off, turn skills on and off.</p>'));
  const built = cli(['eval', 'bakeoff', 'pairs', dir, '--no-capture'], { cwd: box.project, env: box.env });
  assert.equal(built.code, 0, built.err);
  box.cleanup();
});

test('pairs refuses while an arm folder has no index.html and names it', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 2, pairs: false });
  fs.rmSync(path.join(folder(dir, briefs[1].id, ON), 'index.html'));
  const refused = cli(['eval', 'bakeoff', 'pairs', dir, '--no-capture'], { cwd: box.project, env: box.env });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /have no index\.html yet:\n.*brief-2\/arm-2\/index\.html/);
  box.cleanup();
});

test('words in the path to the judge folders are said at build time and listed in the report, and a neutral path says nothing', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 2, pairs: false });
  const built = cli(['eval', 'bakeoff', 'pairs', dir, '--no-capture'], { cwd: box.project, env: box.env });
  assert.match(built.out, /Heads up: the path to the judge folders holds 100x, and a judge sees its path\./);
  judge(dir, sees(() => ON));
  assert.deepEqual(scored(box, dir).pathWords, ['100x']);
  assert.match(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), /The path to the judge folders holds 100x\. A judge sees its own path/);
  box.cleanup();

  const neutral = fs.mkdtempSync(path.join(os.tmpdir(), 'blind-'));
  const quiet = sandbox();
  try {
    const run = bakeoff(quiet, { n: 2, pairs: false, where: path.join(neutral, 'run') });
    const ok = cli(['eval', 'bakeoff', 'pairs', run.dir, '--no-capture'], { cwd: quiet.project, env: quiet.env });
    assert.doesNotMatch(ok.out, /Heads up/);
    judge(run.dir, sees(() => ON));
    assert.deepEqual(scored(quiet, run.dir).pathWords, []);
    assert.doesNotMatch(fs.readFileSync(path.join(run.dir, 'report.md'), 'utf8'), /path to the judge folders/);
  } finally {
    fs.rmSync(neutral, { recursive: true, force: true });
    quiet.cleanup();
  }
});

test('6 pairs all won by one arm is ahead, with p = 0.03125 and the interval worked by hand', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, sees(() => ON));
  const result = scored(box, dir);
  assert.deepEqual(result.wins, { [OFF]: 0, [ON]: 6 });
  assert.equal(result.decisive, 6);
  assert.equal(result.ties, 0);
  assert.equal(result.flips, 0);
  assert.equal(result.p, 0.03125);
  assert.ok(Math.abs(result.interval[0] - 0.6097) < 1e-4 && result.interval[1] === 1);
  assert.equal(result.judgeTrusted, true);
  assert.equal(result.verdict.word, 'ahead');
  assert.equal(result.verdict.arm, ON);
  assert.equal(result.headline, `${ON} won 6 of 6 pairs, ${OFF} won 0, 0 tied. ${ON} is ahead: 6 decisive pairs, exact two-sided sign test p = 0.03125.`);
  const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
  assert.match(report, new RegExp(`^# Bake-off report\\n\\n${ON} won 6 of 6 pairs, ${OFF} won 0, 0 tied\\.\\n\\n\\*\\*Verdict:\\*\\* ${ON} is ahead\\. 6 decisive pairs, exact two-sided sign test p = 0\\.03125\\.\\n\\n`), 'the report opens with the counts and the verdict, each on its own line');
  assert.match(report, /Exact two-sided sign test p = 0\.03125\. 95% Wilson interval for that share, 0\.610 to 1\.000\./);
  assert.match(report, /The judge passed both controls\./);
  assert.match(report, /## Limits/);
  assert.match(report, /6 real pairs\. A sign test cannot go under 0\.05 with fewer than 6 decisive pairs/);
  assert.ok(fs.existsSync(path.join(dir, 'result.json')));
  box.cleanup();
});

test('5 pairs all won by one arm is not shown, p = 0.0625, and the reason is the count', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 5 });
  judge(dir, sees(() => ON));
  const result = scored(box, dir);
  assert.equal(result.p, 0.0625);
  assert.equal(result.verdict.word, 'not shown');
  assert.equal(result.verdict.withheld, false);
  assert.deepEqual(result.verdict.reasons, ['5 decisive pairs, 6 are needed']);
  assert.equal(result.headline, `${ON} won 5 of 5 pairs, ${OFF} won 0, 0 tied. Not shown: 5 decisive pairs, 6 are needed.`);
  box.cleanup();
});

test('a lead that the sign test cannot call is not shown: 5 to 1 and 7 to 1 are not, 8 to 0 is', () => {
  const run = (n, wins) => {
    const box = sandbox();
    const { dir } = bakeoff(box, { n });
    judge(dir, sees(split(dir, wins)));
    const result = scored(box, dir);
    box.cleanup();
    return result;
  };
  const five = run(6, 5);
  assert.equal(five.p, 0.21875);
  assert.equal(five.verdict.word, 'not shown');
  assert.equal(five.verdict.reasons[0], 'p = 0.21875 over 6 decisive pairs, not under 0.05');
  const seven = run(8, 7);
  assert.equal(seven.p, 0.0703125);
  assert.equal(seven.verdict.word, 'not shown');
  const eight = run(8, 8);
  assert.equal(eight.p, 0.0078125);
  assert.equal(eight.verdict.word, 'ahead');
  const behind = run(8, 0);
  assert.equal(behind.verdict.word, 'ahead', `${OFF} winning every pair is ahead too`);
  assert.equal(behind.verdict.arm, OFF);
  assert.match(behind.headline, new RegExp(`^${OFF} won 8 of 8 pairs, ${ON} won 0, 0 tied\\. ${OFF} is ahead`));
});

test('a pair counts for an arm only when both orders agree: ties and flips are ties, and a flip is counted as one', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  // brief-1 and brief-2 go to skill-on, brief-3 to skill-off, brief-4 is a tie in both orders, brief-5 and brief-6 flip (always A).
  judge(dir, ({ item, sides }) => {
    if (item.kind !== 'real') return sees(() => ON)({ item, sides });
    if (item.brief === 'brief-3') return sides.A === OFF ? 'A' : 'B';
    if (item.brief === 'brief-4') return 'tie';
    if (item.brief === 'brief-5' || item.brief === 'brief-6') return 'A';
    return sides.A === ON ? 'A' : 'B';
  });
  const result = scored(box, dir);
  assert.deepEqual(result.wins, { [OFF]: 1, [ON]: 2 });
  assert.equal(result.ties, 3);
  assert.equal(result.flips, 2);
  assert.equal(result.decisive, 3);
  assert.equal(result.verdict.word, 'not shown');
  assert.equal(result.headline, `${ON} won 2 of 6 pairs, ${OFF} won 1, 3 tied (2 flipped with the order). Not shown: 3 decisive pairs, 6 are needed.`);
  box.cleanup();
});

test('a judge that always says A gives 0 decisive pairs and a position-bias note, and is not trusted', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, () => 'A');
  const result = scored(box, dir);
  assert.equal(result.decisive, 0);
  assert.equal(result.flips, 6);
  assert.deepEqual(result.positionBias, { side: 'A', of: 16, times: 16 });
  assert.equal(result.judgeTrusted, false);
  assert.equal(result.verdict.word, 'not shown');
  assert.equal(result.verdict.withheld, true);
  assert.match(result.verdict.reasons[0], /judge not trusted: it did not pick the intact page over its blurred copy in both orders/);
  const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
  assert.match(report, /Position bias\. The judge said A in 16 of 16 verdicts/);
  assert.match(report, /No pair was decisive, so there is no test to run and no interval\./);
  box.cleanup();
});

test('a judge that only says tie gives not shown, and a judge that cannot see is not trusted whatever it says about the real pairs', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, () => 'tie');
  const ties = scored(box, dir);
  assert.equal(ties.verdict.word, 'not shown');
  assert.equal(ties.decisive, 0);
  assert.equal(ties.ties, 6);
  assert.equal(ties.positionBias, null);
  assert.equal(ties.verdict.withheld, true);
  box.cleanup();

  const blindBox = sandbox();
  const blind = bakeoff(blindBox, { n: 6 });
  // Six clean wins for skill-on on the real pairs, and the blurred page preferred on the planted control.
  judge(blind.dir, ({ item, sides }) => {
    if (item.kind === 'planted') return sides.A === 'blurred' ? 'A' : 'B';
    if (item.kind === 'identical') return 'tie';
    return sides.A === ON ? 'A' : 'B';
  });
  const cannotSee = scored(blindBox, blind.dir);
  assert.equal(cannotSee.wins[ON], 6);
  assert.equal(cannotSee.p, 0.03125, 'the numbers are printed as they are');
  assert.equal(cannotSee.verdict.word, 'not shown', 'and still no lead is called');
  assert.equal(cannotSee.judgeTrusted, false);
  assert.match(cannotSee.headline, /Not shown, and no verdict can be printed: judge not trusted/);
  blindBox.cleanup();

  const pickyBox = sandbox();
  const picky = bakeoff(pickyBox, { n: 6 });
  // A judge that finds a winner between two identical pages, always the one labelled copy-1.
  judge(picky.dir, ({ item, sides }) => {
    if (item.kind === 'identical') return sides.A === 'copy-1' ? 'A' : 'B';
    return sees(() => ON)({ item, sides });
  });
  const invents = scored(pickyBox, picky.dir);
  assert.equal(invents.verdict.word, 'not shown');
  assert.match(invents.verdict.reasons[0], /picked a winner between two identical pages/);
  pickyBox.cleanup();
});

test('score refuses a key whose hash changed, prints no report, and a key sealed after the verdicts is withheld', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, sees(() => ON));
  assert.equal(scored(box, dir).verdict.word, 'ahead');
  fs.rmSync(path.join(dir, 'report.md'));
  const key = keyOf(dir);
  const real = key.items.find((i) => i.kind === 'real');
  [real.first, real.second] = [real.second, real.first];
  fs.writeFileSync(path.join(dir, 'key.json'), `${JSON.stringify(key, null, 2)}\n`);
  const refused = score(box, dir);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /The key changed after it was sealed\. key\.sha256 says [0-9a-f]{64} and key\.json hashes to [0-9a-f]{64}\. No score is printed/);
  assert.ok(!fs.existsSync(path.join(dir, 'report.md')), 'no report after a refusal');
  box.cleanup();

  const late = sandbox();
  const lateRun = bakeoff(late, { n: 6 });
  judge(lateRun.dir, sees(() => ON), { quote: false });
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(lateRun.dir, 'key.sha256'), future, future);
  const result = scored(late, lateRun.dir);
  assert.equal(result.verdict.word, 'not shown');
  assert.match(result.verdict.reasons.join(' '), /a verdict that does not quote the sealed key's hash is older than key\.sha256/);
  late.cleanup();
});

test('a missing or unreadable verdict, or a missing leak scan, withholds the verdict instead of counting what is there', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, sees(() => ON));
  const victim = keyOf(dir).items.find((i) => i.kind === 'real');
  fs.rmSync(path.join(dir, 'judge', `${victim.id}-o2`, 'verdict.json'));
  const missing = scored(box, dir);
  assert.equal(missing.verdict.word, 'not shown');
  assert.equal(missing.verdict.withheld, true);
  assert.match(missing.verdict.reasons[0], new RegExp(`1 verdict is missing or unreadable \\(${victim.id}-o2\\)`));
  write(path.join(dir, 'judge', `${victim.id}-o2`, 'verdict.json'), JSON.stringify({ winner: 'C' }));
  assert.match(scored(box, dir).verdict.reasons[0], /winner is "C", it must be "A", "B" or "tie"/);
  judge(dir, sees(() => ON));
  fs.rmSync(path.join(dir, 'leakscan.json'));
  assert.match(scored(box, dir).verdict.reasons.join(' '), /the leak scan did not pass, so the blind was not checked/);
  box.cleanup();
});

test('mark takes times from the clock, refuses a second start or a stop with no start, and the report shows the median time and the model that ran', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 3, record: false });
  const t0 = new Date('2026-11-20T10:00:00Z');
  const at = (minutes) => new Date(t0.getTime() + minutes * 60_000);
  for (const [brief, minutes] of [['brief-1', 10], ['brief-2', 20], ['brief-3', 30]]) {
    markRun(dir, { key: `${brief}/${ON}`, action: 'start', now: t0, model: 'muse-wonder-1.0-xhigh', ran: 'composer-2.5-fast', source: 'app', tokens: 1000 + minutes });
    assert.equal(markRun(dir, { key: `${brief}/${ON}`, action: 'stop', now: at(minutes) }).minutes, minutes);
    markRun(dir, { key: `${brief}/${OFF}`, action: 'start', now: t0, model: 'muse-wonder-1.0-xhigh', source: 'self' });
    markRun(dir, { key: `${brief}/${OFF}`, action: 'stop', now: at(minutes / 2 + 0.25) });
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'runs.json'), 'utf8'))[`brief-1/${OFF}`].minutes, 5.25);
  assert.throws(() => markRun(dir, { key: `brief-1/${ON}`, action: 'start', now: at(40) }), /already started at 2026-11-20T10:00:00\.000Z/);
  assert.throws(() => markRun(dir, { key: `brief-1/${ON}`, action: 'stop', now: at(41) }), /already stopped/);
  assert.throws(() => markRun(dir, { key: `brief-9/${ON}`, action: 'start' }), new RegExp(`brief-9/${ON} is not a run in this bake-off`));
  assert.throws(() => markRun(dir, { key: `brief-1/${OFF}`, action: 'pause' }), /mark takes start or stop/);
  markRun(dir, { key: 'judge', action: 'start', now: t0, model: 'muse-wonder-1.0-xhigh', ran: 'muse-wonder-1.0-xhigh', source: 'sdk' });
  judge(dir, sees(() => ON));
  const result = scored(box, dir);
  assert.equal(result.minutes[ON].median, 20);
  assert.deepEqual(result.minutes[ON].runs, [10, 20, 30]);
  assert.equal(result.minutes[OFF].median, 10.25, 'the median of 5.25, 10.25 and 15.25');
  assert.deepEqual(result.tokens[ON], [1010, 1020, 1030]);
  assert.deepEqual(result.tokens[OFF], []);
  const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
  assert.match(report, new RegExp(`\\| ${ON} \\| 20 min \\| 10 min, 20 min, 30 min \\| muse-wonder-1\\.0-xhigh \\| composer-2\\.5-fast \\(typed by hand, said to be read from the app\\) \\|`));
  assert.match(report, new RegExp(`\\| ${OFF} \\| 10 min \\| 5\\.3 min, 10 min, 15 min \\| muse-wonder-1\\.0-xhigh \\| not recorded \\(typed by hand, not verified\\) \\|`));
  assert.match(report, new RegExp(`Model mismatch\\. brief-1/${ON} asked for muse-wonder-1\\.0-xhigh and ran composer-2\\.5-fast`));
  assert.match(report, /Judge model\. Asked for muse-wonder-1\.0-xhigh, ran muse-wonder-1\.0-xhigh, typed by hand, said to be the SDK result\./);
  assert.match(report, new RegExp(`Tokens per run\\. ${OFF} not recorded; ${ON} 1010, 1020, 1030\\.`));
  box.cleanup();
});

test('status says what is built, what is judged and the next step', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 2, pairs: false });
  fs.rmSync(path.join(folder(dir, briefs[0].id, OFF), 'index.html'));
  const status = () => cli(['eval', 'bakeoff', 'status', dir], { cwd: box.project, env: box.env }).out;
  assert.match(status(), new RegExp(`brief-1/${OFF} +no index\\.html in arms/brief-1/arm-1`));
  const d = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(status(), new RegExp(`Next: start brief-1/${OFF}\\. Run these in order\\. \`100x helper models\` lists the model id, level and size to fill in\\.\\n {2}100x eval bakeoff mark ${d} brief-1/${OFF} start\\n {2}100x helper run --model <model id> --effort <level> --context <size> --task-file ${d}/tasks/brief-1--${OFF}\\.md --cwd ${d}/arms/brief-1/arm-1 --minutes 20 --receipt ${d}/helper-receipts/brief-1--${OFF}\\.json --json\\n {2}100x eval bakeoff mark ${d} brief-1/${OFF} stop --receipt ${d}/helper-receipts/brief-1--${OFF}\\.json\\n`), 'the next step is three commands that run as they stand, with only the model left to fill in');
  cli(['eval', 'bakeoff', 'mark', dir, `brief-1/${OFF}`, 'start', '--model', 'm'], { cwd: box.project, env: box.env });
  assert.match(status(), new RegExp(`brief-1/${OFF} +no index\\.html in arms/brief-1/arm-1, running`));
  assert.match(status(), new RegExp(`Next: brief-1/${OFF} is running\\. When its helper ends, run:\\n {2}100x eval bakeoff mark ${d} brief-1/${OFF} stop --receipt ${d}/helper-receipts/brief-1--${OFF}\\.json`));
  write(path.join(folder(dir, briefs[0].id, OFF), 'index.html'), page('brief-1', OFF));
  cli(['eval', 'bakeoff', 'mark', dir, `brief-1/${OFF}`, 'stop'], { cwd: box.project, env: box.env });
  assert.match(status(), new RegExp(`Next: 100x eval bakeoff pairs ${d}\\.`));
  cli(['eval', 'bakeoff', 'pairs', dir, '--no-capture'], { cwd: box.project, env: box.env });
  assert.match(status(), /Pairs built and the key is sealed\. 0 of 8 verdicts are in\./);
  judge(dir, sees(() => ON));
  assert.match(status(), new RegExp(`8 of 8 verdicts are in\\.\\nNext: 100x eval bakeoff score ${d}\\.`));
  box.cleanup();
});

test('a run that left no page stays in the count: pairs refuses until --blank-missing, which puts a blank page in the judge copy only and names the run', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 6, pairs: false });
  fs.rmSync(path.join(folder(dir, 'brief-1', OFF), 'index.html'));
  const pairs = (...flags) => cli(['eval', 'bakeoff', 'pairs', dir, '--no-capture', ...flags], { cwd: box.project, env: box.env });
  const refused = pairs();
  assert.equal(refused.code, 1);
  assert.match(refused.err, /have no index\.html yet:\n.*brief-1\/arm-1\/index\.html/);
  assert.match(refused.err, /a run that is over and left no page failed, and it stays in the count/i);
  assert.match(refused.err, /--blank-missing/);
  assert.ok(!fs.existsSync(path.join(dir, 'key.json')), 'a refusal seals nothing');

  const built = pairs('--blank-missing');
  assert.equal(built.code, 0, built.err);
  recordModels(dir, briefs);
  assert.match(built.out, /1 run left no page, so the judge sees a blank page for brief-1\/skill-off\./);
  assert.ok(!fs.existsSync(path.join(folder(dir, 'brief-1', OFF), 'index.html')), 'the arm\'s own folder is never written to');
  const key = keyOf(dir);
  assert.deepEqual(key.blank, [{ brief: 'brief-1', arm: OFF }]);
  const pair = key.items.find((i) => i.kind === 'real' && i.brief === 'brief-1');
  const blankSide = pair.first === OFF ? 'A' : 'B';
  const blank = fs.readFileSync(path.join(dir, 'judge', `${pair.id}-o1`, blankSide, 'index.html'), 'utf8');
  assert.match(blank, /This page is empty\./);
  assert.doesNotMatch(blank, /skill-o(n|ff)|100x|bake-?off|brief/i, 'the blank page names nothing');
  const planted = key.items.find((i) => i.kind === 'planted');
  assert.equal(planted.arm, ON, 'the planted control is made from a page that exists');
  const intact = planted.first === 'intact' ? 'A' : 'B';
  assert.match(fs.readFileSync(path.join(dir, 'judge', `${planted.id}-o1`, intact, 'index.html'), 'utf8'), /Page brief-1, version two/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'leakscan.json'), 'utf8'), /"ok": false/);

  judge(dir, sees(() => ON));
  const result = scored(box, dir);
  assert.deepEqual(result.blanks, ['brief-1/skill-off']);
  assert.equal(result.verdict.word, 'ahead');
  assert.equal(result.headline, `${ON} won 6 of 6 pairs, ${OFF} won 0, 0 tied (1 run left no page). ${ON} is ahead: 6 decisive pairs, exact two-sided sign test p = 0.03125.`);
  const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
  assert.match(report, /## Runs that left no page\n\nbrief-1\/skill-off\. A run that ends with no index\.html failed, and it stays in the count\./);
  assert.match(cli(['eval', 'bakeoff', 'status', dir], { cwd: box.project, env: box.env }).out, /Pairs built and the key is sealed/);
  box.cleanup();

  const both = sandbox();
  const two = bakeoff(both, { n: 2, pairs: false });
  for (const arm of ARMS) fs.rmSync(path.join(folder(two.dir, 'brief-2', arm), 'index.html'));
  assert.equal(cli(['eval', 'bakeoff', 'pairs', two.dir, '--no-capture', '--blank-missing'], { cwd: both.project, env: both.env }).code, 0);
  judge(two.dir, ({ item, sides }) => (item.brief === 'brief-2' && item.kind === 'real' ? 'tie' : sees(() => ON)({ item, sides })));
  const tied = scored(both, two.dir);
  assert.deepEqual(tied.blanks, ['brief-2/skill-off', 'brief-2/skill-on']);
  assert.equal(tied.ties, 1, 'two blank pages are a tie');
  assert.equal(tied.wins[ON], 1);
  both.cleanup();

  const none = sandbox();
  const empty = bakeoff(none, { n: 1, pairs: false });
  for (const arm of ARMS) fs.rmSync(path.join(folder(empty.dir, 'brief-1', arm), 'index.html'));
  const nothing = cli(['eval', 'bakeoff', 'pairs', empty.dir, '--no-capture', '--blank-missing'], { cwd: none.project, env: none.env });
  assert.equal(nothing.code, 1);
  assert.match(nothing.err, /No arm left a page, so there is nothing to judge\./);
  none.cleanup();
});

test('status says which finished runs left no page and what to do about them', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 1, pairs: false });
  fs.rmSync(path.join(folder(dir, 'brief-1', OFF), 'index.html'));
  for (const arm of ARMS) {
    cli(['eval', 'bakeoff', 'mark', dir, `brief-1/${arm}`, 'start'], { cwd: box.project, env: box.env });
    cli(['eval', 'bakeoff', 'mark', dir, `brief-1/${arm}`, 'stop'], { cwd: box.project, env: box.env });
  }
  const out = cli(['eval', 'bakeoff', 'status', dir], { cwd: box.project, env: box.env }).out;
  assert.match(out, /brief-1\/skill-off ended with no index\.html\. That is a failed run and it stays in the count\./);
  assert.match(out, new RegExp(`Next: 100x eval bakeoff pairs ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --blank-missing\\.`));
  box.cleanup();
});

test('arms that ran different models are withheld, a run on the wrong model is cautioned in the headline, and so is the judge', () => {
  const run = (ranFor, { judgeRan = null } = {}) => {
    const box = sandbox();
    const { dir, briefs } = bakeoff(box, { n: 6, record: false });
    const t0 = new Date('2026-11-20T10:00:00Z');
    const receipt = (name, ran) => makeReceipt(path.join(box.dir, 'receipts-in', `${name.replace('/', '__')}.json`), { ran, requested: 'muse-wonder-1.0' });
    for (const brief of briefs) {
      for (const arm of ARMS) {
        markRun(dir, { key: `${brief.id}/${arm}`, action: 'start', now: t0 });
        markRun(dir, { key: `${brief.id}/${arm}`, action: 'stop', now: new Date(t0.getTime() + 10 * 60_000), receipt: receipt(`${brief.id}/${arm}`, ranFor(arm)) });
      }
    }
    markRun(dir, { key: 'judge', action: 'stop', now: new Date(t0.getTime() + 60_000), receipt: receipt('judge', judgeRan ?? 'muse-wonder-1.0') });
    judge(dir, sees(() => ON));
    const result = scored(box, dir);
    box.cleanup();
    return result;
  };
  const sameWrong = run(() => 'composer-2.5-fast');
  assert.equal(sameWrong.verdict.word, 'ahead', 'both arms on one model is a fair comparison, even when it is not the model chosen');
  assert.deepEqual(sameWrong.cautions, ['12 arm runs did not run the model that was chosen (composer-2.5-fast ran, muse-wonder-1.0 was asked for)']);
  assert.equal(sameWrong.headline, `${ON} won 6 of 6 pairs, ${OFF} won 0, 0 tied. ${ON} is ahead: 6 decisive pairs, exact two-sided sign test p = 0.03125. Caution: 12 arm runs did not run the model that was chosen (composer-2.5-fast ran, muse-wonder-1.0 was asked for).`);

  const mixed = run((arm) => (arm === ON ? 'muse-wonder-1.0' : 'composer-2.5-fast'));
  assert.equal(mixed.verdict.word, 'not shown');
  assert.equal(mixed.verdict.withheld, true);
  assert.match(mixed.verdict.reasons[0], /the arm runs did not all use one model \(composer-2\.5-fast and muse-wonder-1\.0\), so the pairs compare more than the skill/);

  const right = run(() => 'muse-wonder-1.0', { judgeRan: 'composer-2.5-fast' });
  assert.equal(right.verdict.word, 'ahead');
  assert.deepEqual(right.cautions, ['the judge ran composer-2.5-fast, not the muse-wonder-1.0 that was asked for']);
  assert.match(right.headline, /p = 0\.03125\. Caution: the judge ran composer-2\.5-fast, not the muse-wonder-1\.0 that was asked for\.$/);

  // The arms and the judge on one model is what the owner's rule allows, and the headline says what that costs.
  const same = run(() => 'muse-wonder-1.0', { judgeRan: 'muse-wonder-1.0' });
  assert.equal(same.verdict.word, 'ahead');
  assert.deepEqual(same.cautions, ['the judge ran muse-wonder-1.0, the same model as the arms, so it may prefer its own taste, and the controls show only that it can see']);
  assert.match(same.headline, /p = 0\.03125\. Caution: the judge ran muse-wonder-1\.0, the same model as the arms, so it may prefer its own taste, and the controls show only that it can see\.$/);
});

test('a verdict whose reason names an arm, the key, a task or an arm folder is void and withholds the word, and ordinary words are not a leak', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, sees(() => ON));
  const target = keyOf(dir).items.find((i) => i.kind === 'real');
  const file = path.join(dir, 'judge', `${target.id}-o1`, 'verdict.json');
  const winner = JSON.parse(fs.readFileSync(file, 'utf8')).winner;
  const say = (why) => {
    write(file, JSON.stringify({ winner, why }));
    return scored(box, dir);
  };
  const fine = say('B has a better skill tree layout, and the 100 percent bar is clearer than the plain list.');
  assert.equal(fine.verdict.word, 'ahead', 'the word skill, a number and plain are not leaks');
  for (const [why, named] of [['skill-on is clearly the better one', 'skill-on'], ['The 100x page looks nicer', '100x'], ['I opened key.json to check', 'key.json'], ['this one is in arm-2', 'an arm folder'], ['the tasks/brief-1 text asked for this', 'the tasks folder']]) {
    const voided = say(why);
    assert.equal(voided.verdict.word, 'not shown', why);
    assert.equal(voided.verdict.withheld, true);
    assert.match(voided.verdict.reasons[0], new RegExp(`1 verdict is void because the judge's reason names something it must not know \\(${target.id}-o1 names ${named.replace('.', '\\.')}\\)\\. Delete each such verdict\\.json and judge that folder again with a fresh helper`));
  }
  box.cleanup();
});

test('the report says when the arms did not work equally long, and says nothing when they did', () => {
  const run = (minutesFor) => {
    const box = sandbox();
    const { dir, briefs } = bakeoff(box, { n: 6, record: false });
    const t0 = new Date('2026-11-20T10:00:00Z');
    for (const brief of briefs) {
      for (const arm of ARMS) {
        markRun(dir, { key: `${brief.id}/${arm}`, action: 'start', now: t0 });
        markRun(dir, { key: `${brief.id}/${arm}`, action: 'stop', now: new Date(t0.getTime() + minutesFor(arm) * 60_000) });
      }
    }
    judge(dir, sees(() => ON));
    scored(box, dir);
    const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
    box.cleanup();
    return report;
  };
  assert.match(run((arm) => (arm === OFF ? 0.5 : 15)), /- The arms did not work equally long\. Median time: skill-off 30 s, skill-on 15 min, against 20 min asked for\. The pairs compare what each made in the time it took\./);
  assert.doesNotMatch(run(() => 12), /did not work equally long/);
  assert.doesNotMatch(run((arm) => (arm === OFF ? 10 : 15)), /did not work equally long/, 'a factor of 1.5 is not a gap');
  assert.doesNotMatch(run((arm) => (arm === OFF ? 0.1 : 0.9)), /did not work equally long/, 'under a minute apart is not a gap');
});

// The brief and arm the planted control's blurred copy was made from, as the progress line names them.
const plantedSource = (dir) => {
  const key = keyOf(dir);
  const item = key.items.find((i) => i.kind === 'planted');
  return `${item.brief}/${item.arm}`;
};

test('with screenshots the pairs carry a phone and a desktop picture on both sides, the blurred copy looks different, and the gallery names the arms under 300 KB', { skip: browserSkip }, () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 2, pairs: false });
  const built = cli(['eval', 'bakeoff', 'pairs', dir], { cwd: box.project, env: box.env });
  assert.equal(built.code, 0, built.err);
  recordModels(dir, briefs);
  assert.match(built.out, /^Photographing 5 pages, a phone and a desktop screen of each\. A page takes 15 to 20 seconds\.\n/, 'the first line says the wait is coming and how long a page takes');
  assert.deepEqual([...built.out.matchAll(/^  page (\d) of 5: (.+), \d+ s so far$/gm)].map((m) => `${m[1]} ${m[2]}`), ['1 brief-1/skill-off', '2 brief-1/skill-on', '3 brief-2/skill-off', '4 brief-2/skill-on', `5 the blurred control, from ${plantedSource(dir)}`], 'the pages go in the order of the briefs, and the control last');
  assert.match(fs.readFileSync(path.join(dir, 'judge', 'pair-01-o1', 'ask.md'), 'utf8'), /A screens folder in each holds screenshots of the opening screen on a phone and on a wide desktop\./);
  const key = keyOf(dir);
  assert.equal(key.rendered, true, 'the key records that the text the pages showed was scanned');
  assert.match(built.out, /found no arm name in them or in the text the pages showed when they ran\./);
  const planted = key.items.find((i) => i.kind === 'planted');
  for (const side of ['A', 'B']) {
    for (const name of ['phone.png', 'desktop.png']) assert.ok(fs.existsSync(path.join(dir, 'judge', `${planted.id}-o1`, side, 'screens', name)), `${side}/${name}`);
  }
  const shot = (side) => fs.readFileSync(path.join(dir, 'judge', `${planted.id}-o1`, side, 'screens', 'phone.png'));
  assert.notDeepEqual(shot('A'), shot('B'), 'a blurred page is not the same picture');
  const identical = key.items.find((i) => i.kind === 'identical');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'judge', `${identical.id}-o1`, 'A', 'screens', 'phone.png')), fs.readFileSync(path.join(dir, 'judge', `${identical.id}-o1`, 'B', 'screens', 'phone.png')), 'the same page twice is the same picture');

  judge(dir, sees(() => ON));
  const out = path.join(box.dir, 'gallery');
  const made = cli(['eval', 'bakeoff', 'gallery', dir, '--out', out], { cwd: box.project, env: box.env });
  assert.equal(made.code, 0, made.err);
  assert.match(made.out, /^Making 2 pictures\. The browser starts first/, 'the gallery says what it is doing before the wait');
  assert.match(made.out, /\n  picture 2 of 2: brief-\d, \d+ KB\n/, 'and a line follows each picture');
  assert.match(made.out, /\nWrote 2 pictures, 8 full-size screens and report\.md in .*gallery\.\n?$/, 'the closing line comes after the verdict');
  assert.match(made.out, /\nBake-off in .*\nskill-on won 2 of 2 pairs, skill-off won 0, 0 tied\.\nVerdict: not shown\. 2 decisive pairs, 6 are needed\.\n/, 'the gallery prints the same screen as score');
  assert.deepEqual(fs.readdirSync(out).sort(), ['brief-1.jpg', 'brief-2.jpg', 'report.md', 'screens']);
  assert.deepEqual(fs.readdirSync(path.join(out, 'screens', 'brief-1')).sort(), ['skill-off-desktop.png', 'skill-off-phone.png', 'skill-on-desktop.png', 'skill-on-phone.png'], 'the full-size screens sit beside the report, so its links work wherever the bake-off folder is');
  for (const name of ['brief-1.jpg', 'brief-2.jpg']) {
    const bytes = fs.readFileSync(path.join(out, name));
    assert.ok(bytes.length > 2000 && bytes.length <= 300 * 1024, `${name} is ${bytes.length} bytes`);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], `${name} is a JPEG`);
  }
  const report = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
  assert.match(report, /^# Bake-off report/);
  assert.match(report, /## Pictures[\s\S]*skill-off is on the left and skill-on on the right\. The arms are named here because the judging is over\./);
  assert.match(report, /### Brief 1\n\n!\[Brief 1: skill-off and skill-on\]\(brief-1\.jpg\)\n\nResult: skill-on won in both orders\./);
  assert.match(report, /### Brief 2[\s\S]*Result: skill-on won in both orders\./);
  assert.match(report, /Full size: \[skill-off phone\]\(screens\/brief-1\/skill-off-phone\.png\), \[skill-off desktop\]\(screens\/brief-1\/skill-off-desktop\.png\), \[skill-on phone\]/);
  for (const [, link] of report.matchAll(/\]\((screens\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(out, link)), `${link} is there`);
  assert.doesNotMatch(report, /Where the judge folders kept their screens/, 'the links do not depend on where the judge folders are');
  assert.doesNotMatch(report, /[\u2013\u2014]/, 'no long dash in a report');
  assert.doesNotMatch(report, /\b(SOTA|best|beats?)\b/i);
  const refused = cli(['eval', 'bakeoff', 'gallery', dir], { cwd: box.project, env: box.env });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /Say where the pictures and the report go/);
  // A judge that says A to everything fails the planted control. The gallery still prints what it has, and says by its exit code that no verdict was printed.
  judge(dir, () => 'A');
  const untrusted = cli(['eval', 'bakeoff', 'gallery', dir, '--out', path.join(box.dir, 'untrusted')], { cwd: box.project, env: box.env });
  assert.equal(untrusted.code, 2, untrusted.err);
  assert.match(untrusted.out, /judge not trusted/);
  box.cleanup();
});

test('the gallery refuses pairs that were built without screenshots, and a key that changed', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 2 });
  judge(dir, sees(() => ON));
  const none = cli(['eval', 'bakeoff', 'gallery', dir, '--out', path.join(box.dir, 'g')], { cwd: box.project, env: box.env });
  assert.equal(none.code, 1);
  assert.match(none.err, /The pairs were built without screenshots \(.*\), so there is nothing to put in a picture\. Build them without --no-capture\./);
  assert.ok(!fs.existsSync(path.join(box.dir, 'g', 'report.md')));
  fs.appendFileSync(path.join(dir, 'key.json'), ' ');
  assert.match(cli(['eval', 'bakeoff', 'gallery', dir, '--out', path.join(box.dir, 'g')], { cwd: box.project, env: box.env }).err, /The key changed after it was sealed/);
  box.cleanup();
});

test('--pin copies the skill into the bake-off folder with a clean home and a command that runs it, and only the second arm is told to use it', () => {
  const box = sandbox();
  const dir = path.join(box.dir, 'trial');
  const made = cli(['eval', 'bakeoff', 'init', dir, '--first', '2', '--pin', '--seed', '3'], { cwd: box.project, env: box.env });
  assert.equal(made.code, 0, made.err);
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'bakeoff.json'), 'utf8'));
  assert.deepEqual(config.briefs.map((b) => b.id), ['lighthouse-idle', 'coffee-dashboard'], 'the first two of the shipped briefs');
  if (fs.existsSync(path.join(ROOT, '.git'))) {
    assert.match(config.pinned.snapshot.commit, /^[0-9a-f]{40}$/);
    assert.equal(typeof config.pinned.snapshot.dirty, 'boolean');
  } else assert.equal(config.pinned.snapshot, null, 'a copy of the repo with no git history says it has no commit to name');
  const pinned = path.join(dir, 'pinned');
  assert.ok(fs.existsSync(path.join(pinned, 'skills', '100x-mockup', 'SKILL.md')));
  assert.deepEqual(fs.readdirSync(path.join(pinned, 'home')), [], 'a clean home');
  const ran = spawnSync(path.join(pinned, '100x'), ['doctor'], { encoding: 'utf8', env: { ...process.env, HOME: box.env.HOME, X100_HOME: '/nonexistent-home' }, cwd: box.project });
  const quoted = pinned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(ran.stdout, new RegExp(`home +${quoted}/home`), 'the command uses the clean home whatever the caller has set');
  const on = fs.readFileSync(path.join(dir, 'tasks', `lighthouse-idle--${ON}.md`), 'utf8');
  const off = fs.readFileSync(path.join(dir, 'tasks', `lighthouse-idle--${OFF}.md`), 'utf8');
  assert.match(on, new RegExp(`## Method\\nFollow the skill in ${quoted}/skills/100x-mockup/SKILL\\.md\\. Its 100x command is ${quoted}/100x`));
  assert.doesNotMatch(off, /pinned|100x-mockup|## Method/);
  assert.match(made.out, /The skill is pinned in .*pinned/);
  if (config.pinned.snapshot) assert.match(made.out, /from commit [0-9a-f]{12}/);
  assert.match(made.out, /Protocol: .*evals\/PROTOCOL\.md\. Read it before the first arm starts\./);
  box.cleanup();
});

test('the run order is a seeded shuffle of every brief and arm, the same for the same seed, and --first and the default briefs are checked', () => {
  const box = sandbox();
  const make = (name, ...args) => {
    const dir = path.join(box.dir, name);
    const result = cli(['eval', 'bakeoff', 'init', dir, ...args], { cwd: box.project, env: box.env });
    return { result, config: result.code === 0 ? JSON.parse(fs.readFileSync(path.join(dir, 'bakeoff.json'), 'utf8')) : null };
  };
  const a = make('a', '--seed', '3');
  const b = make('b', '--seed', '3');
  const c = make('c', '--seed', '4');
  assert.equal(a.config.briefs.length, 20, 'with no --briefs the shipped file is used');
  assert.equal(a.config.order.length, 40);
  assert.deepEqual([...a.config.order].sort(), a.config.briefs.flatMap((brief) => [`${brief.id}/${OFF}`, `${brief.id}/${ON}`]).sort());
  assert.deepEqual(a.config.order, b.config.order, 'the same seed, the same order');
  assert.notDeepEqual(a.config.order, c.config.order);
  assert.match(a.result.out, /Run the arms one at a time in this order: /);
  const protocolText = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'evals', 'PROTOCOL.md'));
  assert.equal(a.config.protocol, crypto.createHash('sha256').update(protocolText).digest('hex'), 'init records the hash of the protocol text it ran under');
  assert.match(make('d', '--first', '0').result.err, /--first takes a whole number from 1 to 20\. Got "0"\./);
  assert.match(make('e', '--first', '99').result.err, /from 1 to 20\. Got "99"\./);
  assert.equal(make('f', '--first', '3').config.briefs.length, 3);
  box.cleanup();
});

test('evals/briefs.json holds 20 briefs with the three pilot briefs first, and none names a skill', () => {
  const file = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'evals', 'briefs.json'), 'utf8'));
  assert.equal(file.briefs.length, 20);
  assert.deepEqual(file.briefs.slice(0, 3).map((b) => b.id), ['lighthouse-idle', 'coffee-dashboard', 'dog-walking-lisbon']);
  assert.equal(new Set(file.briefs.map((b) => b.id)).size, 20);
  for (const brief of file.briefs) {
    assert.match(brief.id, /^[a-z0-9][a-z0-9-]*$/);
    assert.ok(brief.title && brief.text.length > 80, `${brief.id} needs a title and a real brief`);
    assert.doesNotMatch(`${brief.title} ${brief.text}`, /100x|skill|bake-?off|SKILL\.md|\bagent\b/i, `${brief.id} must read like an owner's brief`);
  }
});

test('a name a script builds into the page text is refused after the page is photographed, naming the arm file, and a build with no photographs says it did not run the pages', { skip: browserSkip }, () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 2, pairs: false });
  const sneaky = path.join(folder(dir, 'brief-1', ON), 'index.html');
  write(sneaky, `<!doctype html><html><head><title>Page</title></head><body><h1 id="h"></h1><script>document.getElementById('h').textContent = 'skill' + '-on';</script></body></html>\n`);
  const refused = cli(['eval', 'bakeoff', 'pairs', dir], { cwd: box.project, env: box.env });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /The blind is broken\. A judge would see the skill or an arm named in 1 place:\n  arms\/brief-1\/arm-2\/index\.html \(as it rendered\)  skill-on  \(in \d+ judge folders?\)\n/);
  assert.equal(fs.existsSync(path.join(dir, 'key.json')), false, 'no key is left behind');
  const quiet = cli(['eval', 'bakeoff', 'pairs', dir, '--no-capture'], { cwd: box.project, env: box.env });
  assert.equal(quiet.code, 0, quiet.err);
  assert.match(quiet.out, /found no arm name in them\. Key sealed/);
  assert.equal(keyOf(dir).rendered, undefined, 'a build with no photographs does not say the pages were run');
  box.cleanup();
});

test('a screenshot failure names the cause without the border characters, and says what installs a browser', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 1, pairs: false });
  const home = path.join(box.dir, 'no-browsers');
  fs.mkdirSync(home, { recursive: true });
  const refused = cli(['eval', 'bakeoff', 'pairs', dir], { cwd: box.project, env: { ...box.env, X100_HOME: home, X100_PLAYWRIGHT_FROM: path.join(box.dir, 'nowhere') } });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /Pairs need a browser to photograph each page, and none is installed\. Run `100x browsers` once\./);
  assert.doesNotMatch(refused.err, /[║╔╚═]/);
  box.cleanup();
});
