import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { browserSkip as skip, cli, ROOT, sandbox } from './helpers.mjs';
import { CHECK_OUTPUT, FINDINGS, PROMPT_MD, runJson, TRIAGE } from './projects.mjs';


// No polish passes ran in these flows (the owner asked for none with polish.passes 0), and a screen-sizes check needs an all-rotate run
// the flows do not make, so the check is the main flow.
const FLOW = { polishPasses: 0, runCmd: 'open index.html', mustNotBreak: { kind: 'main-flow', status: 'pass', summary: '3 of 3 flows' } };

test('the whole agent sequence works on a fixture project, from init to the morning gallery', { skip }, () => {
  const box = sandbox();
  const run = (...args) => cli(args, { cwd: box.project, env: box.env });
  const ok = (result, what) => assert.equal(result.code, 0, `${what} failed. ${result.out}${result.err}`);
  const dot = (...parts) => path.join(box.project, '.100x', ...parts);
  fs.copyFileSync(path.join(ROOT, 'test', 'fixtures', 'clean.html'), path.join(box.project, 'index.html'));

  ok(run('init', '--no-git'), 'init');
  // Property checks are on by default, so a run records a waiver for a page that has no logic to state.
  ok(run('verify', 'waive', 'index.html', '--why', 'a static test page with nothing to state'), 'waive');
  ok(run('config', 'set', 'polish.passes', '0', '--global'), 'no polish passes');
  ok(run('log', 'start', 'Read the brief as a glow toy', 'No one answers at night, so take the reasonable reading', 'brief text', 'ok'), 'log');
  assert.equal(run('prompt', 'check').code, 1, 'the template is not a prompt yet');
  fs.writeFileSync(dot('project.md'), PROMPT_MD);
  ok(run('prompt', 'check'), 'prompt check on the finished prompt');
  assert.match(run('status').out, /Run +NOT FINISHED/);

  const shots = run('shots', 'index.html', '--label', 'final', '--viewports', '390x844@3,1440x900@1', '--json');
  ok(shots, 'shots');
  const final = dot('shots', 'final');
  const pngs = fs.readdirSync(final).filter((name) => name.endsWith('.png') && name !== 'contact-sheet.png');
  assert.equal(pngs.length, 2);
  setRun(run, runJson({ ...FLOW, hero: `.100x/shots/final/${pngs[0]}`, url: pathToUrl(path.join(box.project, 'index.html')) }));
  fs.mkdirSync(dot('must-not-break'), { recursive: true });
  fs.writeFileSync(dot('must-not-break', 'main-flow.txt'), CHECK_OUTPUT);

  ok(run('config', 'set', 'review.rounds', '2', '--global'), 'two judge rounds');
  ok(run('brief'), 'brief');
  const brief = fs.readFileSync(dot('review', 'brief.md'), 'utf8');
  assert.match(brief, /a thing that glows/);
  assert.match(brief, /contact-sheet\.png/);
  assert.match(brief, /Round 1 of 2\. Lens: the code and how it behaves/);
  assert.match(brief, /is this ready to ship\? Be brutal/);
  ok(run('config', 'role', 'review', '--provider', 'cursor', '--model', 'muse-wonder-1.0', '--option', 'reasoning_effort=max', '--option', 'contextWindow=300k', '--global'), 'judge');
  const call = JSON.parse(run('review-call', '--json').out);
  assert.equal(call.delegateTask.role, 'review');
  assert.equal(call.delegateTask.target.model, 'muse-wonder-1.0');
  assert.equal(call.delegateTask.target.options.reasoning_effort, 'max');
  assert.deepEqual([call.round.slot, call.round.total, call.round.lens], [1, 2, 'code']);
  assert.match(call.delegateTask.task, /Round 1 of 2, the code and how it behaves/);
  ok(run('log', 'review', 'starting the second-model review', 'the code is built', 'muse-wonder-1.0'), 'log the judge');

  fs.rmSync(dot('review', 'findings.md'), { force: true });
  fs.rmSync(dot('review', 'triage.md'), { force: true });
  assert.equal(run('finish', '--check').code, 1, 'a reviewed run with no findings file cannot finish');
  fs.writeFileSync(dot('review', 'findings.md'), FINDINGS);
  assert.equal(run('triage').code, 1, 'findings without decisions block the finish');
  fs.writeFileSync(dot('review', 'triage.md'), TRIAGE);
  const closed = run('triage');
  ok(closed, 'triage');
  assert.match(closed.out, /Round 1 of 2 closed, the code and how it behaves/);
  assert.match(closed.out, /Next, `100x brief` for round 2 of 2, whether it is ready to ship/);
  const early = run('finish', '--check');
  assert.equal(early.code, 1, 'one of two rounds is not enough');
  assert.match(early.out, /the judge held 1 of 2 rounds\. Round 2 \(whether it is ready to ship\) is next/);

  ok(run('brief'), 'second brief');
  assert.equal(fs.existsSync(dot('review', 'findings.md')), false, 'the closed round is archived and cleared');
  assert.ok(fs.existsSync(dot('review', 'round-1', 'findings.md')));
  const second = fs.readFileSync(dot('review', 'brief.md'), 'utf8');
  assert.match(second, /Round 2 of 2\. Lens: whether it is ready to ship/);
  assert.match(second, /## Earlier rounds/);
  assert.match(second, /F1 \[major\] Upgrade button clipped at 320px\. accept\. fixed in a1b2c3d/);
  assert.match(second, /Would you use it, or tell a friend to/);
  assert.match(second, /Never count the lack of a price, payments, a business model or a sales route against it unless the asks name one/, 'a free or MIT-licensed product is not marked down for having no commercial route');
  assert.doesNotMatch(second, /Would you pay for it|first paying customer/);
  fs.writeFileSync(dot('review', 'findings.md'), 'No findings. I ran the matrix and the main flow.\n\n## Verdict\nReady to ship: yes\nKeep going. Nothing to change. Cut nothing.\n');
  const last = run('triage');
  ok(last, 'second triage');
  assert.match(last.out, /Round 2 of 2 closed, whether it is ready to ship\. Ready to ship: yes/);
  assert.match(last.out, /All rounds are done, 2 of 2 held/);
  ok(run('finish', '--check'), 'finish --check after both rounds');

  const finish = run('finish');
  ok(finish, 'finish');
  assert.match(finish.out, /Glow/);
  assert.match(finish.out, /Judge rounds: 2 of 2 done, and the last word was ready to ship\nLooked at: the code and how it behaves and whether it is ready to ship\n/);
  assert.ok(fs.existsSync(dot('REPORT.md')));
  assert.ok(fs.existsSync(dot('REPORT.html')));
  assert.match(finish.out, /Report: file:\/\/.*\/\.100x\/REPORT\.html/);
  assert.match(run('status').out, /Run +FINISHED/i);
  assert.equal(JSON.parse(run('registry', 'list', '--json', '--all').out).length, 1);

  const ranked = JSON.parse(run('morning', '--json').out);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title, 'Glow');
  ok(run('morning'), 'morning');
  const gallery = path.join(box.env.X100_HOME, 'morning', 'index.html');
  assert.ok(fs.existsSync(gallery));
  assert.match(fs.readFileSync(gallery, 'utf8'), /Glow/);
  box.cleanup();
});

