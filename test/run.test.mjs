import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { cli, sandbox } from './helpers.mjs';
import { makeProject } from './projects.mjs';

const runCmd = (box, ...args) => cli(['run', ...args], { cwd: box.project, env: box.env });
const readRun = (box) => JSON.parse(fs.readFileSync(path.join(box.project, '.100x', 'run.json'), 'utf8'));

test('set keeps numbers and words as the right types, and text keys stay text', () => {
  const box = sandbox();
  makeProject(box, { run: {} });
  assert.equal(runCmd(box, 'set', 'verdict', 'ship').code, 0);
  assert.equal(runCmd(box, 'set', 'polishPasses', '3').code, 0);
  assert.equal(runCmd(box, 'set', 'title', '2048').code, 0);
  assert.equal(runCmd(box, 'set', 'pitch', 'An idle game', 'about', 'a', 'lighthouse.').code, 0);
  const run = readRun(box);
  assert.equal(run.verdict, 'ship');
  assert.strictEqual(run.polishPasses, 3);
  assert.strictEqual(run.title, '2048');
  assert.equal(run.pitch, 'An idle game about a lighthouse.');
  box.cleanup();
});

test('the old verdict and moment spellings still set, and store and print the new words', () => {
  const box = sandbox();
  makeProject(box, { run: {} });
  assert.equal(runCmd(box, 'set', 'verdict', 'wow').code, 0);
  assert.equal(runCmd(box, 'set', 'wow', 'The first tap lights the whole screen.').code, 0);
  const run = readRun(box);
  assert.equal(run.verdict, 'ship');
  assert.equal(run.moment, 'The first tap lights the whole screen.');
  assert.equal('wow' in run, false);
  const shown = runCmd(box, 'show', '--json');
  assert.equal(JSON.parse(shown.out).verdict, 'ship');
  assert.equal(JSON.parse(shown.out).moment, 'The first tap lights the whole screen.');
  assert.doesNotMatch(shown.out, /"wow"/);
  assert.equal(runCmd(box, 'unset', 'wow').code, 0, 'the old key unsets the new one');
  assert.equal('moment' in readRun(box), false);
  box.cleanup();
});

test('a run.json that no longer parses says how to start a fresh one, and that works', () => {
  const box = sandbox();
  makeProject(box, { run: {} });
  const file = path.join(box.project, '.100x', 'run.json');
  fs.writeFileSync(file, '{ "title": ');
  for (const args of [['status'], ['run', 'set', 'title', 'Tip splitter']]) {
    const refused = cli(args, { cwd: box.project, env: box.env });
    assert.notEqual(refused.code, 0, args.join(' '));
    assert.match(refused.err, /Invalid JSON in .*run\.json/);
    assert.match(refused.err, /mv .*run\.json .*run\.json\.bad/);
  }
  fs.renameSync(file, `${file}.bad`);
  assert.equal(runCmd(box, 'set', 'title', 'Tip splitter').code, 0);
  assert.equal(readRun(box).title, 'Tip splitter');
  box.cleanup();
});

test('set refuses a verdict outside the three words, a bad pass count and a key that does not exist', () => {
  const box = sandbox();
  makeProject(box, { run: {} });
  assert.match(runCmd(box, 'set', 'verdict', 'great').err, /verdict must be one of ship, fine, dud/);
  assert.match(runCmd(box, 'set', 'polishPasses', 'three').err, /polishPasses must be a whole number/);
  const unknown = runCmd(box, 'set', 'verdit', 'ship');
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /Unknown key "verdit"\. The keys are title, pitch, verdict/);
  assert.match(runCmd(box, 'set', 'review.__proto__.x', '1').err, /is not allowed/);
  assert.equal(Object.keys(readRun(box)).length, 0);
  box.cleanup();
});

test('mode takes mockup and nothing else', () => {
  const box = sandbox();
  makeProject(box, { run: {} });
  assert.equal(runCmd(box, 'set', 'mode', 'mockup').code, 0);
  assert.equal(readRun(box).mode, 'mockup');
  assert.match(runCmd(box, 'set', 'mode', 'fast').err, /mode can only be mockup/);
  assert.equal(readRun(box).mode, 'mockup');
  box.cleanup();
});

test('dotted keys reach inside objects and lists, and push builds lists', () => {
  const box = sandbox();
  makeProject(box, { run: {} });
  runCmd(box, 'set', 'review.status', 'reviewed');
  runCmd(box, 'set', 'review.model', 'muse-wonder-1.0');
  runCmd(box, 'push', 'tryFirst', 'Tap once');
  runCmd(box, 'push', 'tryFirst', '20');
  runCmd(box, 'push', 'features', '{"name":"Prestige","cutHint":"delete src/prestige"}');
  runCmd(box, 'set', 'features.0.cutHint', 'delete src/prestige and its import');
  const run = readRun(box);
  assert.deepEqual(run.review, { status: 'reviewed', model: 'muse-wonder-1.0' });
  assert.deepEqual(run.tryFirst, ['Tap once', '20']);
  assert.deepEqual(run.features, [{ name: 'Prestige', cutHint: 'delete src/prestige and its import' }]);
  assert.match(runCmd(box, 'push', 'title', 'x').err, /is not a list|Usage/);
  box.cleanup();
});

