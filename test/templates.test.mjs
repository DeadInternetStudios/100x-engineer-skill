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
