import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { browserSkip as skip, cli, ROOT, sandbox, write } from './helpers.mjs';

const TEMPLATES = path.join(ROOT, 'skills', '100x', 'assets');
const cleanEnv = (env = {}) => {
  const copy = { ...process.env, ...env };
  delete copy.NODE_TEST_CONTEXT;
  return copy;
};
const node = (args, env = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', env: cleanEnv(env) });

test('the money template runs green as written and goes red when a rounding bug is injected', () => {
  const box = sandbox();
  const source = fs.readFileSync(path.join(TEMPLATES, 'money-checks.test.mjs'), 'utf8');
  const good = path.join(box.dir, 'good.test.mjs');
  fs.writeFileSync(good, source);
  const green = node(['--test', good]);
  assert.equal(green.status, 0, green.stdout);

  const mutated = source.replace('Math.floor(totalCents / parts)', 'Math.round(totalCents / parts)');
  assert.notEqual(mutated, source, 'the mutation target exists in the template');
  const bad = path.join(box.dir, 'bad.test.mjs');
  fs.writeFileSync(bad, mutated);
  const red = node(['--test', bad]);
  assert.notEqual(red.status, 0, 'a split that loses cents must fail');
  assert.match(red.stdout, /failing input \(run \d+, seed 20260101\)/);
  box.cleanup();
});

test('the economy simulator passes a sane economy and fails a dead start and a stalling one', () => {
  const sim = path.join(TEMPLATES, 'economy-simulator.mjs');
  const ok = node([sim]);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /pass {2}early-pace/);
  const json = JSON.parse(node([sim, '--json']).stdout);
  assert.deepEqual(json.checks.map((c) => c.name), ['finite', 'first-buy', 'early-pace', 'gaps', 'offline']);

  const dead = node([sim], { TAPS: '0', HOURS: '2' });
  assert.equal(dead.status, 1);
  assert.match(dead.stdout, /FAIL {2}first-buy\. no purchase ever happened/);

  const stall = node([sim], { GROWTH: '2' });
  assert.equal(stall.status, 1);
  assert.match(stall.stdout, /FAIL {2}gaps\./);
});

test('the economy simulator plays a reset loop on request and fails when the runs collapse into a chore', () => {
  const sim = path.join(TEMPLATES, 'economy-simulator.mjs');
  const ok = JSON.parse(node([sim, '--json'], { PRESTIGE: '1' }).stdout);
  assert.deepEqual(ok.checks.map((c) => c.name), ['finite', 'first-buy', 'early-pace', 'gaps', 'offline', 'runs']);
  assert.ok(ok.checks.every((c) => c.ok), JSON.stringify(ok.checks));
  const collapsed = node([sim], { PRESTIGE: '1', PRESTIGE_STEP: '1e3' });
  assert.equal(collapsed.status, 1);
  assert.match(collapsed.stdout, /FAIL {2}runs\. \d+ resets in 48 h, shortest run 0\.\d min/);
});

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) }));
  });
}

const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();
const runFresh = (...args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(TEMPLATES, 'fresh-data-check.mjs'), ...args], { env: cleanEnv() });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.on('close', (status) => resolve({ status, stdout }));
});

test('the fresh-data check passes recent data and names the failure for stale, empty, broken and unreachable sources', async () => {
  const routes = {
    '/fresh': () => [200, { updated_at: hoursAgo(1), items: [1, 2] }],
    '/stale': () => [200, { updated_at: hoursAgo(72), items: [1] }],
    '/empty': () => [200, { updated_at: hoursAgo(1), items: [] }],
    '/error': () => [500, { error: 'boom' }],
  };
  const server = await serve((req, res) => {
    if (req.url === '/html') return res.end('<html>nope</html>');
    const [status, body] = routes[req.url]?.() ?? [404, {}];
    res.writeHead(status, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(body));
  });
  try {
    const fresh = await runFresh(`${server.url}/fresh`, '--array', 'items');
    assert.equal(fresh.status, 0, fresh.stdout);
    assert.match(fresh.stdout, /pass {2}fresh\. updated_at is 1\.0 h old/);
    const stale = await runFresh(`${server.url}/stale`);
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /FAIL {2}fresh\. updated_at is 72\.0 h old, limit 24/);
    assert.match((await runFresh(`${server.url}/empty`, '--array', 'items')).stdout, /FAIL {2}not-empty\. 0 items in items/);
    assert.match((await runFresh(`${server.url}/error`)).stdout, /FAIL {2}request\. HTTP 500/);
    assert.match((await runFresh(`${server.url}/html`)).stdout, /FAIL {2}json\. not JSON/);
    const loose = await runFresh(`${server.url}/stale`, '--max-age-hours', '100');
    assert.equal(loose.status, 0);
  } finally {
    await server.close();
  }
  const gone = await runFresh('http://127.0.0.1:9/nothing');
  assert.equal(gone.status, 1);
  assert.match(gone.stdout, /FAIL {2}request\./);
  assert.equal((await runFresh()).status, 2);
});

