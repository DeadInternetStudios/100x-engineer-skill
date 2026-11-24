import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildPairs, causeOf, leakPatterns, markRun, scanForLeaks } from '../lib/eval/blind.mjs';
import { ARMS, bakeoff, folder, judge, keyOf, makeReceipt, ON, OFF, ORDERS, recordModels, sealedOf, sees, split } from './bakeoff-helpers.mjs';
import { sign, signingKey } from '../lib/seal.mjs';
import { cli, noFileLinks, sandbox, symlink, write } from './helpers.mjs';

const run = (box, ...args) => cli(['eval', 'bakeoff', ...args], { cwd: box.project, env: box.env });
// The exit code is part of what every score here returns: 2 when the verdict was withheld, 0 when one was printed.
const scored = (box, dir) => {
  const result = run(box, 'score', dir, '--json');
  const parsed = JSON.parse(result.out);
  assert.equal(result.code, parsed.verdict.withheld ? 2 : 0, result.err);
  return parsed;
};
const judgeFolders = (dir) => keyOf(dir).items.flatMap((item) => ORDERS.map((order) => `${item.id}-${order}`));
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

test('a leak in an arm folder refuses before any screenshot is taken, so minutes of photographs are not spent on a run that cannot go on', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 2, pairs: false });
  write(path.join(folder(dir, briefs[1].id, ON), 'NOTES'), `written by the ${ON} arm\n`);
  const said = [];
  assert.throws(() => buildPairs(dir, { capture: true, progress: (line) => said.push(line) }), /The blind is broken\. A judge would see the skill or an arm named in 1 place:\n {2}arms\/[^/]+\/arm-2\/NOTES:1 .*\(in \d+ judge folders\)/s);
  assert.deepEqual(said, [], 'nothing was photographed or announced before the refusal');
  assert.ok(!fs.existsSync(path.join(dir, 'key.json')), 'and no key was made');
});

