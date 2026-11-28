import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.mjs';

// Everything 100x downloads and runs on a machine other than its own code: an exact version, and the SHA-512 integrity hash of that version's tarball as npm
// publishes it. The hashes were checked against the downloaded tarballs, not only against the registry's own record. A new version is a change to this file.
// Playwright pins playwright-core to its own version, and playwright-core names the Chromium build, so the browser follows the pin. Neither package has an install
// script. @cursor/sdk has none either, and its own dependencies are the ranges it publishes, checked by npm against the registry.
export const PINS = Object.freeze({
  '@cursor/sdk': { version: '1.4.2', integrity: 'sha512-IMeIZtLvVX5w6rOS34bfBQt2b/WsMm+6lLU6vdlia0E6RuuXup+aVXyJrzvVAfnI7pK8bPPc7Gx1dvxy7ci+1Q==' },
  playwright: { version: '1.65.1', integrity: 'sha512-vJ1FuoOrNwOKHUIVEvSt3jT1L+wjjDpwhwIstKtfvTh8XIG4FG4bIFuvNdMxi81LGfAhUgUZleVFaOLY4RIUUw==' },
  'playwright-core': { version: '1.65.1', integrity: 'sha512-hqPpz7blSMPxWVdoeE1yiBSzXsKiVOd2k+kjCvmUywD2GPO2Dd9HfcWnq9NN0GHbNZDFgZ9JfBFr+X5/BLo0qw==' },
});

// The argument for `npm install`: the package at its pinned version.
export const pinned = (name) => `${name}@${PINS[name].version}`;

const folderOf = (prefix, name) => path.join(prefix, 'node_modules', ...name.split('/'));

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const isPackageKey = (key, name) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`);

// npm rebuilds node_modules from the prefix's package.json and the two lockfiles. A rejected package left in any of them comes back, from the saved lockfile
// entry, the next time something runs `npm install --prefix` in the same prefix. So the names go from the folder, the manifest and the lockfiles together.
// A lockfile that cannot be read is deleted: npm writes it again from package.json.
function forget(prefix, names) {
  for (const gone of names) fs.rmSync(folderOf(prefix, gone), { recursive: true, force: true });
  const manifest = path.join(prefix, 'package.json');
  const saved = readJson(manifest);
  if (saved) {
    for (const section of DEPENDENCY_SECTIONS) for (const gone of names) delete saved[section]?.[gone];
    fs.writeFileSync(manifest, `${JSON.stringify(saved, null, 2)}\n`);
  }
  for (const file of [path.join(prefix, 'package-lock.json'), path.join(prefix, 'node_modules', '.package-lock.json')]) {
    const lock = readJson(file);
    if (!lock) {
      fs.rmSync(file, { force: true });
      continue;
    }
    for (const key of Object.keys(lock.packages ?? {})) if (names.some((gone) => isPackageKey(key, gone))) delete lock.packages[key];
    for (const section of DEPENDENCY_SECTIONS) for (const gone of names) delete lock.packages?.['']?.[section]?.[gone];
    for (const gone of names) delete lock.dependencies?.[gone];
    fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`);
  }
}

// After `npm install --prefix <prefix> --ignore-scripts`, npm's own record of what it put in node_modules names each package's version and integrity hash. Every name
// given must be there with the pinned version and hash, in every record npm kept for it (a home folder behind a symbolic link makes npm write the same package under a
// longer key), and the folder on disk must say the pinned version. The install runs no package script, so nothing from a package that does not match has run yet.
// When one does not match, every name given is forgotten, so the package is never loaded or reinstalled, and the error says which one. A missing record fails too:
// the check does not pass on silence.
export function verifyPinned(prefix, names) {
  const packages = readJson(path.join(prefix, 'node_modules', '.package-lock.json'))?.packages ?? {};
  for (const name of names) {
    const pin = PINS[name];
    const records = Object.entries(packages).filter(([key]) => isPackageKey(key, name)).map(([, record]) => record);
    const onDisk = readJson(path.join(folderOf(prefix, name), 'package.json'));
    if (records.length && records.every((r) => r.version === pin.version && r.integrity === pin.integrity) && onDisk?.version === pin.version) continue;
    forget(prefix, names);
    const saw = records.length ? records.map((r) => `version ${r.version} with hash ${r.integrity ?? 'none'}`).join(' and ') : 'no record of it';
    throw new CliError(`${name} does not match what 100x pins (${pin.version}, ${pin.integrity}). npm wrote ${saw}${onDisk?.version === pin.version ? '' : `, and the folder says ${onDisk?.version ?? 'nothing'}`}. It was removed, and nothing was run.`);
  }
}
