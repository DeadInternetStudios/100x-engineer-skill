import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.mjs';

// Everything 100x downloads and runs on a machine other than its own code: an exact version, and the SHA-512 integrity hash of that version's tarball as npm
// publishes it. The hashes were checked against the downloaded tarballs, not only against the registry's own record. A new version is a change to this file.
// Playwright pins playwright-core to its own version, and playwright-core names the Chromium build, so the browser follows the pin.
// Both trees are here in full: Playwright with playwright-core, and the SDK with its dependencies, its zod peer and its five platform packages. Each platform package
// carries an `rg` executable, and npm installs the one that fits the machine. No package in either tree has an install script, and 100x installs with scripts off.
// To change a pin, install the roots into an empty folder with `npm install --ignore-scripts --save-exact`, copy the version and integrity of every package in the
// package-lock.json it writes, and download each tarball to hash it yourself.
export const PINS = Object.freeze({
  '@bufbuild/protobuf': { version: '1.10.0', integrity: 'sha512-QDdVFLoN93Zjg36NoQPZfsVH9tZew7wKDKyV5qRdj8ntT4wQCOradQjRaTdwMhWUYsgKsvCINKKm87FdEk96Ag==' },
  '@connectrpc/connect': { version: '1.7.0', integrity: 'sha512-iNKdJRi69YP3mq6AePRT8F/HrxWCewrhxnLMNm0vpqXAR8biwzRtO6Hjx80C6UvtKJ5sFmffQT7I4Baecz389w==' },
  '@connectrpc/connect-web': { version: '1.7.0', integrity: 'sha512-qyP0YOnUPRWwCc/VfsoydMJvkb7EyUPr2q9sHgBuJzbADjiqck1gKH5V5ZPzPhTLBvmz5UvG+wiZ5sMRQHU1MQ==' },
  '@cursor/sdk': { version: '1.4.2', integrity: 'sha512-IMeIZtLvVX5w6rOS34bfBQt2b/WsMm+6lLU6vdlia0E6RuuXup+aVXyJrzvVAfnI7pK8bPPc7Gx1dvxy7ci+1Q==' },
  '@cursor/sdk-darwin-arm64': { version: '1.4.2', integrity: 'sha512-avM3SHrUOesNn6+8BCqcK1RbqmynWpjQt2mAajzBhjDK6k8HD6akpKjiZ1ufrL/dD09g9NVVtUSmYJmOYP5pXQ==' },
  '@cursor/sdk-darwin-x64': { version: '1.4.2', integrity: 'sha512-o2H4MtiLLRxSRuxJJoDzosRYE6gvMyEyrGfg8xN+0DQ3x1rgcZ+8q7wX/+ZRE6UYyW/eh6ryNTaY+sVFcQkY0A==' },
  '@cursor/sdk-linux-arm64': { version: '1.4.2', integrity: 'sha512-NQxAPiaUabDuM0UwgiFHYX2L8MW8bnX07eEMHpCbJrdBsWBHClTUhMfK0p+BXwzxZjDuA92MzN0bxvjToGPH7Q==' },
  '@cursor/sdk-linux-x64': { version: '1.4.2', integrity: 'sha512-9R9iG0sndf63Z9YlLWm1c7ve6McriP2OW71O2wkWleWn1BfYCxAXMY5Qi+OWLBLVNtwmClGUzaOiY873SxG41A==' },
  '@cursor/sdk-win32-x64': { version: '1.4.2', integrity: 'sha512-JBLJWDAAJOJFJrYZlYWnWWoyS7Eh9AZWXSOm/A7LX5wrGgeRJipIT2Y7yHbYJ2HgZQEletaywEkPpxPRJPdW5w==' },
  '@statsig/client-core': { version: '3.31.0', integrity: 'sha512-SuxQD6TmVszPG7FoMKwTk/uyBuVFk7XnxI3T/E0uyb7PL7GNjONtfsoh+NqBBVUJVse0CUeSFfgJPoZy1ZOslQ==' },
  '@statsig/js-client': { version: '3.31.0', integrity: 'sha512-LFa5E0LjT6sTfZv3sNGoyRLSZ1078+agdgOA+Vm1ecjG+KbSOfBLTW7hMwimrJ29slRwbYDzbtKaPJo/R37N2g==' },
  playwright: { version: '1.65.1', integrity: 'sha512-vJ1FuoOrNwOKHUIVEvSt3jT1L+wjjDpwhwIstKtfvTh8XIG4FG4bIFuvNdMxi81LGfAhUgUZleVFaOLY4RIUUw==' },
  'playwright-core': { version: '1.65.1', integrity: 'sha512-hqPpz7blSMPxWVdoeE1yiBSzXsKiVOd2k+kjCvmUywD2GPO2Dd9HfcWnq9NN0GHbNZDFgZ9JfBFr+X5/BLo0qw==' },
  zod: { version: '4.6.7', integrity: 'sha512-g8W2D2kU6a8untc053fX1uVBKzM7yqAxW/3zwk83+6RyF2+SKOuV+c0wBDhUwzV1PaGapmZH+rmcUzPf+3CGwg==' },
});