test('the leak scan reads what a file holds, so a name in a file with no extension, an odd extension or a binary file is caught, and a file it cannot read is refused', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 2, pairs: false });
  const arm = folder(dir, briefs[0].id, ON);
  const attempt = () => run(box, 'pairs', dir, '--no-capture');

  write(path.join(arm, 'NOTES'), `written by the ${ON} arm\n`);
  const bare = attempt();
  assert.equal(bare.code, 1);
  assert.match(bare.err, /The blind is broken/);
  assert.match(bare.err, /NOTES:1 +written by the skill-on arm/, 'a file with no extension is read');
  fs.rmSync(path.join(arm, 'NOTES'));

  write(path.join(arm, 'data.bin'), `plain text under an odd extension, made by ${OFF}\n`);
  assert.match(attempt().err, /data\.bin:1/, 'an extension the scan does not know is read as text');
  fs.rmSync(path.join(arm, 'data.bin'));

  fs.writeFileSync(path.join(arm, 'blob'), Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(`made by ${ON}`), Buffer.from([0, 255])]));
  const binary = attempt();
  assert.equal(binary.code, 1);
  assert.match(binary.err, /blob {2}the binary file holds "skill-on"/, 'a name inside a binary file is found byte by byte');
  fs.rmSync(path.join(arm, 'blob'));

  // The same name written with an underscore or a spaced hyphen is still the name, and the four-letter 100x is searched for in a binary that is not a picture.
  write(path.join(arm, 'title.js'), `document.title = 'made with skill_on';\n`);
  assert.match(attempt().err, /title\.js:1 /, 'an underscore does not hide the name');
  fs.rmSync(path.join(arm, 'title.js'));
  write(path.join(arm, 'note.txt'), 'the skill- on arm\n');
  assert.match(attempt().err, /note\.txt:1 /, 'a hyphen with a space after it does not hide the name');
  fs.rmSync(path.join(arm, 'note.txt'));
  const probe = path.join(box.dir, 'probe');
  const scan = (name, bytes) => {
    fs.rmSync(probe, { recursive: true, force: true });
    fs.mkdirSync(probe);
    fs.writeFileSync(path.join(probe, name), bytes);
    return scanForLeaks(probe, leakPatterns(ARMS)).hits.map((hit) => hit.text);
  };
  assert.deepEqual(scan('plain.txt', 'each skill on the list\n'), [], 'two plain words are not the name');
  // What the mockup skill tells a run to call itself gives the arm away as surely as its name, and a page that says it was found with five such pages in the real run.
  assert.deepEqual(scan('page.html', '<div class="badge">MOCKUP<br>UNREVIEWED</div>\n'), ['<div class="badge">MOCKUP<br>UNREVIEWED</div>'], 'a badge that says MOCKUP UNREVIEWED is refused, once for the line');
  assert.deepEqual(scan('page.html', '<footer>Made-up details · an unreviewed mock-up</footer>\n'), ['<footer>Made-up details · an unreviewed mock-up</footer>'], 'a hyphenated mock-up is the same word');
  assert.deepEqual(scan('page.html', '<footer>A mockup, with made-up details</footer>\n'), ['<footer>A mockup, with made-up details</footer>'], 'mockup alone is refused, because the skill calls its run that');
  assert.deepEqual(scan('page.html', 'These screens are mock-ups.\n'), ['These screens are mock-ups.'], 'a plural with a hyphen is the same word');
  assert.deepEqual(scan('page.html', 'made-up prices, and a review of the menu\n'), [], 'made-up and review are other words');
  assert.deepEqual(leakPatterns(ARMS, ['mockup']).map((entry) => entry.word).filter((word) => ['mockup', 'unreviewed'].includes(word)), ['unreviewed'], 'a brief that is about a mockup lets that one word through with --allow');
  assert.deepEqual(scan('data.bin', Buffer.from([0, 1, 49, 48, 48, 120, 0])), ['the binary file holds "100x"'], 'the short name is searched for in a binary that is not a picture');
  assert.deepEqual(scan('shot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 49, 48, 48, 120, 0])), [], 'four bytes in a compressed picture are chance, not a name');
  assert.deepEqual(scan('shot.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]), Buffer.from('skill-on')])), ['the binary file holds "skill-on"'], 'a longer name is still found in a picture');
  fs.rmSync(probe, { recursive: true, force: true });

  if (!noFileLinks) {
    symlink(path.join(box.dir, 'briefs.json'), path.join(arm, 'link'));
    const linked = attempt();
    assert.equal(linked.code, 1);
    assert.match(linked.err, /The scan could not read 1 file a judge would be given:\n  arms\/\S+\/arm-\d\/link +it is a symbolic link.*\(in 2 judge folders\)/, 'one link in the arm folder, copied into both judge folders of its pair');
    assert.match(linked.err, /link {2}it is a symbolic link/);
    fs.rmSync(path.join(arm, 'link'));
  }
  assert.ok(!fs.existsSync(path.join(dir, 'key.json')), 'no refusal seals anything');

  const clean = attempt();
  assert.equal(clean.code, 0, clean.err);
  assert.match(clean.out, /scanned \d+ text and \d+ binary files/, 'the screenshots are binary files and are counted');
  box.cleanup();
});

test('a file too big for the scan to read whole is listed as one it could not check', () => {
  const box = sandbox();
  const folderPath = path.join(box.dir, 'scan');
  write(path.join(folderPath, 'small.txt'), 'hello\n');
  const big = path.join(folderPath, 'huge.dat');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, 26 * 1024 * 1024);
  const found = scanForLeaks(folderPath, leakPatterns(ARMS, []));
  assert.deepEqual(found.unscanned.map((item) => item.file), ['huge.dat']);
  assert.match(found.unscanned[0].why, /26 MB, over the 25 MB the scan reads/);
  assert.equal(found.scanned, 1);
  box.cleanup();
});

test('the word is withheld until the model that ran is on record for every arm run and every judge folder', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 6, record: false });
  judge(dir, sees(() => ON));
  const reasons = (result) => result.verdict.reasons.join(' | ');

  const none = scored(box, dir);
  assert.equal(none.verdict.word, 'not shown');
  assert.equal(none.verdict.withheld, true);
  assert.match(reasons(none), /the model that ran is not recorded for 12 of 12 arm runs \(brief-1\/skill-off, brief-1\/skill-on, brief-2\/skill-off, \.\.\.\)/);
  assert.match(reasons(none), /the model that judged is not recorded for 16 of 16 judge folders \(pair-01-o1, pair-01-o2, pair-02-o1, \.\.\.\)/);

  recordModels(dir, briefs);
  const all = scored(box, dir);
  assert.equal(all.verdict.word, 'ahead', 'with every record in place the same verdicts give the word');
  box.cleanup();

  const partial = sandbox();
  const made = bakeoff(partial, { n: 6, record: false });
  judge(made.dir, sees(() => ON));
  recordModels(made.dir, made.briefs);
  const runs = path.join(made.dir, 'runs.json');
  const edited = JSON.parse(fs.readFileSync(runs, 'utf8'));
  delete edited[`brief-3/${ON}`].model.ran;
  fs.writeFileSync(runs, JSON.stringify(edited));
  assert.match(reasons(scored(partial, made.dir)), /the model that ran is not recorded for 1 of 12 arm runs \(brief-3\/skill-on\)/);
  partial.cleanup();
});

