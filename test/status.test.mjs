import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cli, sandbox, write } from './helpers.mjs';

const status = (box, ...args) => cli(['status', ...args], { cwd: box.project, env: box.env });
const lineOf = (text, label) => text.split('\n').find((line) => line.startsWith(label));

function project(box, state) {
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  write(path.join(box.project, '.100x', 'STATE.md'), state);
  return path.join(box.project, '.100x', 'STATE.md');
}

test('status in a folder with no run says there is no run, and does not send the agent to init first', () => {
  const box = sandbox();
  const result = status(box);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /No run in this folder, so there is nothing to report or continue\./);
  assert.doesNotMatch(result.err, /in the project first/);
  box.cleanup();
});

test('status cuts the long Stage, Next and Risks paragraphs and points at the file', () => {
  const box = sandbox();
  const long = (word) => `${word} `.repeat(120).trim();
  project(box, `Stage: ${long('stage')}\nNext: ${long('next')}\nOpen risks: ${long('risk')}\n`);
  const out = status(box).out;
  for (const name of ['Stage', 'Next', 'Risks']) {
    const line = lineOf(out, name);
    assert.ok(line.length < 260, `${name} is ${line.length} characters`);
    assert.match(line, /… \(all of it is in \.100x\/STATE\.md\)$/);
  }
  const short = project(box, 'Stage: 3 Build\nNext: write the tests\n');
  assert.ok(short);
  assert.equal(lineOf(status(box).out, 'Next'), 'Next       write the tests');
  box.cleanup();
});

test('status says STATE.md may be behind when the log has moved on without it', () => {
  const box = sandbox();
  const state = project(box, 'Stage: 0 Open\nNext: write project.md\n');
  cli(['log', 'core', 'Read the repo history in one pass', 'it is the whole idea', 'ran it'], { cwd: box.project, env: box.env });
  const old = new Date(Date.now() - 3 * 3600000);
  fs.utimesSync(state, old, old);
  const behind = status(box).out;
  assert.match(lineOf(behind, 'State'), /^State +STATE\.md is 1[78]\d minutes older than the last decision, so Stage and Next may be behind\. Read `100x log --tail 8` before you trust them\.$/);
  assert.equal(status(box, '--json').out.includes('"stateBehindMinutes"'), true);
  const now = new Date();
  fs.utimesSync(state, now, now);
  assert.equal(lineOf(status(box).out, 'State'), undefined, 'a STATE.md written after the last decision is not behind');
  box.cleanup();
});
