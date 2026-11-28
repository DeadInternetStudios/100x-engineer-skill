import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { INSTALLS, PINS, pinned, verifyPinned } from '../lib/pins.mjs';

// What `npm install --prefix <dir>` leaves: each package's folder with its package.json, and the hidden record that names its version and integrity hash.
export function fakeInstall(prefix, names, { hash = {}, version = {}, keyPrefix = '', skipRecord = [], skipFolder = [], saved = false, deps = {} } = {}) {
  const packages = {};
  for (const name of names) {
    const folder = path.join(prefix, 'node_modules', ...name.split('/'));
    if (!skipFolder.includes(name)) {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, version: version[name] ?? PINS[name].version, ...deps[name] }));
    }
    if (!skipRecord.includes(name)) packages[`${keyPrefix}node_modules/${name}`] = { version: version[name] ?? PINS[name].version, integrity: hash[name] ?? PINS[name].integrity };
  }
  fs.mkdirSync(path.join(prefix, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(prefix, 'node_modules', '.package-lock.json'), JSON.stringify({ name: 'x', lockfileVersion: 3, packages }));
  if (!saved) return;
  // With `--save-exact`, npm also writes the packages into the prefix's own package.json and package-lock.json, and later installs rebuild from those.
  const dependencies = Object.fromEntries(names.map((name) => [name, PINS[name].version]));
  fs.writeFileSync(path.join(prefix, 'package.json'), JSON.stringify({ name: 'x', private: true, dependencies }));
  fs.writeFileSync(path.join(prefix, 'package-lock.json'), JSON.stringify({ name: 'x', lockfileVersion: 3, packages: { '': { name: 'x', dependencies }, ...packages } }));
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

// npm rebuilds node_modules from the prefix's own package.json and lockfiles, so a rejected package that stays in them is reinstalled by the next `npm install --prefix`
// there, and loaded without a check. The names have to leave those files too, and the packages that were not rejected have to stay in them.
test('a rejected package is forgotten by the prefix manifest and both lockfiles, so npm cannot reinstall it, and the other packages stay', () => {
  const dir = tmp();
  fakeInstall(dir, ['@cursor/sdk', 'playwright', 'playwright-core'], { saved: true, hash: { playwright: `sha512-${'A'.repeat(86)}==` } });
  assert.throws(() => verifyPinned(dir, ['playwright', 'playwright-core']), (error) => /^playwright does not match/.test(error.message));
  const read = (...parts) => JSON.parse(fs.readFileSync(path.join(dir, ...parts), 'utf8'));
  assert.deepEqual(Object.keys(read('package.json').dependencies), ['@cursor/sdk'], 'the manifest keeps only the SDK');
  for (const lock of [read('package-lock.json'), read('node_modules', '.package-lock.json')]) {
    assert.deepEqual(Object.keys(lock.packages).filter(Boolean), ['node_modules/@cursor/sdk'], 'a lockfile keeps only the SDK');
    assert.deepEqual(Object.keys(lock.packages['']?.dependencies ?? { '@cursor/sdk': 1 }), ['@cursor/sdk'], 'and the root entry lists only the SDK');
  }
  assert.ok(fs.existsSync(path.join(dir, 'node_modules', '@cursor', 'sdk', 'package.json')), 'the SDK folder stays');
  fs.rmSync(dir, { recursive: true });
});

test('a lockfile that cannot be read is deleted when a package is rejected, and one that lists the package under a longer key is cleaned too', () => {
  const dir = tmp();
  fakeInstall(dir, ['playwright', 'playwright-core'], { saved: true, keyPrefix: '../../../private/var/x/', hash: { 'playwright-core': `sha512-${'C'.repeat(86)}==` } });
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{ not json');
  assert.throws(() => verifyPinned(dir, ['playwright', 'playwright-core']), (error) => /^playwright-core does not match/.test(error.message));
  assert.ok(!fs.existsSync(path.join(dir, 'package-lock.json')), 'the broken lockfile is gone, and npm writes a new one from the manifest');
  const hidden = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', '.package-lock.json'), 'utf8'));
  assert.deepEqual(Object.keys(hidden.packages), [], 'the longer keys are removed too');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies, {});
  fs.rmSync(dir, { recursive: true });
});

// The SDK publishes ranges for some dependencies, ships its executables in five platform packages, and asks for a zod peer. All of it runs on the owner's machine, so
// the check covers the whole tree under the package it was asked for, not only that package.
const sdkTree = {
  '@cursor/sdk': {
    dependencies: { '@bufbuild/protobuf': '1.10.0', '@statsig/js-client': '3.31.0' },
    optionalDependencies: Object.fromEntries(Object.keys(PINS).filter((n) => n.startsWith('@cursor/sdk-')).map((n) => [n, '1.4.2'])),
    peerDependencies: { zod: '^3.25.0 || ^4.0.0' },
  },
  '@statsig/js-client': { dependencies: { '@statsig/client-core': '3.31.0' } },
};
const SDK_NAMES = ['@cursor/sdk', '@bufbuild/protobuf', '@statsig/js-client', '@statsig/client-core', 'zod', '@cursor/sdk-darwin-arm64'];

test('the whole tree under the SDK is checked: its dependencies, its peer and the one platform package that npm installed for this machine', () => {
  const dir = tmp();
  fakeInstall(dir, SDK_NAMES, { deps: sdkTree });
  assert.deepEqual(verifyPinned(dir, ['@cursor/sdk']).sort(), [...SDK_NAMES].sort(), 'the four platform packages that were not installed are not a gap');
  fs.rmSync(dir, { recursive: true });
});

test('a bad hash anywhere in the SDK tree refuses the SDK, and the whole tree is forgotten together', () => {
  for (const bad of ['@statsig/client-core', 'zod', '@cursor/sdk-darwin-arm64', '@bufbuild/protobuf']) {
    const dir = tmp();
    fakeInstall(dir, [...SDK_NAMES, 'playwright'], { deps: sdkTree, saved: true, hash: { [bad]: `sha512-${'E'.repeat(86)}==` } });
    assert.throws(() => verifyPinned(dir, ['@cursor/sdk']), (error) => error.message.startsWith(`${bad} does not match what 100x pins`), bad);
    for (const name of SDK_NAMES) assert.ok(!fs.existsSync(path.join(dir, 'node_modules', ...name.split('/'))), `${name} is gone after ${bad} failed`);
    assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'playwright')), 'a package outside the tree stays');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies;
    assert.deepEqual(Object.keys(manifest), ['playwright'], `the manifest keeps only what was not refused (${bad})`);
    fs.rmSync(dir, { recursive: true });
  }
});