test('a judge model can be recorded per folder, and judges on two models withhold the word', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 6, record: false });
  judge(dir, sees(() => ON));
  recordModels(dir, briefs);
  const runs = path.join(dir, 'runs.json');
  const edited = JSON.parse(fs.readFileSync(runs, 'utf8'));
  delete edited.judge;
  fs.writeFileSync(runs, JSON.stringify(edited));
  const folders = judgeFolders(dir);
  assert.equal(folders.length, 16);
  assert.match(scored(box, dir).verdict.reasons.join(' | '), /the model that judged is not recorded for 16 of 16 judge folders/);

  for (const name of folders.slice(1)) markRun(dir, { key: `judge/${name}`, action: 'stop', model: 'test-model', ran: 'test-model', source: 'sdk' });
  assert.match(scored(box, dir).verdict.reasons.join(' | '), /not recorded for 1 of 16 judge folders \(pair-01-o1\)/, 'one folder with no record is named');

  markRun(dir, { key: `judge/${folders[0]}`, action: 'stop', model: 'test-model', ran: 'other-model', source: 'sdk' });
  const mixed = scored(box, dir);
  assert.equal(mixed.verdict.word, 'not shown');
  assert.match(mixed.verdict.reasons.join(' | '), /the judges did not all use one model \(other-model and test-model\)/);
  assert.match(mixed.cautions.join(' | '), /1 judge record ran other-model, not the test-model that was asked for/);

  assert.throws(() => markRun(dir, { key: 'judge/pair-99-o1', action: 'stop', ran: 'x' }), /is not a run in this bake-off/);
  box.cleanup();
});

test('mark refuses a source it does not know and a token count that is not a number, and init refuses a seed or a time that is not', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 2, pairs: false });
  const key = `${briefs[0].id}/${OFF}`;
  assert.equal(run(box, 'mark', dir, key, 'start', '--source', 'sdk').code, 0);
  const odd = run(box, 'mark', dir, key, 'stop', '--source', 'the-cloud');
  assert.equal(odd.code, 1);
  assert.match(odd.err, /--source is sdk, app, self\. Got "the-cloud"\./);
  for (const bad of ['abc', '-3', '1.5', '', 'Infinity']) {
    const tokens = run(box, 'mark', dir, key, 'stop', `--tokens=${bad}`);
    assert.equal(tokens.code, 1, `--tokens ${JSON.stringify(bad)}`);
    assert.match(tokens.err, /--tokens takes a whole number of 0 or more/);
  }
  assert.equal(run(box, 'mark', dir, key, 'stop', '--tokens', '1200').code, 0);

  write(path.join(box.dir, 'one.json'), JSON.stringify([{ id: 'a', title: 'A', text: 'Make a clock.' }]));
  const init = (...flags) => run(box, 'init', path.join(box.dir, `made-${flags.join('')}`), '--briefs', path.join(box.dir, 'one.json'), ...flags);
  assert.match(init('--seed', 'soon').err, /--seed takes a whole number of 0 or more\. Got "soon"\./);
  assert.match(init('--seed', '2.5').err, /--seed takes a whole number/);
  assert.match(init('--minutes', '0').err, /--minutes takes a number above 0\. Got "0"\./);
  assert.match(init('--minutes', 'x').err, /--minutes takes a number above 0/);
  assert.equal(init('--seed', '7', '--minutes', '15').code, 0);
  box.cleanup();
});

test('a key that was edited and re-hashed by hand has no signature, so the word is withheld, and a key of the wrong shape is refused', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, sees(() => ON));
  assert.equal(scored(box, dir).verdict.word, 'ahead', 'untouched, with its signature');
  const seal = path.join(dir, 'key.sha256');
  const keyFile = path.join(dir, 'key.json');
  const original = { key: fs.readFileSync(keyFile, 'utf8'), seal: fs.readFileSync(seal, 'utf8') };
  const reseal = (text, signature = '') => {
    fs.writeFileSync(keyFile, text);
    fs.writeFileSync(seal, `${sha(text)}  key.json\n${signature}`);
  };

  const flipped = JSON.parse(original.key);
  const real = flipped.items.find((item) => item.kind === 'real');
  [real.first, real.second] = [real.second, real.first];
  reseal(`${JSON.stringify(flipped, null, 2)}\n`);
  const unsigned = scored(box, dir);
  assert.equal(unsigned.verdict.word, 'not shown');
  assert.match(unsigned.verdict.reasons.join(' | '), /the sealed key has no signature from this machine's 100x key/);

  reseal(`${JSON.stringify(flipped, null, 2)}\n`, `${'ab'.repeat(32)}  signature\n`);
  assert.match(scored(box, dir).verdict.reasons.join(' | '), /no signature from this machine's 100x key/, 'a made up signature does not pass');

  const shapes = {
    'a version that is not 1': (key) => ({ ...key, version: 2 }),
    'the same arm twice': (key) => ({ ...key, arms: [key.arms[0], key.arms[0]] }),
    'an id that is a path': (key) => ({ ...key, items: key.items.map((item, i) => (i === 0 ? { ...item, id: '../../escape' } : item)) }),
    'a pair listed twice': (key) => ({ ...key, items: [key.items[0], ...key.items] }),
    'a kind that is not known': (key) => ({ ...key, items: key.items.map((item, i) => (i === 0 ? { ...item, kind: 'bonus' } : item)) }),
    'a label that is not an arm': (key) => ({ ...key, items: key.items.map((item) => (item.kind === 'real' ? { ...item, first: 'somebody-else' } : item)) }),
    'the same label in both places': (key) => ({ ...key, items: key.items.map((item) => (item.kind === 'real' ? { ...item, second: item.first } : item)) }),
    'no items': (key) => ({ ...key, items: [] }),
  };
  for (const [name, edit] of Object.entries(shapes)) {
    reseal(`${JSON.stringify(edit(JSON.parse(original.key)))}\n`);
    const refused = run(box, 'score', dir, '--json');
    assert.equal(refused.code, 1, name);
    assert.match(refused.err, /key\.json is not a key this tool wrote/, name);
  }
  reseal('[1, 2');
  assert.match(run(box, 'score', dir).err, /key\.json is not valid JSON/);

  fs.writeFileSync(keyFile, original.key);
  fs.writeFileSync(seal, original.seal);
  judge(dir, sees(() => ON));
  assert.equal(scored(box, dir).verdict.word, 'ahead', 'put back, and judged after the seal, it passes again');
  box.cleanup();
});

