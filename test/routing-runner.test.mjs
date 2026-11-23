import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ROOT, sandbox, write } from './helpers.mjs';

const RUNNER = path.join(ROOT, 'evals', 'runners', 'cursor-sdk.mjs');

// A stand-in for bin/100x.mjs. It answers the first skill in the list it was shown, or does what the file `mode` says.
function fakeBin(home) {
  const bin = path.join(home, 'fake100x.mjs');
  write(bin, `import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const at = (flag) => args[args.indexOf(flag) + 1];
const mode = fs.existsSync(path.join(${JSON.stringify(home)}, 'mode')) ? fs.readFileSync(path.join(${JSON.stringify(home)}, 'mode'), 'utf8').trim() : 'ok';
fs.appendFileSync(path.join(${JSON.stringify(home)}, 'calls.log'), path.basename(at('--task-file')) + ' ' + at('--model') + ' ' + at('--effort') + ' ' + at('--context') + ' ' + at('--cwd') + '\\n');
const task = fs.readFileSync(at('--task-file'), 'utf8');
const first = task.match(/^- ([a-z0-9-]+):/m)[1];
if (mode === 'down') process.exit(1);
if (mode === 'limited') {
  const counter = path.join(${JSON.stringify(home)}, 'limited-' + path.basename(at('--task-file')));
  const seen = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  fs.writeFileSync(counter, String(seen + 1));
  if (seen < 3) { console.error('100x: The Cursor SDK failed before the helper ran: You have exceeded the rate limit of 30 requests per minute for the get_models endpoint'); process.exit(1); }
}
if (mode === 'other') { console.log(JSON.stringify({ status: 'finished', modelCheck: 'mismatch', text: '{"skill":"none"}', exitCode: 3 })); process.exit(3); }
const text = mode === 'chatty' ? 'Looking at the list, the fit is {"skill":"not-a-skill"}, or {"skill":"none"}, no wait: {"skill":"' + first + '"}.' : '{"skill":"' + first + '"}';
const ran = { id: at('--model'), params: [{ id: 'reasoning_effort', value: at('--effort') }, { id: 'context', value: at('--context') }] };
fs.writeFileSync(at('--receipt'), JSON.stringify({ status: 'finished', requested: ran, ran, modelCheck: 'same', seconds: 1, tokens: 100 }));
console.log(JSON.stringify({ status: 'finished', text, modelCheck: 'same', tokens: 100, exitCode: 0 }));
`);
  return bin;
}

function staged(home) {
  const dir = path.join(home, 'staged');
  write(path.join(dir, 'prompts.json'), JSON.stringify([{ id: 'p1', text: 'one' }, { id: 'p2', text: 'two' }, { id: 'p3', text: 'three' }]));
  write(path.join(dir, 'skills.json'), JSON.stringify([{ name: 'alpha', description: 'a' }, { name: 'beta', description: 'b' }, { name: 'gamma', description: 'c' }]));
  return dir;
}

// The fake answers with the first skill of the list its message showed, and the list is shuffled for each message.
const firstListed = (dir, id) => fs.readFileSync(path.join(dir, 'tasks', `${id}.md`), 'utf8').match(/^- ([a-z0-9-]+):/m)[1];

const run = (dir, bin, extra = []) => spawnSync(process.execPath, [RUNNER, 'answer', dir, '--bin', bin, '--parallel', '2', '--gap', '0', '--wait', '0', ...extra], { encoding: 'utf8' });

test('each message goes to the helper once with the model, effort and context asked for, from an empty folder, and the answers file and its record say which model ran', () => {
  const home = sandbox().dir;
  const bin = fakeBin(home);
  const dir = staged(home);
  const result = run(dir, bin, ['--model', 'some-model', '--effort', 'high', '--context', '200k']);
  assert.equal(result.status, 0, result.stderr);
  const answers = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
  assert.deepEqual(Object.keys(answers), ['p1', 'p2', 'p3']);
  for (const [id, skill] of Object.entries(answers)) assert.equal(skill, firstListed(dir, id), `${id} got the answer to its own message`);
  const calls = fs.readFileSync(path.join(home, 'calls.log'), 'utf8').trim().split('\n');
  assert.equal(calls.length, 3);
  for (const call of calls) assert.match(call, / some-model high 200k \/.*route-empty-/, 'the helper ran in a folder that holds nothing');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'answers-meta.json'), 'utf8'));
  assert.equal(meta.model, 'some-model');
  assert.equal(meta.tokens, 300);
  assert.deepEqual(meta.modelChecks, ['same']);
  assert.match(meta.ranAs[0], /^some-model .*reasoning_effort.*high/);
  assert.equal(fs.readdirSync(path.join(dir, 'receipts')).length, 3);
  const task = fs.readFileSync(path.join(dir, 'tasks', 'p1.md'), 'utf8');
  assert.match(task, /"""\none\n"""/);
  assert.match(task, /Use no tools/);
});

test('the last JSON object in a chatty reply that names a listed skill is the answer', () => {
  const home = sandbox().dir;
  const bin = fakeBin(home);
  const dir = staged(home);
  write(path.join(home, 'mode'), 'chatty');
  const result = run(dir, bin);
  assert.equal(result.status, 0, result.stderr);
  const answers = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
  for (const [id, skill] of Object.entries(answers)) assert.equal(skill, firstListed(dir, id), `${id}: the last JSON object that names a skill is the answer`);
});

test('a helper that cannot start writes no answers file, and a run started again keeps what was answered and asks only for the rest', () => {
  const home = sandbox().dir;
  const bin = fakeBin(home);
  const dir = staged(home);
  write(path.join(home, 'mode'), 'down');
  const failed = run(dir, bin);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /3 messages got no usable answer in three tries \(p1, p2, p3\)\. Nothing was written/);
  assert.equal(fs.existsSync(path.join(dir, 'answers.json')), false);
  fs.rmSync(path.join(home, 'calls.log'));
  write(path.join(home, 'mode'), 'ok');
  assert.equal(run(dir, bin).status, 0);
  assert.equal(fs.readFileSync(path.join(home, 'calls.log'), 'utf8').trim().split('\n').length, 3);
  fs.rmSync(path.join(home, 'calls.log'));
  assert.equal(run(dir, bin).status, 0);
  assert.equal(fs.existsSync(path.join(home, 'calls.log')), false, 'every message was already answered, so no helper started');
});

test('a run the SDK says was another model stops the answerer, and with no folder named it prints its usage', () => {
  const home = sandbox().dir;
  const bin = fakeBin(home);
  const dir = staged(home);
  write(path.join(home, 'mode'), 'other');
  const result = run(dir, bin);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /another model than the one asked for/);
  assert.equal(fs.existsSync(path.join(dir, 'answers.json')), false);
  const usage = spawnSync(process.execPath, [RUNNER, 'answer'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /cursor-sdk\.mjs answer <dir>/);
});

test('a start the SDK refused for its rate limit is waited out, three times over for one message, and is not one of the three tries', () => {
  const home = sandbox().dir;
  const bin = fakeBin(home);
  const dir = staged(home);
  write(path.join(home, 'mode'), 'limited');
  const result = run(dir, bin);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /rate limit was reached, waiting 0 s/);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'))).length, 3);
});
