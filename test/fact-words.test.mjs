import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { factLines, paddedFacts } from '../lib/fact-words.mjs';
import { cli, sandbox } from './helpers.mjs';
import { makeProject, runJson } from './projects.mjs';

const PADDED = {
  pitch: 'A seamless, delightful tip splitter that elevates the way friends share a bill.',
  tryFirst: ['Tap once', "In today's fast-paced world, rotate the phone"],
  nextAsks: ['A game-changing daily reward'],
};

test('the facts the owner reads first are listed one by one with the key that writes each again', () => {
  const lines = factLines(runJson({ pitch: '  One\n  line  ', moment: '', nextAsks: ['Daily rewards'] }));
  assert.deepEqual(lines.map((line) => [line.key, line.name, line.text]), [
    ['pitch', 'the pitch', 'One line'],
    ['verdictWhy', 'the reason for the verdict', 'The glow loop held attention for 60 seconds in the core stage.'],
    ['tryFirst.0', 'try-first step 1', 'Tap once'],
    ['tryFirst.1', 'try-first step 2', 'Rotate the phone'],
    ['nextAsks.0', 'next ask 1', 'Daily rewards'],
  ]);
});

test('stock phrases in the facts are named with where they are and how to say them again', () => {
  const [warning, ...rest] = paddedFacts(runJson(PADDED));
  assert.equal(rest.length, 0, 'one warning, not one per phrase');
  assert.match(warning, /"seamless" in the pitch/);
  assert.match(warning, /"In today's fast-paced" in try-first step 2/);
  assert.match(warning, /"game-changing" in next ask 1/);
  assert.match(warning, /`100x run set pitch "<plainer>"`/);
});

test('plain facts and a run with no facts give nothing to say', () => {
  assert.deepEqual(paddedFacts(runJson()), []);
  assert.deepEqual(paddedFacts({}), []);
});

test('finish --check names the stock phrases as a warning and still says ready, and the real finish keeps the final message clean', () => {
  const box = sandbox();
  makeProject(box, { run: runJson(PADDED) });
  const check = cli(['finish', '--check'], { cwd: box.project, env: box.env });
  assert.equal(check.code, 0, check.err + check.out);
  assert.match(check.out, /warn {2}the words the owner reads first have stock phrases: "seamless" in the pitch/);
  assert.match(check.out, /ready to finish/);
  const done = cli(['finish'], { cwd: box.project, env: box.env });
  assert.equal(done.code, 0, done.err + done.out);
  assert.doesNotMatch(done.out, /stock phrases/);
  box.cleanup();
});

test('a writing tool that is missing is never a reason to stop a finish', () => {
  const box = sandbox();
  makeProject(box, { run: runJson(PADDED) });
  const check = cli(['finish', '--check'], { cwd: box.project, env: { ...box.env, X100_UNSLOP_TEXT_CLI: path.join(box.dir, 'no-such-tool.mjs') } });
  assert.equal(check.code, 0, check.err + check.out);
  assert.doesNotMatch(check.out, /stock phrases/);
  assert.match(check.out, /ready to finish/);
  box.cleanup();
});