test('the gallery names the arms, so it refuses while a verdict is missing or void', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 2 });
  const out = path.join(box.dir, 'gallery');
  const gallery = () => run(box, 'gallery', dir, '--out', out);

  const none = gallery();
  assert.equal(none.code, 1);
  assert.match(none.err, /Judging is not finished: 8 verdicts are missing\. The gallery names the arms, so it would unblind the judges\./);
  assert.ok(!fs.existsSync(out), 'nothing is written');

  judge(dir, sees(() => ON));
  const first = judgeFolders(dir)[0];
  const verdict = path.join(dir, 'judge', first, 'verdict.json');
  fs.writeFileSync(verdict, JSON.stringify({ winner: 'A', why: `the ${OFF} page is better` }));
  const voided = gallery();
  assert.equal(voided.code, 1);
  assert.match(voided.err, /Judging is not finished: 1 is void\./);

  fs.rmSync(verdict);
  assert.match(gallery().err, /1 verdict is missing/);
  box.cleanup();
});

test('the folder an arm is told it works in is a leak, in a file, a file name or a folder name, and ask.md quotes the key hash for the judge to copy back', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 2, pairs: false });
  const arm = folder(dir, briefs[0].id, ON);
  const attempt = () => run(box, 'pairs', dir, '--no-capture');

  write(path.join(arm, 'proxy.txt'), 'built in arm-2 folder\n');
  const inside = attempt();
  assert.equal(inside.code, 1);
  assert.match(inside.err, /proxy\.txt:1 +built in arm-2 folder/, 'a path an arm was given is the one string it is sure to know about itself');
  fs.rmSync(path.join(arm, 'proxy.txt'));

  write(path.join(arm, 'notes-arm-1.md'), 'hello\n');
  assert.match(attempt().err, /notes-arm-1\.md:0 +the file name holds "an arm folder"|notes-arm-1\.md +the file name holds "an arm folder"/);
  fs.rmSync(path.join(arm, 'notes-arm-1.md'));

  write(path.join(arm, 'arm-2', 'x.txt'), 'hello\n');
  assert.match(attempt().err, /arm-2 .*the file name holds "an arm folder"/, 'a folder inside the arm folder carries the name too');
  fs.rmSync(path.join(arm, 'arm-2'), { recursive: true });

  write(path.join(arm, 'warm-20.txt'), 'a swarm-1x of bees and farm-2 animals\n');
  const clean = attempt();
  assert.equal(clean.code, 0, `words that only contain the letters are not the name: ${clean.err}`);
  const ask = fs.readFileSync(path.join(dir, 'judge', judgeFolders(dir)[0], 'ask.md'), 'utf8');
  assert.ok(ask.includes(`"sealed": "${sealedOf(dir)}"`), 'ask.md carries the start of the hash that key.sha256 holds');
  assert.match(sealedOf(dir), /^[0-9a-f]{16}$/);
  box.cleanup();
});

test('a verdict that quotes the key hash was written after the seal wherever the folder went, one that quotes another hash voids the word, and one that does not is placed by its file time', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, sees(() => ON));
  const future = new Date(Date.now() + 3_600_000);
  fs.utimesSync(path.join(dir, 'key.sha256'), future, future);
  const copied = scored(box, dir);
  assert.equal(copied.verdict.word, 'ahead', 'file times that say the seal is later do not matter to verdicts that quote the hash');

  const victim = path.join(dir, 'judge', judgeFolders(dir)[0], 'verdict.json');
  const verdict = JSON.parse(fs.readFileSync(victim, 'utf8'));
  fs.writeFileSync(victim, JSON.stringify({ ...verdict, sealed: 'f'.repeat(16) }));
  const other = scored(box, dir);
  assert.equal(other.verdict.word, 'not shown');
  assert.match(other.verdict.reasons.join(' | '), /1 verdict quotes a key hash that is not this key's \(pair-01-o1\), so the key was remade after the judging/);

  const { sealed, ...bare } = verdict;
  fs.writeFileSync(victim, JSON.stringify(bare));
  const unquoted = scored(box, dir);
  assert.match(unquoted.verdict.reasons.join(' | '), /does not quote the sealed key's hash is older than key\.sha256\. Either the key was sealed after the judging, or this folder is a copy, which loses file times/);
  box.cleanup();
});

