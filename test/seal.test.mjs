import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { sealFile, sealState } from '../lib/seal.mjs';
import { ROOT, sandbox } from './helpers.mjs';

test('a file is signed by the tool that wrote it, and a change, a typed copy or a missing key all show', () => {
  const box = sandbox();
  const before = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  try {
    const file = path.join(box.dir, 'matrix.json');
    assert.equal(sealState(file), 'missing');
    fs.writeFileSync(file, '{"a":1}\n');
    assert.equal(sealState(file), 'unsigned', 'typed by hand');
    sealFile(file);
    assert.equal(sealState(file), 'ok');
    assert.match(fs.readFileSync(`${file}.seal`, 'utf8'), /^[0-9a-f]{64}\n$/);
    fs.writeFileSync(file, '{"a":2}\n');
    assert.equal(sealState(file), 'unsigned', 'changed after it was signed');
    sealFile(file);
    fs.writeFileSync(`${file}.seal`, `${'0'.repeat(64)}\n`);
    assert.equal(sealState(file), 'unsigned', 'a signature made with another key');
    sealFile(file);
    fs.rmSync(path.join(box.env.X100_HOME, 'audit.key'));
    assert.equal(sealState(file), 'unsigned', 'with no key nothing can be proven');
  } finally {
    if (before === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = before;
    box.cleanup();
  }
});

const inEnv = (home, fn) => {
  const before = process.env.X100_HOME;
  process.env.X100_HOME = home;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = before;
  }
};

test('runs that start together on a fresh machine share one key, so none of their signatures breaks', async () => {
  const box = sandbox();
  const home = path.join(box.dir, 'fresh-home');
  const script = `import { sealFile } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib', 'seal.mjs')).href)}; sealFile(process.argv[1]);`;
  const files = Array.from({ length: 8 }, (_, index) => path.join(box.dir, `file-${index}.json`));
  files.forEach((file, index) => fs.writeFileSync(file, `{"n":${index}}\n`));
  await Promise.all(files.map((file) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, file], { env: { ...process.env, X100_HOME: home }, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`a signing run exited ${code}`))));
  })));
  inEnv(home, () => files.forEach((file) => assert.equal(sealState(file), 'ok', `${file} verifies with the one key`)));
  assert.deepEqual(fs.readdirSync(home).filter((name) => name.startsWith('audit.key')), ['audit.key'], 'no half written copy is left behind');
  box.cleanup();
});

test('a folder that cannot hold the key says so and what to do, instead of a raw error', () => {
  const box = sandbox();
  const blocker = path.join(box.dir, 'a-file');
  fs.writeFileSync(blocker, 'not a folder');
  const file = path.join(box.dir, 'matrix.json');
  fs.writeFileSync(file, '{}\n');
  inEnv(path.join(blocker, 'home'), () => assert.throws(() => sealFile(file), /100x could not save its signing key in .*a-file.*home.*finish refuses a run that is not signed\. Make that folder writable, or set X100_HOME/));
  box.cleanup();
});
