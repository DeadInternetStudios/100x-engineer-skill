import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { targetIsOurs } from '../lib/project.mjs';
import { cli, sandbox } from './helpers.mjs';
import { blankPng, encodePng } from './png.mjs';
import { CHECK_OUTPUT, makeProject, matrixJson, PROJECT_MD, runJson, seal } from './projects.mjs';

const finish = (box, ...args) => cli(['finish', ...args], { cwd: box.project, env: box.env });
const check = (kind, status, summary) => ({ kind, status, summary });

// The same picture, but saying it has 16 bits to a channel, so the checker cannot read its pixels.
function sixteenBitPng() {
  const png = Buffer.from(encodePng(320, 240, () => [10, 20, 30, 255]));
  png[24] = 16;
  return png;
}

function refused(name, setup, pattern) {
  test(`finish refuses ${name}`, () => {
    const box = sandbox();
    makeProject(box, setup);
    const result = finish(box);
    assert.equal(result.code, 1, result.out);
    assert.match(result.err, pattern);
    assert.equal(cli(['registry', 'list', '--json'], { env: box.env }).out.trim(), '[]', 'a refused run is not registered');
    box.cleanup();
  });
}

refused('a hero that is not an image', { hero: Buffer.from('not a png at all\n'.repeat(4)) }, /hero .* is not a PNG, JPEG, WebP or GIF image/);
refused('a hero outside the project folder', { run: runJson({ hero: '/etc/hosts' }) }, /hero \/etc\/hosts is outside the project folder/);
refused('a blank hero, the sign the page was not up', { hero: blankPng() }, /looks blank/);
refused('a hero that is only a few pixels', { hero: encodePng(8, 8, () => [0, 0, 0, 255]) }, /is only 8 by 8 pixels/);
refused('a project with no resolution matrix and no reason', { matrix: false }, /no resolution matrix\. Run `100x shots/);
refused('a matrix from before the run started', { matrix: { startedAt: '2020-01-01T00:00:00.000Z' } }, /before this run started, so it measured other code/);
refused('a screen run of someone else\'s site, signed by the tool', { matrix: { target: 'https://example.com/' } }, /the final matrix looked at https:\/\/example\.com\/, which is not this project/);
refused('a screen-sizes check backed by a run of someone else\'s site', { matrix: { target: 'https://example.com/' } }, /The all-rotate run in \.100x\/shots looked at https:\/\/example\.com\/, which is not this project/);
test('screens of a page on this machine or this network count as the project\'s own, and a public address does not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x100-ours-'));
  for (const target of ['http://localhost:5173/', 'http://127.0.0.1:3000/', 'http://[::1]:8080/', 'http://app.localhost:3000/', 'http://192.168.1.20:5173/', 'http://10.0.0.7:3000/', 'http://172.20.3.4:8000/', 'http://172.31.255.1/', 'http://my-mac.local:3000/', 'http://[fe80::1]:3000/']) assert.equal(targetIsOurs(root, target, {}), true, target);
  for (const target of ['https://example.com/', 'http://172.32.0.1/', 'http://172.15.0.1/', 'http://11.0.0.1/', 'http://192.169.1.1/', 'http://notlocal.com/', 'ftp://192.168.1.1/']) assert.equal(targetIsOurs(root, target, {}), false, target);
  assert.equal(targetIsOurs(root, 'https://staging.example.com/', { url: 'https://staging.example.com/play' }), true, 'the address run.json names is the project\'s own');
  fs.rmSync(root, { recursive: true, force: true });
});

refused('a screen run of a file outside the project', { matrix: { target: 'file:///etc/hosts' } }, /the final matrix looked at file:\/\/\/etc\/hosts, which is not this project/);
refused('a ship with broken findings in the final matrix', { matrix: { broken: 3 } }, /verdict is ship but the final matrix has 3 broken findings/);
refused('a closed ask whose evidence points at nothing', { projectMd: PROJECT_MD.replace('(evidence: shots/final)', '(evidence: wherever)') }, /ask "a thing that glows \(evidence: wherever\)" has evidence that points at nothing a reader can check\. Name a commit, a file, a command in backticks or a number/);
refused('a closed ask with no evidence', { projectMd: PROJECT_MD.replace(' (evidence: shots/final)', '') }, /ask "a thing that glows" is closed without evidence/);
refused('a ship whose must-not-break check fails', { run: runJson({ mustNotBreak: check('numbers', 'fail', '3 of 40 golden cases fail') }), checkFiles: { numbers: 'not ok 3\nℹ fail 3\n' } }, /verdict is ship but a must-not-break check fails/);
refused('a must-not-break check summary with no numbers', { run: runJson({ mustNotBreak: check('screen-sizes', 'pass', 'looks good everywhere') }) }, /summary has no numbers/);
refused('a must-not-break check that claims a result with no output behind it', { run: runJson({ mustNotBreak: check('numbers', 'pass', '12 of 12 cases') }), checkFiles: {} }, /It says pass but there is no output to back it up. Save the check output to \.100x\/must-not-break\/numbers\.txt/);
refused('a screen-sizes check with no all-rotate screen run behind it, however good its words', { matrix: { matrix: 'all' } }, /the must-not-break check "screen-sizes"\. It says pass but no all-rotate screen run backs it up\. Run `100x shots <url> --label must-not-break --matrix all-rotate --resize-test`/);
refused('a final matrix that 100x shots did not write', { sealed: false }, /the final matrix was not written by `100x shots`, or it was changed after it was, so it does not count/);
refused('a run that polished once when the setting asks for three, which a claim of one cannot hide', { run: runJson({ polishPasses: 1 }), polished: 3 }, /this run left 1 polish pass behind and a run takes 3 \(`polish\.passes`\)\. Run the missing 2 passes, each with its judge/);
refused('a run with no polish passes at all', { run: runJson({ polishPasses: 0 }), polished: 3 }, /this run left no polish passes behind and a run takes 3/);
// A plain clock set for 100 minutes, with this much of it used.
function clockUsed(box, percent) {
  const total = 100 * 60000;
  const now = Date.now();
  fs.writeFileSync(path.join(box.project, '.100x', 'clock.json'), JSON.stringify({ setAt: new Date(now - (total * percent) / 100).toISOString(), deadline: new Date(now + (total * (100 - percent)) / 100).toISOString() }));
}

test('a run whose clock is 80 percent used finishes with fewer polish passes than the setting, and the report says how many ran', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ polishPasses: 1 }), polished: 3 });
  clockUsed(box, 85);
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8'), /Polish passes: 1 of 3/);
  assert.match(fs.readFileSync(path.join(box.project, '.100x', 'REPORT.html'), 'utf8'), /Polish passes[^]*?1 of 3/);
  box.cleanup();
});

test('a run whose clock is half used is still refused for fewer polish passes than the setting', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ polishPasses: 1 }), polished: 3 });
  clockUsed(box, 50);
  const result = finish(box);
  assert.equal(result.code, 1, result.out);
  assert.match(result.err, /this run left 1 polish pass behind and a run takes 3[^]*once 80 percent of the clock is used/);
  box.cleanup();
});

test('a project set to fewer polish passes than the owner usually asks for says so in the report', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ polishPasses: 1 }), polished: 3 });
  assert.equal(cli(['config', 'set', 'polish.passes', '1', '--local'], { cwd: box.project, env: box.env }).code, 0);
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8'), /Polish passes: 1 of 3/);
  box.cleanup();
});

refused('polish passes nobody ran', { loops: false }, /run\.json says 3 polish passes but \.100x holds none\. A pass leaves its shots in \.100x\/shots\/pass-N and its judge in \.100x\/loops\/pass-N/);
refused('a reviewed run with no judge in the decision log', { reviewRow: false }, /a reviewed run has no review row in the decision log/);
refused('a JPEG hero, which cannot be checked for a blank page', { hero: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]), Buffer.alloc(40)]) }, /hero .* is a JPEG\. A hero is a PNG screenshot, because only a PNG can be checked for a blank page/);
refused('a PNG hero this check cannot read, which could be blank', { hero: sixteenBitPng() }, /is a PNG this check cannot read \(16 bit, interlaced or with a palette\), so it cannot tell a blank page from a real one/);
refused('a must-not-break check pass that its own output contradicts', { checkFiles: { 'screen-sizes': 'ok 10\nℹ pass 10\nℹ fail 2\n' } }, /It says pass but \.100x\/must-not-break\/screen-sizes\.txt reports 2 failing/);
refused('a must-not-break check pass whose saved output still has a FAIL line from the template', { checkFiles: { 'screen-sizes': 'pass  finite. 48 h of play\nFAIL  gaps. longest wait 60.5 min, limit 20\npass  offline. 0 error\n' } }, /It says pass but \.100x\/must-not-break\/screen-sizes\.txt has a FAIL line/);
refused('a skipped check without a reason', { run: runJson({ mustNotBreak: check('screen-sizes', 'skipped', 'later') }) }, /You skipped it, so the summary must say why/);
refused('three checks, because an app has one or two', {
  run: runJson({ mustNotBreak: [check('screen-sizes', 'pass', '0 broken of 212'), check('numbers', 'pass', '12 of 12 cases'), check('main-flow', 'pass', '3 of 3 flows')] }),
  checkFiles: { 'screen-sizes': CHECK_OUTPUT, numbers: CHECK_OUTPUT, 'main-flow': CHECK_OUTPUT },
}, /There are 3 must-not-break checks/);
refused('the same check listed twice', { run: runJson({ mustNotBreak: [check('numbers', 'pass', '12 of 12 cases'), check('numbers', 'pass', '12 of 12 cases')] }), checkFiles: { numbers: CHECK_OUTPUT } }, /The must-not-break check "numbers" is listed twice/);
refused('a must-not-break check kind that is not one word', { run: runJson({ mustNotBreak: check('Money Math!', 'pass', '12 of 12 cases') }) }, /kind must be one lowercase word/);

test('a hero that is a link out of the project is followed and refused', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ hero: '.100x/shots/final/link.png' }) });
  fs.symlinkSync('/etc/hosts', path.join(box.project, '.100x', 'shots', 'final', 'link.png'));
  const result = finish(box);
  assert.equal(result.code, 1);
  assert.match(result.err, /is outside the project folder/);
  box.cleanup();
});

test('a project with no screen records why, and finish says so instead of hiding it', () => {
  const box = sandbox();
  makeProject(box, { matrix: false, run: runJson({ matrixSkipped: 'it is a command line tool with no screen', mustNotBreak: check('main-flow', 'pass', '3 of 3 flows') }), checkFiles: { 'main-flow': CHECK_OUTPUT } });
  const result = finish(box);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /warn\s+no resolution matrix, skipped because it is a command line tool/);
  assert.match(result.out, /Screen sizes: skipped, it is a command line tool with no screen/);
  assert.match(fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8'), /Screen sizes: skipped, it is a command line tool/);
  box.cleanup();
});

test('a fine run with a few broken findings still finishes and the warning names the count', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ verdict: 'fine', mustNotBreak: check('main-flow', 'pass', '3 of 3 flows') }), matrix: { broken: 2 }, checkFiles: { 'main-flow': CHECK_OUTPUT } });
  const result = finish(box);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /warn\s+the final matrix still has 2 broken findings/);
  box.cleanup();
});

test('two checks finish together and the report, summary and registry show both', () => {
  const box = sandbox();
  makeProject(box, {
    run: runJson({ mustNotBreak: [check('screen-sizes', 'pass', '0 broken of 212 elements across 15 viewports'), check('game-economy', 'pass', '9 of 9 milestones within 5% of the curve')] }),
    checkFiles: { 'screen-sizes': CHECK_OUTPUT, 'game-economy': 'milestone 1 ok\nmilestone 9 ok\n9 of 9 within tolerance\n' },
  });
  const result = finish(box);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Must not break: screen sizes passed \(0 broken of 212/);
  assert.match(result.out, /Must not break: game economy passed \(9 of 9 milestones/);
  const report = fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8');
  assert.match(report, /Must not break: screen sizes passed/);
  assert.match(report, /Must not break: game economy passed/);
  const [entry] = JSON.parse(cli(['registry', 'list', '--json'], { env: box.env }).out);
  assert.deepEqual(entry.mustNotBreak.map((c) => c.kind), ['screen-sizes', 'game-economy']);
  const morning = cli(['morning', '--all'], { env: box.env });
  assert.match(morning.out, /checks screen sizes passed, game economy passed/);
  box.cleanup();
});

test('a screen-sizes check is backed by an all-rotate screen run that 100x shots signed, and a run with broken findings contradicts a pass', () => {
  const box = sandbox();
  makeProject(box, { checkFiles: {}, matrix: { matrix: 'all' } });
  const file = path.join(box.project, '.100x', 'shots', 'must-not-break', 'matrix.json');
  const matrix = (broken) => JSON.stringify(matrixJson({ broken, viewports: 2, matrix: 'all-rotate' }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matrix(0));
  const forged = finish(box, '--check');
  assert.equal(forged.code, 1);
  assert.match(forged.out, /It says pass but no all-rotate screen run backs it up\. The all-rotate run in \.100x\/shots was not written by `100x shots`, or was changed after it was\./);
  seal(box, file);
  assert.equal(finish(box, '--check').code, 0);
  fs.writeFileSync(file, matrix(4));
  assert.match(finish(box, '--check').out, /was not written by `100x shots`, or was changed after it was/, 'an edit after the signing breaks it');
  seal(box, file);
  const bad = finish(box, '--check');
  assert.equal(bad.code, 1);
  assert.match(bad.out, /It says pass but the newest all-rotate screen run "must-not-break" has 4 broken findings/);
  box.cleanup();
});

test('an earlier red all-rotate run does not block a pass once a newer one is green, and a newer red one still does', () => {
  const box = sandbox();
  makeProject(box, { checkFiles: {}, matrix: { matrix: 'all' } });
  const put = (label, broken, startedAt) => {
    const file = path.join(box.project, '.100x', 'shots', label, 'matrix.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(matrixJson({ broken, viewports: 2, matrix: 'all-rotate', startedAt })));
    seal(box, file);
  };
  put('pass-3', 4, new Date(Date.now() - 2000).toISOString());
  put('must-not-break', 0, new Date().toISOString());
  const fixed = finish(box, '--check');
  assert.equal(fixed.code, 0, fixed.out + fixed.err);
  put('later-red', 3, new Date(Date.now() + 2000).toISOString());
  const worse = finish(box, '--check');
  assert.equal(worse.code, 1);
  assert.match(worse.out, /the newest all-rotate screen run "later-red" has 3 broken findings/);
  box.cleanup();
});

test('a hand written finishedAt does not make a run count as finished, only finish does', () => {
  const box = sandbox();
  makeProject(box);
  const file = path.join(box.project, '.100x', 'run.json');
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...run, finishedAt: '2026-01-01T00:00:00.000Z' }));
  const before = cli(['status'], { cwd: box.project, env: box.env });
  assert.match(before.out, /Run\s+NOT FINISHED/);
  assert.equal(finish(box).code, 0);
  const after = cli(['status'], { cwd: box.project, env: box.env });
  assert.match(after.out, /Run\s+FINISHED/);
  assert.ok(fs.existsSync(path.join(box.project, '.100x', 'finished.json')));
  box.cleanup();
});

test('a finished marker from another run does not count', () => {
  const box = sandbox();
  makeProject(box);
  fs.writeFileSync(path.join(box.project, '.100x', 'finished.json'), JSON.stringify({ runId: 'someoneelse', finishedAt: new Date().toISOString() }));
  assert.match(cli(['status'], { cwd: box.project, env: box.env }).out, /Run\s+NOT FINISHED/);
  box.cleanup();
});

test('a polish pass with no loop judge is refused, and finishes once the judge answered', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ polishPasses: 1 }), loops: false });
  fs.mkdirSync(path.join(box.project, '.100x', 'shots', 'pass-1'), { recursive: true });
  const refused = finish(box);
  assert.notEqual(refused.code, 0);
  assert.match(refused.err + refused.out, /loop pass-1 has no judge/);
  const dir = path.join(box.project, '.100x', 'loops', 'pass-1');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of [['ask.md', 'Pass 1. Structure.\n'], ['judge.md', 'Judged by: looking\nF1 [major] the shop button is buried.\nDrifting: no\nBetter: yes\n'], ['answers.md', 'F1 fixed, the button sits above the fold.\n']]) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  box.cleanup();
});

test('a project with a screen needs pictures for every polish pass as well as its judge, and one with no screen needs the judge only', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ polishPasses: 1 }), loops: false });
  const dir = path.join(box.project, '.100x', 'loops', 'pass-1');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of [['ask.md', 'Pass 1. Structure.\n'], ['judge.md', 'Judged by: looking\nDrifting: no\nBetter: yes\n'], ['answers.md', 'Nothing to answer.\n']]) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  const refused = finish(box);
  assert.notEqual(refused.code, 0, refused.err + refused.out);
  assert.match(refused.err + refused.out, /polish pass-1 has a judge folder and no pictures/);
  fs.mkdirSync(path.join(box.project, '.100x', 'shots', 'pass-1'), { recursive: true });
  assert.equal(finish(box).code, 0, 'the pictures are there, so it finishes');
  box.cleanup();
  const bare = sandbox();
  makeProject(bare, { matrix: false, loops: false, run: runJson({ polishPasses: 1, matrixSkipped: 'a command line tool has no screen', mustNotBreak: check('main-flow', 'pass', '3 of 3 flows') }), checkFiles: { 'main-flow': CHECK_OUTPUT } });
  const bareDir = path.join(bare.project, '.100x', 'loops', 'pass-1');
  fs.mkdirSync(bareDir, { recursive: true });
  for (const [name, text] of [['ask.md', 'Pass 1. Structure.\n'], ['judge.md', 'Judged by: running\nDrifting: no\nBetter: yes\n'], ['answers.md', 'Nothing to answer.\n']]) {
    fs.writeFileSync(path.join(bareDir, name), text);
  }
  const done = finish(bare);
  assert.equal(done.code, 0, done.err + done.out);
  bare.cleanup();
});

test('a pass whose judge ended not better, or drifting, still finishes, and finish says which loop to read', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ polishPasses: 1 }), loops: false });
  fs.mkdirSync(path.join(box.project, '.100x', 'shots', 'pass-1'), { recursive: true });
  const dir = path.join(box.project, '.100x', 'loops', 'pass-1');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of [['ask.md', 'Pass 1. Structure.\n'], ['judge.md', 'Judged by: looking\nF1 [blocker] the page lost its character.\nDrifting: yes\nBetter: no\n'], ['answers.md', 'F1 fixed, the hero is back.\n']]) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /warn\s+loop pass-1: its judge ended Better: no\. Finish does not refuse on that\. Read \.100x\/loops\/pass-1\/judge\.md before you ship\./);
  box.cleanup();
});

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('screens of a file do not back a run that opens at an address, nor screens of a page a run that opens a file', () => {
  const lone = sandbox();
  const file = pathToFileURL(path.join(lone.project, 'trivial.html')).href;
  makeProject(lone, { matrix: { target: file } });
  const fileForAddress = finish(lone);
  assert.equal(fileForAddress.code, 1, fileForAddress.out);
  assert.match(fileForAddress.err, new RegExp(`the final matrix looked at ${escapeRe(file)}, but run\\.json says the app opens at http://127\\.0\\.0\\.1:5999/\\. The screens have to be of what the owner opens`));
  assert.match(fileForAddress.err, /all-rotate run in \.100x\/shots looked at file:\/\/.*trivial\.html, but run\.json says the app opens at http:\/\/127\.0\.0\.1:5999\//);
  lone.cleanup();
  const page = sandbox();
  const opened = pathToFileURL(path.join(page.project, 'index.html')).href;
  makeProject(page, { matrix: { target: 'http://127.0.0.1:5999/' }, run: runJson({ url: opened }) });
  const addressForFile = finish(page);
  assert.equal(addressForFile.code, 1, addressForFile.out);
  assert.match(addressForFile.err, /the final matrix looked at http:\/\/127\.0\.0\.1:5999\/, but run\.json says the app opens at file:\/\/.*index\.html/);
  page.cleanup();
});

refused('a run command that starts a package script the project does not have', { run: runJson({ runCmd: 'npm run serve' }) }, /runCmd \(npm run serve\) runs the package script "serve", and package\.json has only dev, start\. The report page runs it in the project folder/);
refused('a run command that names a file the project does not have', { run: runJson({ runCmd: 'PORT=4000 node server/main.mjs' }) }, /runCmd \(PORT=4000 node server\/main\.mjs\) runs server\/main\.mjs, and the project folder has no such file/);

test('a screen run of a page on this machine, a file in the project, or the address run.json names is evidence', () => {
  const targets = (box) => [
    'http://localhost:51234',
    'http://127.0.0.1:4173/play',
    'http://[::1]:3000/',
    `file://${path.join(box.project, 'index.html')}`,
    'https://preview-123.example-host.app/',
  ];
  for (const index of [0, 1, 2, 3, 4]) {
    const box = sandbox();
    const target = targets(box)[index];
    makeProject(box, { matrix: { target }, run: runJson(index === 4 ? { ship: { preview: 'https://preview-123.example-host.app/' } } : index === 3 ? { url: target } : {}) });
    const result = finish(box);
    assert.equal(result.code, 0, `${target}: ${result.err}`);
    box.cleanup();
  }
});
