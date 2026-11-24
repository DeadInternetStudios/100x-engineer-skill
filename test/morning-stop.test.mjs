import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildStamp } from '../lib/build-stamp.mjs';
import { freePort, listening } from '../lib/morning-server.mjs';
import { cli, sandbox } from './helpers.mjs';

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check, ms = 4000) => {
  for (let waited = 0; waited < ms; waited += 100) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
};

test('--stop never signals a process that only happens to own the pid in server.json', async () => {
  const box = sandbox();
  const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    const dir = path.join(box.env.X100_HOME, 'morning');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify({ pid: bystander.pid, port: 1, url: 'http://127.0.0.1:1/', startedAt: new Date().toISOString() }));
    const result = cli(['morning', '--stop'], { env: box.env });
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /Removed a stale server\.json, and no process was signaled/);
    assert.equal(alive(bystander.pid), true, 'the bystander is still running');
    assert.equal(fs.existsSync(path.join(dir, 'server.json')), false);
  } finally {
    bystander.kill();
    box.cleanup();
  }
});

test('a detached gallery server starts, is found again, and --stop ends it', async () => {
  const box = sandbox();
  const port = await freePort();
  try {
    const started = cli(['morning', '--serve', '--detach', '--port', String(port)], { env: box.env });
    assert.equal(started.code, 0, started.err + started.out);
    assert.match(started.out, /gallery server running/);
    const info = JSON.parse(fs.readFileSync(path.join(box.env.X100_HOME, 'morning', 'server.json'), 'utf8'));
    assert.equal(alive(info.pid), true);
    assert.match(cli(['morning', '--serve', '--detach', '--port', String(port)], { env: box.env }).out, /already running/);
    const stopped = cli(['morning', '--stop'], { env: box.env });
    assert.match(stopped.out, /stopped the gallery server/);
    assert.equal(await until(() => !alive(info.pid)), true, 'the server process is gone');
    assert.match(cli(['morning', '--stop'], { env: box.env }).out, /no gallery server is running/);
  } finally {
    cli(['morning', '--stop'], { env: box.env });
    box.cleanup();
  }
});

test('a gallery server from an older build is restarted by --serve, and doctor fails it until then', async () => {
  const box = sandbox();
  const port = await freePort();
  const file = path.join(box.env.X100_HOME, 'morning', 'server.json');
  try {
    assert.equal(cli(['morning', '--serve', '--detach', '--port', String(port)], { env: box.env }).code, 0);
    const first = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(first.build, buildStamp(), 'a server is stamped with the code it started from');
    assert.match(cli(['doctor'], { env: box.env }).out, /ok\s+gallery server\s+running since .*the build on disk/);

    // A server that started before stamps existed has none.
    delete first.build;
    fs.writeFileSync(file, JSON.stringify(first));
    const doctor = cli(['doctor'], { env: box.env });
    assert.match(doctor.out, /fail\s+gallery server\s+running since .*from an older 100x, so it still shows the old page/);
    assert.match(doctor.out, /fix: Call `100x-report`/);

    const again = cli(['morning', '--serve', '--detach', '--port', String(port)], { env: box.env });
    assert.equal(again.code, 0, again.err + again.out);
    assert.match(again.out, /started by an older 100x, so it was restarted to show the new page/);
    assert.match(again.out, /gallery server running/);
    assert.equal(await until(() => !alive(first.pid)), true, 'the old server is gone');
    const second = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.notEqual(second.pid, first.pid);
    assert.equal(second.build, buildStamp());
    assert.match(cli(['doctor'], { env: box.env }).out, /ok\s+gallery server/);
  } finally {
    cli(['morning', '--stop'], { env: box.env });
    box.cleanup();
  }
});

test('an older gallery server that holds a running prototype is not restarted, and the words say how to go on', async () => {
  const box = sandbox();
  const port = await freePort();
  // A stand-in that answers the status request the way the gallery server does, and whose command line names it as the server.
  const script = `require('http').createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ abc: { running: true, url: 'http://127.0.0.1:1/' } })); }).listen(${port}, '127.0.0.1');`;
  const server = spawn(process.execPath, ['-e', script, '--', '100x', 'morning', '--serve'], { stdio: 'ignore' });
  try {
    let up = false;
    for (let waited = 0; waited < 4000 && !up; waited += 100) {
      up = await listening(port);
      if (!up) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(up, true, 'the stand-in is listening');
    const dir = path.join(box.env.X100_HOME, 'morning');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify({ pid: server.pid, port, url: `http://127.0.0.1:${port}/t/token/`, build: 'an-older-build', startedAt: new Date().toISOString() }));
    const refused = cli(['morning', '--serve'], { env: box.env });
    assert.equal(refused.code, 1);
    assert.match(refused.err, /started by an older 100x, so it still shows the old page, and it has 1 prototype running that a restart would stop/);
    assert.match(refused.err, /`100x morning --stop` and then `100x morning --serve` again/);
    assert.ok(refused.err.includes(`http://127.0.0.1:${port}/t/token/`), 'the old address is given for going on');
    assert.equal(alive(server.pid), true, 'nothing was stopped');
  } finally {
    server.kill();
    box.cleanup();
  }
});
