import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tickPrompt } from '../lib/watchdog.mjs';
import { cli, ROOT, sandbox } from './helpers.mjs';
import { makeProject } from './projects.mjs';

function rig() {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  return { box, env: box.env, cleanup: box.cleanup };
}

test('the tick tells the thread to ignore it while it works and carries the resume instructions', () => {
  const r = rig();
  const message = cli(['watchdog', 'prompt'], { cwd: r.box.project, env: r.env }).out;
  assert.match(message, /WATCHDOG TICK/);
  assert.match(message, /ignore this message and carry on/);
  assert.match(message, /100x status/);
  assert.match(message, /Do not ask the owner anything/);
  assert.match(message, /Delete this scheduled task with your app's own tool/);
  r.cleanup();
});

test('the tick names how each kind of judge shows it is done, in the words the judge prompts use', () => {
  const tick = tickPrompt('/tmp/project');
  assert.match(tick, /a loop judge is done when its judge\.md ends with the Drifting and Better lines/);
  assert.match(tick, /a stage 6 judge is done when \.100x\/review\/findings\.md ends with a Verdict section that has a Ready to ship line/);
  const prompts = fs.readFileSync(path.join(ROOT, 'lib', 'review.mjs'), 'utf8');
  assert.match(prompts, /"Drifting: yes" or "Drifting: no", then "Better: yes" or "Better: no"/, 'the loop judge ends the way the tick says');
  assert.match(prompts, /exactly "Ready to ship: yes" or "Ready to ship: no"/, 'the stage 6 judge ends the way the tick says');
});

test('record and clear round trip, and status shows the recorded task until it is cleared', () => {
  const r = rig();
  assert.match(cli(['watchdog', 'record'], { cwd: r.box.project, env: r.env }).err, /needs the id of the scheduled task/);
  assert.match(cli(['watchdog', 'record', 'task-abc'], { cwd: r.box.project, env: r.env }).out, /recorded task-abc/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(r.box.project, '.100x', 'watchdog.json'), 'utf8')).intervalMinutes, 20, 'the interval is the configured one');
  assert.equal(JSON.parse(fs.readFileSync(path.join(r.box.project, '.100x', 'watchdog.json'), 'utf8')).scheduledTaskId, 'task-abc');
  assert.match(cli(['status'], { cwd: r.box.project, env: r.env }).out, /Watchdog\s+task-abc\. Delete it at finish\./);
  assert.match(cli(['watchdog', 'clear'], { cwd: r.box.project, env: r.env }).out, /watchdog record removed/);
  assert.match(cli(['watchdog', 'clear'], { cwd: r.box.project, env: r.env }).out, /no watchdog was recorded/);
  assert.match(cli(['watchdog', 'record', 'x', '--minutes', '0'], { cwd: r.box.project, env: r.env }).err, /--minutes needs a positive number/);
  r.cleanup();
});

test('the modes are schedule and off, and the old script modes are refused', () => {
  const r = rig();
  assert.equal(cli(['config', 'get', 'watchdog.mode'], { cwd: r.box.project, env: r.env }).out.trim(), 'schedule');
  assert.equal(cli(['config', 'set', 'watchdog.mode', 'off', '--local'], { cwd: r.box.project, env: r.env }).code, 0);
  assert.notEqual(cli(['config', 'set', 'watchdog.mode', 'script', '--local'], { cwd: r.box.project, env: r.env }).code, 0);
  assert.match(cli(['watchdog', 'check'], { cwd: r.box.project, env: r.env }).err, /Usage: 100x watchdog prompt\|record <id>\|clear/);
  r.cleanup();
});

test('status tells the agent where it stands and when it is done', () => {
  const r = rig();
  fs.writeFileSync(path.join(r.box.project, '.100x', 'STATE.md'), '# State\n\nStage: 4 Polish, pass 2 of 3\nNext: run the audit on the shop screen\nOpen risks: the sound loop is long\n');
  const before = cli(['status'], { cwd: r.box.project, env: r.env }).out;
  assert.match(before, /Stage\s+4 Polish, pass 2 of 3/);
  assert.match(before, /Next\s+run the audit on the shop screen/);
  assert.match(before, /Risks\s+the sound loop is long/);
  assert.match(before, /Run\s+NOT FINISHED/);
  makeProject(r.box, { root: r.box.project });
  cli(['finish'], { cwd: r.box.project, env: r.env });
  const after = cli(['status'], { cwd: r.box.project, env: r.env }).out;
  assert.match(after, /Run\s+FINISHED .*Verdict ready to ship\. Call `100x-report` to see it with the rest\./);
  assert.doesNotMatch(after, /100x morning/, 'the owner does not say morning, so the status never tells them to');
  assert.match(after, /Asks\s+2 of 2 closed, 0 open/);
  assert.doesNotMatch(after, /Next /);
  const json = JSON.parse(cli(['status', '--json'], { cwd: r.box.project, env: r.env }).out);
  assert.equal(json.finished, true);
  r.cleanup();
});