test('a whole list of steps is set as JSON, with every entry as text, and a lone sentence is turned away with the way to do it', () => {
  const box = sandbox();
  makeProject(box, { run: {} });
  assert.equal(runCmd(box, 'set', 'tryFirst', '["Tap once", "Rotate the phone"]').code, 0);
  assert.equal(runCmd(box, 'set', 'nextAsks', '[2048, "Daily rewards"]').code, 0);
  assert.deepEqual(readRun(box).tryFirst, ['Tap once', 'Rotate the phone']);
  assert.deepEqual(readRun(box).nextAsks, ['2048', 'Daily rewards']);
  const lone = runCmd(box, 'set', 'tryFirst', 'Tap once');
  assert.equal(lone.code, 1);
  assert.match(lone.err, /tryFirst is a list\. Add one with `100x run push tryFirst "<one line>"`, or write the whole list with `100x run set tryFirst '\["first","second"\]'`/);
  assert.deepEqual(readRun(box).tryFirst, ['Tap once', 'Rotate the phone'], 'a refused set leaves the list alone');
  runCmd(box, 'push', 'tryFirst', '["not a list"]');
  assert.equal(readRun(box).tryFirst.at(-1), '["not a list"]', 'push adds one sentence as typed');
  assert.equal(runCmd(box, 'set', 'tryFirst.0', 'Tap twice').code, 0, 'one step can be replaced by its place');
  assert.equal(readRun(box).tryFirst[0], 'Tap twice');
  box.cleanup();
});

test('features are written as a list of named features, and anything else is turned away with the way to do it', () => {
  const box = sandbox();
  makeProject(box, { run: {} });
  const first = '{"name":"Prestige","cutHint":"delete src/prestige"}';
  assert.equal(runCmd(box, 'push', 'features', first).code, 0);
  const lone = runCmd(box, 'push', 'features', 'Prestige');
  assert.equal(lone.code, 1);
  assert.match(lone.err, /features is a list of features, each with a name and a cutHint\. Add one with `100x run push features '\{"name":"Prestige","cutHint":"delete src\/prestige"\}'`/);
  assert.match(runCmd(box, 'set', 'features', 'none').err, /features is a list of features/);
  assert.match(runCmd(box, 'set', 'features', '[null]').err, /features is a list of features/);
  assert.match(runCmd(box, 'set', 'features', '["Prestige"]').err, /features is a list of features/);
  assert.deepEqual(readRun(box).features, [JSON.parse(first)], 'a refused write leaves the list alone');
  assert.equal(runCmd(box, 'set', 'features', '[{"name":"Shop","cutHint":"delete src/shop"}]').code, 0);
  assert.equal(runCmd(box, 'set', 'features', '[]').code, 0, 'an empty list is a list');
  box.cleanup();
});

test('pushing a second must-not-break check turns the single one into a list of two', () => {
  const box = sandbox();
  makeProject(box, { run: {} });
  runCmd(box, 'set', 'mustNotBreak', '{"kind":"screen-sizes","status":"pass","summary":"0 broken of 212"}');
  assert.equal(Array.isArray(readRun(box).mustNotBreak), false);
  runCmd(box, 'push', 'mustNotBreak', '{"kind":"game-economy","status":"pass","summary":"9 of 9 milestones"}');
  assert.deepEqual(readRun(box).mustNotBreak.map((c) => c.kind), ['screen-sizes', 'game-economy']);
  box.cleanup();
});

test('unset removes a key and says when there was nothing to remove', () => {
  const box = sandbox();
  makeProject(box, { run: {} });
  runCmd(box, 'set', 'url', 'http://127.0.0.1:5173');
  assert.match(runCmd(box, 'unset', 'url').out, /removed url/);
  assert.match(runCmd(box, 'unset', 'url').out, /url was not set/);
  box.cleanup();
});

test('show prints the file, and a run built only with setters finishes', () => {
  const box = sandbox();
  // The fixture leaves the judge's log row and the three pass folders the run claims. Every fact in run.json is set below.
  makeProject(box, { run: { review: { status: 'reviewed' }, polishPasses: 3 } });
  fs.writeFileSync(path.join(box.project, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
  const steps = [
    ['set', 'title', 'Glow'],
    ['set', 'pitch', 'A thing that glows.'],
    ['set', 'verdict', 'ship'],
    ['set', 'verdictWhy', 'The glow loop held attention for 60 seconds in the core stage.'],
    ['set', 'moment', 'The first tap lights the whole screen.'],
    ['set', 'runCmd', 'npm run dev'],
    ['set', 'hero', '.100x/shots/final/hero-src.png'],
    ['push', 'tryFirst', 'Tap once'],
    ['push', 'tryFirst', 'Rotate the phone'],
    ['push', 'mustNotBreak', '{"kind":"screen-sizes","status":"pass","summary":"0 broken of 212 elements across 15 viewports"}'],
    ['set', 'review', '{"status":"reviewed","model":"muse-wonder-1.0"}'],
    ['set', 'polishPasses', '3'],
  ];
  for (const step of steps) assert.equal(runCmd(box, ...step).code, 0, step.join(' '));
  assert.equal(JSON.parse(runCmd(box, 'show', '--json').out).title, 'Glow');
  const done = cli(['finish'], { cwd: box.project, env: box.env });
  assert.equal(done.code, 0, done.err);
  box.cleanup();
});

test('port prints free ports that a server can then bind', async () => {
  const box = sandbox();
  const one = cli(['port'], { env: box.env });
  assert.equal(one.code, 0);
  const port = Number(one.out.trim());
  assert.ok(Number.isInteger(port) && port > 1023);
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
  const many = cli(['port', '--count', '4'], { env: box.env }).out.trim().split('\n');
  assert.equal(many.length, 4);
  assert.equal(new Set(many).size, 4);
  assert.match(cli(['port', '--count', '0'], { env: box.env }).err, /--count takes a whole number from 1 to 50/);
  box.cleanup();
});