test('score prints the counts and writes nothing under --no-write, and prints them too when the folder cannot be written', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, sees(() => ON));
  const plain = run(box, 'score', dir, '--no-write');
  assert.equal(plain.code, 0, plain.err);
  assert.match(plain.out, /skill-on won 6 of 6 pairs/);
  assert.match(plain.out, /\nNothing was written, as --no-write asked\. Run score without it to get report\.md\.\n?$/, 'the closing line says it was asked for, and not that something failed');
  assert.ok(!fs.existsSync(path.join(dir, 'report.md')) && !fs.existsSync(path.join(dir, 'result.json')), 'nothing was written');

  fs.mkdirSync(path.join(dir, 'report.md'));
  const blocked = run(box, 'score', dir);
  assert.equal(blocked.code, 0, 'a report that cannot be written is not a score that cannot be printed');
  assert.match(blocked.out, /skill-on is ahead/);
  assert.match(blocked.out, /\nThe whole report could not be written here\. Run score in a folder you can write to\.\n/, 'a failed write is not worded as a choice');
  assert.match(blocked.out, /report\.md and result\.json were not written in .* \(EISDIR\)\. The counts above are the same\./);
  const asJson = run(box, 'score', dir, '--json');
  assert.equal(JSON.parse(asJson.out).verdict.word, 'ahead', 'stdout stays JSON');
  assert.match(asJson.err, /were not written/, 'and the note goes to stderr');
  box.cleanup();
});

test('a receipt is taken by mark with its model, settings and tokens, and one that is edited, unsigned, reused or given with a typed name is refused', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 2, pairs: false });
  const keys = [`${briefs[0].id}/${OFF}`, `${briefs[0].id}/${ON}`];
  const receipts = path.join(box.dir, 'in');
  const one = makeReceipt(path.join(receipts, 'one.json'), { ran: 'muse-wonder-1.0', params: { reasoning_effort: 'max', context: '300k' }, tokens: 4242 });
  assert.equal(run(box, 'mark', dir, keys[0], 'start').code, 0);

  const typed = run(box, 'mark', dir, keys[0], 'stop', '--receipt', one, '--ran', 'muse-wonder-1.0');
  assert.equal(typed.code, 1);
  assert.match(typed.err, /A receipt carries the model asked for, the model that ran, where it came from and the tokens\. Give it without --model, --ran, --source or --tokens\./);
  assert.match(run(box, 'mark', dir, keys[1], 'start', '--receipt', one).err, /--receipt goes with stop/);

  const taken = run(box, 'mark', dir, keys[0], 'stop', '--receipt', one);
  assert.equal(taken.code, 0, taken.err);
  assert.match(taken.out, /Receipt kept in .*skill-off\.json, muse-wonder-1\.0 ran at context 300k, reasoning_effort max\./);
  const runs = JSON.parse(fs.readFileSync(path.join(dir, 'runs.json'), 'utf8'));
  assert.equal(runs[keys[0]].tokens, 4242);
  assert.deepEqual(runs[keys[0]].model.params, { reasoning_effort: 'max', context: '300k' });
  assert.equal(runs[keys[0]].model.source, 'sdk');
  assert.equal(runs[keys[0]].model.runId, 'run-one');
  assert.ok(fs.existsSync(path.join(dir, 'receipts', `${keys[0].replace('/', '__')}.json`)), 'a copy is kept with the bake-off');

  assert.equal(run(box, 'mark', dir, keys[1], 'start').code, 0);
  const reused = run(box, 'mark', dir, keys[1], 'stop', '--receipt', one);
  assert.equal(reused.code, 1);
  assert.match(reused.err, /This receipt is for run run-one, which already backs brief-1\/skill-off\. Each run needs a receipt of its own\./);

  const forged = path.join(receipts, 'forged.json');
  write(forged, fs.readFileSync(one, 'utf8').replace('run-one', 'run-forged'));
  assert.match(run(box, 'mark', dir, keys[1], 'stop', '--receipt', forged).err, /not a receipt this machine's 100x wrote, or it was edited since/, 'a copy with its run id changed has no valid signature');
  const handmade = path.join(receipts, 'handmade.json');
  write(handmade, JSON.stringify({ version: 1, requested: { id: 'x' }, ran: { id: 'x' }, runId: 'r', agentId: 'a' }));
  assert.match(run(box, 'mark', dir, keys[1], 'stop', '--receipt', handmade).err, /not a receipt this machine's 100x wrote/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'runs.json'), 'utf8'))[keys[1]].finishedAt, undefined, 'a refused receipt leaves the run open');
  box.cleanup();
});