test('the late game seed script reaches the page before it loads, which a missing seed would show as a console error', { skip }, () => {
  const box = sandbox();
  const page = path.join(box.dir, 'seeded.html');
  write(page, `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Seeded</title>
<h1 id="out">loading</h1>
<script>
const raw = localStorage.getItem('save');
if (!raw) console.error('seed missing');
document.getElementById('out').textContent = raw ? 'coins ' + JSON.parse(raw).coins : 'no save';
</script>`);
  const seed = path.join(box.dir, 'seed.js');
  fs.writeFileSync(seed, fs.readFileSync(path.join(TEMPLATES, 'seed-localstorage.js'), 'utf8').replace('REPLACE_WITH_THE_REAL_SAVE_KEY', 'save'));
  const withSeed = cli(['shots', page, '--matrix', 'phone', '--init-script', seed, '--fail-on-broken'], { cwd: box.project, env: box.env });
  assert.equal(withSeed.code, 0, withSeed.out + withSeed.err);
  const without = cli(['shots', page, '--matrix', 'phone', '--fail-on-broken'], { cwd: box.project, env: box.env });
  assert.equal(without.code, 1);
  assert.match(without.out, /seed missing/);
  box.cleanup();
});

test('the asset check passes a clean folder and names empty, corrupt, oversized, duplicate and mismatched frames', async () => {
  const { encodePng } = await import('./png.mjs');
  const box = sandbox();
  const art = path.join(box.dir, 'art');
  const png = (w, h, shade) => encodePng(w, h, (x, y) => [shade, (x * 7) % 256, (y * 5) % 256, 255]);
  fs.mkdirSync(art);
  fs.writeFileSync(path.join(art, 'run_01.png'), png(32, 32, 10));
  fs.writeFileSync(path.join(art, 'run_02.png'), png(32, 32, 90));
  fs.writeFileSync(path.join(art, 'hit.wav'), Buffer.concat([Buffer.from('RIFF....WAVE', 'latin1'), Buffer.alloc(64)]));
  const run = (...args) => node([path.join(TEMPLATES, 'asset-check.mjs'), art, ...args]);

  const green = run();
  assert.equal(green.status, 0, green.stdout);
  assert.match(green.stdout, /pass {2}found\. 3 asset files/);
  assert.match(green.stdout, /pass {2}sets\. 1 numbered sets/);

  fs.writeFileSync(path.join(art, 'empty.png'), '');
  fs.writeFileSync(path.join(art, 'run_03.png'), png(48, 32, 200));
  fs.copyFileSync(path.join(art, 'run_01.png'), path.join(art, 'copy.png'));
  fs.writeFileSync(path.join(art, 'junk.ogg'), 'not audio');
  const red = run('--max-kb', '0');
  assert.equal(red.status, 1);
  assert.match(red.stdout, /FAIL {2}opens\. 2 of 7\. empty\.png is empty; junk\.ogg has no valid header/);
  assert.match(red.stdout, /FAIL {2}file-budget\./);
  assert.match(red.stdout, /FAIL {2}duplicates\. 1 of 7\. run_01\.png is the same file as copy\.png/);
  assert.match(red.stdout, /FAIL {2}sets\. 1 of 7\. run_\*\.png has sizes 32x32, 48x32/);

  assert.equal(node([path.join(TEMPLATES, 'asset-check.mjs'), path.join(box.dir, 'missing')]).status, 1);
  assert.equal(node([path.join(TEMPLATES, 'asset-check.mjs')]).status, 2);
  box.cleanup();
});

// ---- property checker ----
const CHECKER = path.join(TEMPLATES, 'property-checker.mjs');
const mutate = (box, from, to, name = 'mutant.mjs') => {
  const source = fs.readFileSync(CHECKER, 'utf8');
  assert.ok(source.includes(from), 'the mutation target exists in the template: ' + from);
  const file = path.join(box.dir, name);
  fs.writeFileSync(file, source.replace(from, () => to));
  return file;
};
const failing = (result) => result.stdout.split('\n').filter((line) => line.startsWith('FAIL')).map((line) => line.split('.')[0].replace(/^FAIL {2}/, ''));