const pathToUrl = (file) => `file://${file}`;

// The agent never hand edits run.json. It sets each fact with 100x run, so the test does the same.
function setRun(run, facts) {
  for (const [key, value] of Object.entries(facts)) {
    if (key === 'review') {
      // review counts come from the triage files, so only the model is set
      const { status, model } = value;
      const result = run('run', 'set', 'review', JSON.stringify({ status, model }));
      assert.equal(result.code, 0, result.err);
    } else if (Array.isArray(value)) {
      for (const item of value) assert.equal(run('run', 'push', key, typeof item === 'string' ? item : JSON.stringify(item)).code, 0, key);
    } else {
      const result = run('run', 'set', key, typeof value === 'string' ? value : JSON.stringify(value));
      assert.equal(result.code, 0, `${key}. ${result.err}`);
    }
  }
}

test('a run goes from init through shots and finish into the morning gallery', { skip }, () => {
  const box = sandbox();
  const run = (...args) => cli(args, { cwd: box.project, env: box.env });
  fs.copyFileSync(path.join(ROOT, 'test', 'fixtures', 'clean.html'), path.join(box.project, 'index.html'));
  run('init', '--no-git');
  run('verify', 'waive', 'index.html', '--why', 'a static test page with nothing to state');
  run('config', 'set', 'polish.passes', '0', '--global');
  fs.writeFileSync(path.join(box.project, '.100x', 'project.md'), PROMPT_MD);
  const shot = run('shots', 'index.html', '--label', 'final', '--viewports', '390x844@3', '--no-checks');
  assert.equal(shot.code, 0, `shots. ${shot.out}${shot.err}`);
  const png = fs.readdirSync(path.join(box.project, '.100x', 'shots', 'final')).find((name) => name.endsWith('.png') && name !== 'contact-sheet.png');
  fs.writeFileSync(path.join(box.project, '.100x', 'run.json'), JSON.stringify(runJson({ ...FLOW, hero: `.100x/shots/final/${png}`, url: pathToUrl(path.join(box.project, 'index.html')), review: { status: 'unreviewed', note: 'review was off for this test' } }), null, 2));
  fs.mkdirSync(path.join(box.project, '.100x', 'must-not-break'), { recursive: true });
  fs.writeFileSync(path.join(box.project, '.100x', 'must-not-break', 'main-flow.txt'), CHECK_OUTPUT);
  const finish = run('finish');
  assert.equal(finish.code, 0, `finish. ${finish.out}${finish.err}`);
  const morning = run('morning');
  assert.equal(morning.code, 0, `morning. ${morning.out}${morning.err}`);
  assert.ok(fs.existsSync(path.join(box.env.X100_HOME, 'morning', 'index.html')), 'the gallery page is written');
  box.cleanup();
});
