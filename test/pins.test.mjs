import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PINS, pinned, verifyPinned } from '../lib/pins.mjs';

// What `npm install --prefix <dir>` leaves: each package's folder with its package.json, and the hidden record that names its version and integrity hash.
export function fakeInstall(prefix, names, { hash = {}, version = {}, keyPrefix = '', skipRecord = [], skipFolder = [] } = {}) {
  const packages = {};
  for (const name of names) {
    const folder = path.join(prefix, 'node_modules', ...name.split('/'));
    if (!skipFolder.includes(name)) {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, version: version[name] ?? PINS[name].version }));
    }
    if (!skipRecord.includes(name)) packages[`${keyPrefix}node_modules/${name}`] = { version: version[name] ?? PINS[name].version, integrity: hash[name] ?? PINS[name].integrity };
  }
  fs.mkdirSync(path.join(prefix, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(prefix, 'node_modules', '.package-lock.json'), JSON.stringify({ name: 'x', lockfileVersion: 3, packages }));
}

const NAMES = Object.keys(PINS);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'x100-pins-'));

test('every pin is an exact version and a SHA-512 integrity hash, and Playwright and its core are the same version', () => {
  for (const [name, pin] of Object.entries(PINS)) {
    assert.match(pin.version, /^\d+\.\d+\.\d+$/, `${name} is an exact version`);
    assert.match(pin.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, `${name} has a SHA-512 hash`);
    assert.equal(pinned(name), `${name}@${pin.version}`);
  }
  assert.equal(PINS.playwright.version, PINS['playwright-core'].version);
});

test('an install that wrote the pinned version and hash is accepted, and left in place', () => {
  const dir = tmp();
  fakeInstall(dir, NAMES);
  verifyPinned(dir, NAMES);
  for (const name of NAMES) assert.ok(fs.existsSync(path.join(dir, 'node_modules', ...name.split('/'), 'package.json')), `${name} stays`);
  fs.rmSync(dir, { recursive: true });
});

test('a package with another hash is refused, named, and removed together with the others from the same install, and one from another install stays', () => {
  const dir = tmp();
  fakeInstall(dir, NAMES, { hash: { playwright: `sha512-${'A'.repeat(86)}==` } });
  assert.throws(() => verifyPinned(dir, ['playwright', 'playwright-core']), (error) => /^playwright does not match what 100x pins/.test(error.message) && /nothing was run/.test(error.message));
  assert.ok(!fs.existsSync(path.join(dir, 'node_modules', 'playwright')));
  assert.ok(!fs.existsSync(path.join(dir, 'node_modules', 'playwright-core')));
  assert.ok(fs.existsSync(path.join(dir, 'node_modules', '@cursor', 'sdk')), 'the SDK was not part of this install');
  fs.rmSync(dir, { recursive: true });
});

test('another version, a folder that says another version, a missing record and a missing folder are each refused', () => {
  const cases = {
    'record names another version': { version: { '@cursor/sdk': '9.9.9' } },
    'no record of the package': { skipRecord: ['@cursor/sdk'] },
    'no folder for the package': { skipFolder: ['@cursor/sdk'] },
  };
  for (const [label, options] of Object.entries(cases)) {
    const dir = tmp();
    fakeInstall(dir, ['@cursor/sdk'], options);
    assert.throws(() => verifyPinned(dir, ['@cursor/sdk']), /does not match what 100x pins/, label);
    fs.rmSync(dir, { recursive: true });
  }
  const dir = tmp();
  fakeInstall(dir, ['@cursor/sdk']);
  fs.writeFileSync(path.join(dir, 'node_modules', '@cursor', 'sdk', 'package.json'), JSON.stringify({ name: '@cursor/sdk', version: '9.9.9' }));
  assert.throws(() => verifyPinned(dir, ['@cursor/sdk']), /the folder says 9\.9\.9/, 'the folder disagrees with the record');
  fs.rmSync(dir, { recursive: true });
  const none = tmp();
  assert.throws(() => verifyPinned(none, ['@cursor/sdk']), /no record of it/, 'no npm record at all fails and does not pass on silence');
  fs.rmSync(none, { recursive: true });
});

test('npm writes a longer key when the home folder is behind a symbolic link, and a wrong hash under that key is still refused', () => {
  const key = '../../../private/var/x/';
  const ok = tmp();
  fakeInstall(ok, ['playwright'], { keyPrefix: key });
  verifyPinned(ok, ['playwright']);
  fs.rmSync(ok, { recursive: true });
  const bad = tmp();
  fakeInstall(bad, ['playwright'], { keyPrefix: key, hash: { playwright: `sha512-${'B'.repeat(86)}==` } });
  assert.throws(() => verifyPinned(bad, ['playwright']), /does not match what 100x pins/);
  fs.rmSync(bad, { recursive: true });
});