test('the property checker proves the example workflow exhaustively, and says what it proved', () => {
  const ok = node([CHECKER]);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /Exhaustive\. Every reachable state was visited/);
  const json = JSON.parse(node([CHECKER, '--json']).stdout);
  assert.equal(json.exhaustive, true);
  assert.deepEqual(json.checks.map((c) => c.name), ['inv:money-in-bounds', 'inv:shipped-means-paid', 'inv:refund-only-after-cancel', 'guard:pay', 'post:pay', 'guard:ship', 'post:ship', 'guard:deliver', 'post:deliver', 'guard:cancel', 'post:cancel', 'guard:refund', 'post:refund', 'pure', 'deadlock', 'coverage', 'live:every-started-order-settles', 'live:a-cancelled-order-is-refunded']);
  assert.ok(json.checks.every((c) => c.ok && c.level === 'exhaustive'));
  assert.ok(json.assumptions.length >= 3);
});

test('the property checker goes red on a missing guard, naming the property and the steps', () => {
  const box = sandbox();
  const red = node([mutate(box, "  if (state.paid + amount > state.total) throw new Error('the payment is more than what is owed');\n", '')]);
  assert.equal(red.status, 1);
  const names = failing(red);
  assert.ok(names.includes('guard:pay'), red.stdout);
  assert.ok(names.includes('inv:money-in-bounds'), red.stdout);
  assert.match(red.stdout, /FAIL {2}guard:pay\. the model forbids pay\(\d\) but the implementation accepted it/);
  assert.match(red.stdout, /Steps: .*pay\(\d\)/);
  box.cleanup();
});

test('the property checker catches a postcondition that does not hold and a step that changes its input', () => {
  const box = sandbox();
  const post = node([mutate(box, 'return { ...state, refunded: state.paid };', 'return { ...state, refunded: state.paid + 1 };')]);
  assert.ok(failing(post).includes('post:refund'), post.stdout);
  const impure = node([mutate(box, "  return { ...state, status: 'shipped' };", "  state.status = 'shipped';\n  return state;", 'impure.mjs')]);
  assert.ok(failing(impure).includes('pure'), impure.stdout);
  box.cleanup();
});

test('the property checker finds a deadlock and a state the run can never leave', () => {
  const box = sandbox();
  const deadlock = node([mutate(box, "const settled = (s) => s.status === 'delivered' ||", "const settled = (s) => false ||")]);
  assert.ok(failing(deadlock).includes('deadlock'), deadlock.stdout);
  assert.match(deadlock.stdout, /FAIL {2}deadlock\. no step is possible and the model does not call this a stopping point/);
  const stuck = node([mutate(box, "return { ...state, status: 'delivered' };", "return { ...state, status: 'shipped' };", 'stuck.mjs')]);
  const names = failing(stuck);
  assert.ok(names.includes('live:every-started-order-settles'), stuck.stdout);
  assert.match(stuck.stdout, /can stay away from to forever\. It gets stuck at/);
  box.cleanup();
});

test('the property checker decides liveness under fairness, and a loop that could be left only fails without it', () => {
  const box = sandbox();
  // A retry step that goes back to open. With strong fairness the way out is eventually taken, so settling still holds.
  const retry = "      name: 'retry',\n      pre: (s) => s.status === 'paid',\n      apply: (s) => { if (s.status !== 'paid') throw new Error('only a paid order is retried'); return { ...s, status: 'open', paid: 1 }; },\n      post: () => true,\n    },\n    {\n      name: 'ship',";
  const withRetry = mutate(box, "      name: 'ship',", retry, 'retry.mjs');
  const strong = node([withRetry]);
  assert.equal(strong.status, 0, strong.stdout);
  const source = fs.readFileSync(withRetry, 'utf8').replace("{ name: 'every-started-order-settles', from:", "{ name: 'every-started-order-settles', fairness: 'none', from:");
  const noFairness = path.join(box.dir, 'nofair.mjs');
  fs.writeFileSync(noFairness, source);
  const weak = node([noFairness]);
  assert.ok(failing(weak).includes('live:every-started-order-settles'), weak.stdout);
  box.cleanup();
});

test('the property checker never calls a bounded search a proof, and never decides liveness on one', () => {
  const bounded = node([CHECKER], { MAX_STATES: '6' });
  assert.equal(bounded.status, 1);
  assert.match(bounded.stdout, /BOUNDED\. The exploration stopped/);
  assert.match(bounded.stdout, /FAIL {2}live:every-started-order-settles\. not decided/);
  assert.match(bounded.stdout, /pass {2}inv:money-in-bounds\. \d+ states checked, bounded/);
  const box = sandbox();
  const vacuous = node([mutate(box, "from: (s) => s.paid > 0 || s.status !== 'open'", 'from: (s) => s.paid > 99')]);
  assert.match(vacuous.stdout, /FAIL {2}live:every-started-order-settles\. vacuous/);
  const unused = node([mutate(box, "pre: (s) => s.status === 'shipped',\n      apply: deliver,", "pre: (s) => false,\n      apply: deliver,", 'unused.mjs')]);
  assert.match(unused.stdout, /FAIL {2}coverage\. these steps were never possible in any reachable state: deliver/);
  box.cleanup();
});
