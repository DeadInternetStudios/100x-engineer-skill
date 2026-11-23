import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { ROOT, sandbox, write } from './helpers.mjs';

const registryUrl = pathToFileURL(path.join(ROOT, 'lib', 'registry.mjs')).href;

async function withHome(box, fn) {
  const before = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  try {
    return await fn(await import(`${registryUrl}?t=${Math.random()}`));
  } finally {
    if (before === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = before;
  }
}

const entry = (id, extra = {}) => ({ id, title: id, verdict: 'fine', finishedAt: '2026-11-15T00:00:00.000Z', ...extra });

test('many runs finishing at once all land in the registry', async () => {
  const box = sandbox();
  const worker = path.join(box.dir, 'worker.mjs');
  write(worker, `import { upsert } from ${JSON.stringify(registryUrl)};
const [prefix, count] = process.argv.slice(2);
for (let i = 0; i < Number(count); i += 1) upsert({ id: prefix + '-' + i, title: 'x'.repeat(2000), verdict: 'fine', finishedAt: new Date().toISOString() });
`);
  const processes = 8;
  const each = 12;
  await Promise.all(
    Array.from({ length: processes }, (_, p) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker, `p${p}`, String(each)], { env: { ...process.env, X100_HOME: box.env.X100_HOME }, stdio: 'inherit' });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${p} exited ${code}`))));
    })),
  );
  const entries = await withHome(box, (registry) => registry.readRegistry());
  assert.equal(entries.length, processes * each);
  assert.equal(new Set(entries.map((e) => e.id)).size, processes * each);
  box.cleanup();
});

test('the same run finishing twice keeps the latest version once', async () => {
  const box = sandbox();
  await withHome(box, (registry) => {
    registry.upsert(entry('a', { title: 'first' }));
    registry.upsert(entry('b'));
    registry.upsert(entry('a', { title: 'second' }));
    const entries = registry.readRegistry();
    assert.equal(entries.length, 2);
    assert.equal(entries.find((e) => e.id === 'a').title, 'second');
  });
  box.cleanup();
});

test('remove drops a run, reports how many it removed, and a later finish brings it back', async () => {
  const box = sandbox();
  await withHome(box, (registry) => {
    registry.upsert(entry('a'));
    registry.upsert(entry('b'));
    assert.equal(registry.remove('a'), 1);
    assert.equal(registry.remove('a'), 0);
    assert.deepEqual(registry.readRegistry().map((e) => e.id), ['b']);
    registry.upsert(entry('a'));
    assert.deepEqual(registry.readRegistry().map((e) => e.id).sort(), ['a', 'b']);
  });
  box.cleanup();
});

test('a half written line from a crash is skipped and does not swallow the next run', async () => {
  const box = sandbox();
  await withHome(box, (registry) => {
    registry.upsert(entry('a'));
    fs.appendFileSync(registry.registryFile(), '{"id":"torn","title":"cut off here');
    registry.upsert(entry('b'));
    assert.deepEqual(registry.readRegistry().map((e) => e.id).sort(), ['a', 'b']);
  });
  box.cleanup();
});