test('a package the SDK needs that 100x does not pin, and a required one that is missing, are both refused', () => {
  const stranger = tmp();
  fakeInstall(stranger, ['@cursor/sdk', 'zod'], { deps: { '@cursor/sdk': { dependencies: { 'left-pad': '1.3.0' } } } });
  fs.mkdirSync(path.join(stranger, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(stranger, 'node_modules', 'left-pad', 'package.json'), JSON.stringify({ name: 'left-pad', version: '1.3.0' }));
  assert.throws(() => verifyPinned(stranger, ['@cursor/sdk']), (error) => /^left-pad is not a package 100x pins/.test(error.message));
  assert.ok(!fs.existsSync(path.join(stranger, 'node_modules', '@cursor', 'sdk')), 'and the SDK that wanted it is gone');
  fs.rmSync(stranger, { recursive: true });
  const missing = tmp();
  fakeInstall(missing, ['@cursor/sdk'], { deps: { '@cursor/sdk': { dependencies: { zod: '^4' } } } });
  assert.throws(() => verifyPinned(missing, ['@cursor/sdk']), (error) => /^zod does not match what 100x pins.*no record of it/.test(error.message));
  fs.rmSync(missing, { recursive: true });
});

test('the install lists and the pin table agree: nothing is pinned that no install can reach, and every asked-for package is pinned', () => {
  const platform = Object.keys(PINS).filter((name) => name.startsWith('@cursor/sdk-'));
  assert.equal(platform.length, 5, 'five platform packages');
  assert.deepEqual([...INSTALLS.playwright, ...INSTALLS.sdk, ...platform].sort(), Object.keys(PINS).sort());
  for (const name of [...INSTALLS.playwright, ...INSTALLS.sdk]) assert.ok(PINS[name], `${name} is pinned`);
  for (const name of platform) assert.ok(!INSTALLS.sdk.includes(name), `${name} is not asked for by name, because it fails on a machine it does not fit`);
  assert.deepEqual(new Set(platform.map((name) => PINS[name].version)), new Set([PINS['@cursor/sdk'].version]), 'the platform packages are the SDK version');
});