// The argument for `npm install`: the package at its pinned version.
export const pinned = (name) => `${name}@${PINS[name].version}`;

// What `npm install` is asked for, by name and at its pinned version. The SDK publishes ranges for some of its dependencies (`^1.6.1`, and `^3.25.0 || ^4.0.0` for
// its zod peer), so asking for the SDK alone would let npm pick a newer release than the one pinned here. The platform packages are left out on purpose: asked for by
// name they fail on every machine they do not fit, and npm installs the one that fits from the exact version the SDK lists. verifyPinned checks that one too.
export const INSTALLS = Object.freeze({
  playwright: ['playwright', 'playwright-core'],
  sdk: ['@cursor/sdk', '@bufbuild/protobuf', '@connectrpc/connect', '@connectrpc/connect-web', '@statsig/client-core', '@statsig/js-client', 'zod'],
});

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

// The names a package asks npm for. A dependency that is optional, or a peer, and is not installed is not a gap: npm leaves out the platform packages that do not
// fit the machine. One that is installed is checked like the rest, and a required one that is missing is a failure.
const asked = (manifest) => ({
  required: Object.keys(manifest?.dependencies ?? {}),
  optional: [...Object.keys(manifest?.optionalDependencies ?? {}), ...Object.keys(manifest?.peerDependencies ?? {})],
});

// After `npm install --prefix <prefix> --ignore-scripts`, npm's own record of what it put in node_modules names each package's version and integrity hash. The
// names given and everything installed beneath them (their dependencies, their optional dependencies and their peers) must each be a package 100x pins, with the
// pinned version and hash, in every record npm kept for it (a home folder behind a symbolic link makes npm write the same package under a longer key), and the
// folder on disk must say the pinned version. The install runs no package script, so nothing from a package that does not match has run yet. When one does not
// match, all of them are forgotten, so none is loaded or reinstalled, and the error says which one. A missing record fails too: the check does not pass on silence.
// It returns the names it checked.
export function verifyPinned(prefix, names) {
  const packages = readJson(path.join(prefix, 'node_modules', '.package-lock.json'))?.packages ?? {};
  const reached = new Map();
  const queue = names.map((name) => ({ name, optional: false }));
  while (queue.length) {
    const { name, optional } = queue.shift();
    if (reached.has(name)) continue;
    const records = Object.entries(packages).filter(([key]) => isPackageKey(key, name)).map(([, record]) => record);
    const onDisk = readJson(path.join(folderOf(prefix, name), 'package.json'));
    if (optional && !records.length && !onDisk) continue;
    reached.set(name, { records, onDisk });
    const { required, optional: optionalNames } = asked(onDisk);
    queue.push(...required.map((dep) => ({ name: dep, optional: false })), ...optionalNames.map((dep) => ({ name: dep, optional: true })));
  }
  for (const [name, { records, onDisk }] of reached) {
    const pin = PINS[name];
    if (pin && records.length && records.every((r) => r.version === pin.version && r.integrity === pin.integrity) && onDisk?.version === pin.version) continue;
    forget(prefix, [...reached.keys()]);
    if (!pin) throw new CliError(`${name} is not a package 100x pins, so it was not trusted. It was removed, and nothing was run.`);
    const saw = records.length ? records.map((r) => `version ${r.version} with hash ${r.integrity ?? 'none'}`).join(' and ') : 'no record of it';
    throw new CliError(`${name} does not match what 100x pins (${pin.version}, ${pin.integrity}). npm wrote ${saw}${onDisk?.version === pin.version ? '' : `, and the folder says ${onDisk?.version ?? 'nothing'}`}. It was removed, and nothing was run.`);
  }
  return [...reached.keys()];
}