test('"ahead" needs a receipt behind every record: typed names, an edited kept receipt and a missing one withhold it, and a lead that is not there says it as a caution', () => {
  const reasons = (result) => result.verdict.reasons.join(' | ');
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 6, record: false });
  judge(dir, sees(() => ON));
  recordModels(dir, briefs, { typed: true });
  const typed = scored(box, dir);
  assert.equal(typed.verdict.word, 'not shown');
  assert.equal(typed.verdict.withheld, true);
  assert.match(reasons(typed), /the model of 13 of 13 records \(brief-1\/skill-off, brief-1\/skill-on, brief-2\/skill-off, \.\.\.\) is typed by hand and no receipt from 100x helper run --receipt backs it, so a lead for skill-on would be a claim about a model nobody checked/);
  assert.match(typed.headline, /^skill-on won 6 of 6 pairs, skill-off won 0, 0 tied\. Not shown, and no verdict can be printed: /);
  box.cleanup();

  const kept = sandbox();
  const made = bakeoff(kept, { n: 6 });
  judge(made.dir, sees(() => ON));
  assert.equal(scored(kept, made.dir).verdict.word, 'ahead', 'every record backed by a receipt gives the word');
  const saved = path.join(made.dir, 'receipts', `${made.briefs[0].id}__${ON}.json`);
  fs.writeFileSync(saved, fs.readFileSync(saved, 'utf8').replace('"seconds": 60', '"seconds": 1'));
  const edited = scored(kept, made.dir);
  assert.equal(edited.verdict.word, 'not shown');
  assert.match(reasons(edited), /the model of 1 of 13 records \(brief-1\/skill-on\) is typed by hand/, 'a kept receipt that changed backs nothing');
  // The record can be made to name the edited file, and the signature still gives it away.
  const runsFile = path.join(made.dir, 'runs.json');
  const stored = JSON.parse(fs.readFileSync(runsFile, 'utf8'));
  stored[`${made.briefs[0].id}/${ON}`].model.receipt = sha(fs.readFileSync(saved, 'utf8'));
  fs.writeFileSync(runsFile, JSON.stringify(stored));
  assert.match(reasons(scored(kept, made.dir)), /the receipts behind 1 of 13 records \(brief-1\/skill-on\) carry a signature that this machine's 100x key does not verify/, 'a receipt that was edited and re-hashed has no valid signature, and is not taken as backed');
  assert.equal(scored(kept, made.dir).verdict.word, 'not shown');
  fs.rmSync(saved);
  fs.rmSync(`${saved}.seal`);
  assert.match(reasons(scored(kept, made.dir)), /1 of 13 records \(brief-1\/skill-on\)/, 'and neither does one that is gone');
  kept.cleanup();

  const flat = sandbox();
  const small = bakeoff(flat, { n: 3, record: false });
  judge(small.dir, sees(split(small.dir, 1)));
  recordModels(small.dir, small.briefs, { typed: true });
  const caution = scored(flat, small.dir);
  assert.equal(caution.verdict.word, 'not shown');
  assert.equal(caution.verdict.withheld, false, 'with no lead there is nothing for the missing receipts to withhold');
  assert.match(caution.headline, /Not shown: .* decisive pairs?, 6 are needed\. Caution: the model of 7 of 7 records \(.*\) is typed by hand and no receipt/);
  assert.match(fs.readFileSync(path.join(small.dir, 'result.json'), 'utf8'), /"backed": false/);
  flat.cleanup();
});

test('runs of one model at two settings are two configurations, for the arms and for the judges, and the report names the settings', () => {
  const reasons = (result) => result.verdict.reasons.join(' | ');
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 6, record: false });
  judge(dir, sees(() => ON));
  const t0 = new Date('2026-11-20T10:00:00Z');
  const receipts = path.join(box.dir, 'in');
  for (const brief of briefs) {
    for (const arm of ARMS) {
      const key = `${brief.id}/${arm}`;
      markRun(dir, { key, action: 'start', now: t0 });
      const params = { reasoning_effort: arm === ON ? 'max' : 'low', context: '300k' };
      markRun(dir, { key, action: 'stop', now: new Date(t0.getTime() + 600_000), receipt: makeReceipt(path.join(receipts, `${key.replace('/', '__')}.json`), { ran: 'muse-wonder-1.0', params }) });
    }
  }
  markRun(dir, { key: 'judge', action: 'stop', receipt: makeReceipt(path.join(receipts, 'judge.json'), { ran: 'muse-wonder-1.0' }) });
  const uneven = scored(box, dir);
  assert.equal(uneven.verdict.word, 'not shown');
  assert.match(reasons(uneven), /the arm runs did not all use one setting of muse-wonder-1\.0 \(context 300k, reasoning_effort low and context 300k, reasoning_effort max\), so the pairs compare more than the skill/);
  assert.match(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), /muse-wonder-1\.0 at context 300k, reasoning_effort max \(receipt from the SDK result\)/);
  box.cleanup();

  const judges = sandbox();
  const made = bakeoff(judges, { n: 6, record: false });
  judge(made.dir, sees(() => ON));
  recordModels(made.dir, made.briefs);
  const runsFile = path.join(made.dir, 'runs.json');
  const runs = JSON.parse(fs.readFileSync(runsFile, 'utf8'));
  delete runs.judge;
  fs.writeFileSync(runsFile, JSON.stringify(runs));
  const names = judgeFolders(made.dir);
  names.forEach((name, index) => markRun(made.dir, { key: `judge/${name}`, action: 'stop', receipt: makeReceipt(path.join(judges.dir, 'in', `${name}.json`), { ran: 'muse-wonder-1.0', params: { reasoning_effort: index === 0 ? 'low' : 'max', context: '300k' } }) }));
  assert.match(reasons(scored(judges, made.dir)), /the judges did not all use one setting of muse-wonder-1\.0 \(context 300k, reasoning_effort low and context 300k, reasoning_effort max\), so the pairs are not judged alike/);
  judges.cleanup();
});

test('--note for an arm that is not one of the two, a briefs file that is not a list and a folder that is a file are refused in plain words', () => {
  const box = sandbox();
  const briefs = path.join(box.dir, 'briefs.json');
  write(briefs, JSON.stringify([{ id: 'a', title: 'A', text: 'Make a clock.' }]));
  const bogus = run(box, 'init', path.join(box.dir, 'made'), '--briefs', briefs, '--note', `bogus=${briefs}`);
  assert.equal(bogus.code, 1);
  assert.match(bogus.err, /--note names bogus, which is not one of the arms\. The arms are skill-off and skill-on\./);
  assert.ok(!fs.existsSync(path.join(box.dir, 'made', 'tasks')), 'nothing was made');
  assert.equal(run(box, 'init', path.join(box.dir, 'ok'), '--briefs', briefs, '--note', `skill-on=${briefs}`).code, 0, 'a real arm still takes a note');

  const asFile = path.join(box.dir, 'afile');
  write(asFile, 'x');
  assert.match(run(box, 'init', asFile, '--briefs', briefs).err, /is a file, not a folder\. Name a folder for the bake-off\./);

  const object = path.join(box.dir, 'object.json');
  write(object, '{"a":1}');
  assert.match(run(box, 'init', path.join(box.dir, 'again'), '--briefs', object).err, /object\.json must hold a list of briefs, or an object with a "briefs" list\./);
  box.cleanup();
});

test('a screenshot failure is reported without the border Playwright draws, and a missing browser says what installs it', () => {
  const banner = '╔══════════════════════════════════════════════════════╗\n║ Looks like Playwright was just installed or updated. ║\n║ Please run the following command to download browsers║\n║                                                      ║\n║ <3 Playwright Team                                   ║\n╚══════════════════════════════════════════════════════╝';
  const cause = causeOf(banner);
  assert.doesNotMatch(cause, /[║╔╗╚╝═]/);
  assert.match(cause, /Please run the following command to download browsers <3 Playwright Team Run `100x browsers` once\./);
  assert.equal(causeOf('Error: the page threw\nat line 4'), 'Error: the page threw at line 4', 'another cause is shown as it is, with no install hint');
});

// The same run with a key from before the scan knew the words, sealed and signed again so that nothing but the missing `labels` field differs.
function keyFromBeforeTheScan(dir) {
  const key = keyOf(dir);
  delete key.labels;
  const text = `${JSON.stringify(key, null, 2)}\n`;
  fs.writeFileSync(path.join(dir, 'key.json'), text);
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(path.join(dir, 'key.sha256'), `${hash}  key.json\n${sign(hash, signingKey({ create: true }))}  signature\n`);
  for (const name of judgeFolders(dir)) {
    const file = path.join(dir, 'judge', name, 'verdict.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), sealed: hash.slice(0, 16) }));
  }
}

test('a run made before the scan knew "unreviewed" and "mockup" sets the pairs that say them aside from the word, and a key that knew them does not', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 6 });
  judge(dir, sees(() => ON));
  for (const brief of briefs.slice(0, 2)) fs.appendFileSync(path.join(folder(dir, brief.id, ON), 'index.html'), '<footer>UNREVIEWED mockup</footer>\n');
  const verdictFile = path.join(dir, 'judge', `${keyOf(dir).items.find((item) => item.kind === 'real').id}-o1`, 'verdict.json');
  const verdict = JSON.parse(fs.readFileSync(verdictFile, 'utf8'));
  fs.writeFileSync(verdictFile, JSON.stringify({ ...verdict, why: 'the footer says unreviewed mockup' }));

  const fresh = scored(box, dir);
  assert.equal(fresh.labelsScanned, true, 'the key of a new run records that the scan knew the words');
  assert.ok(!fresh.cautions.some((text) => /unreviewed/.test(text)), 'its pages were scanned, so it has nothing to caution about');
  assert.equal(fresh.voided.length, 1, 'a reason that names the label voids its verdict under a scan that refuses the label');
  assert.match(fresh.verdict.reasons.join(' | '), /names (unreviewed|mockup)/);

  keyFromBeforeTheScan(dir);
  const old = scored(box, dir);
  assert.equal(old.verdict.withheld, false, `nothing but the caution is left to say: ${old.verdict.reasons.join(' | ')}`);
  assert.equal(old.wins[ON], 6, 'the count of every pair is still printed');
  assert.equal(old.verdict.word, 'not shown', 'six of six would be ahead, but two of those pairs had a label a judge could read');
  assert.equal(old.verdict.reasons[0], '2 pairs are set aside for a label on the page, so 4 decisive pairs are left and 6 are needed');
  assert.equal(old.labelsScanned, false);
  assert.equal(old.voided.length, 0);
  const caution = old.cautions.find((entry) => /unreviewed/.test(entry));
  assert.match(caution, /^2 of the 6 pages of skill-on say "unreviewed" or "mockup" on the page, the words a run that follows the mockup skill may write for itself, so a judge could tell which arm made them \(brief-\d, brief-\d\)\. /);
  assert.match(caution, /Those 2 pairs are set aside from the word, and skill-off wins 0 and skill-on wins 4 of the 4 decisive pairs left, p = 0\.125$/, 'the pairs without the label are counted again');
  assert.ok(!/skill-off/.test(caution.split('(')[0]), 'only the arm whose pages say it is named in the count of pages');
  assert.ok(old.headline.includes(caution), 'the caution is in the headline the README quotes');
  box.cleanup();
});

test('a copy scored on another machine says its receipts were signed elsewhere, and does not call those names typed by hand', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  judge(dir, sees(() => ON));
  assert.equal(scored(box, dir).verdict.word, 'ahead', 'on the machine that signed it, six of six is ahead');

  const other = sandbox();
  const copy = path.join(other.dir, 'copy');
  fs.cpSync(dir, copy, { recursive: true });
  const away = cli(['eval', 'bakeoff', 'score', copy, '--json', '--no-write'], { cwd: other.project, env: other.env });
  assert.equal(away.code, 2, away.err);
  const result = JSON.parse(away.out);
  const reasons = result.verdict.reasons.join(' | ');
  assert.equal(result.verdict.withheld, true);
  assert.match(reasons, /the receipts behind 13 of 13 records \(.*\) carry a signature that this machine's 100x key does not verify \(signed on another machine, or changed since it was signed\), so this machine cannot check them\. They are not typed by hand/);
  assert.doesNotMatch(reasons, /typed by hand and no receipt/, 'a receipt that is there is not a name typed by hand');
  assert.ok(Object.values(result.models).every((model) => model.backed === false && model.otherMachine === true));
  assert.deepEqual(result.wins, { [OFF]: 0, [ON]: 6 }, 'the counts are the same anywhere');
  other.cleanup();
  box.cleanup();
});

test('a hand edit made to clear the leak scan is recorded by pairs, kept in the leak record and said in the score, and both arms are told not to label the page', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 6, pairs: false });
  const tasks = ARMS.map((arm) => fs.readFileSync(path.join(dir, 'tasks', `${briefs[0].id}--${arm}.md`), 'utf8'));
  for (const task of tasks) assert.match(task, /Do not write the words "unreviewed" or "mockup" in any file in this folder/, 'every arm is told not to label the page');
  const built = cli(['eval', 'bakeoff', 'pairs', dir, '--no-capture', '--edit', 'brief-2/arm-2/index.html:12 removed "UNREVIEWED mockup"', '--edit', 'brief-4/arm-2/index.html:30 removed "mockup"'], { cwd: box.project, env: box.env });
  assert.equal(built.code, 0, built.err);
  assert.match(built.out, /2 hand edits recorded, and the score will say so\./);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'leakscan.json'), 'utf8')).edits, ['brief-2/arm-2/index.html:12 removed "UNREVIEWED mockup"', 'brief-4/arm-2/index.html:30 removed "mockup"']);
  recordModels(dir, briefs);
  judge(dir, sees(() => ON));
  const result = scored(box, dir);
  assert.ok(result.cautions.some((text) => /^2 changes were made by hand to the arm pages before the judging, to clear the leak scan \(brief-2\/arm-2\/index\.html:12 removed "UNREVIEWED mockup"; brief-4\/arm-2\/index\.html:30 removed "mockup"\), so a judged page is not exactly what its arm made$/.test(text)), result.cautions.join(' | '));
  assert.equal(result.verdict.word, 'ahead', 'an edit is said beside the word, and it does not withhold it');
  box.cleanup();
});

test('the word is worked from the pairs left when the pairs that say the label are set aside, so a lead that holds without them is still ahead', () => {
  const box = sandbox();
  const { dir, briefs } = bakeoff(box, { n: 8 });
  judge(dir, sees(() => ON));
  for (const brief of briefs.slice(0, 2)) fs.appendFileSync(path.join(folder(dir, brief.id, ON), 'index.html'), '<footer>UNREVIEWED mockup</footer>\n');
  keyFromBeforeTheScan(dir);
  const result = scored(box, dir);
  assert.equal(result.wins[ON], 8);
  assert.deepEqual(result.setAside.wins, { [OFF]: 0, [ON]: 6 });
  assert.equal(result.verdict.word, 'ahead', 'six of six are left, which clears the sign test');
  assert.equal(result.verdict.arm, ON);
  assert.ok(result.cautions.some((text) => /Those 2 pairs are set aside from the word/.test(text)));
  box.cleanup();
});
