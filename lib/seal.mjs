import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.mjs';
import { globalDir } from './paths.mjs';

// 100x signs what its own tools measure with a key kept in the global folder, so a number typed by hand has no valid signature.
// That stops evidence made up out of convenience. It cannot stop someone who reads this code and signs a file on purpose.
const keyFile = () => path.join(globalDir(), 'audit.key');

export function signingKey({ create }) {
  try {
    return fs.readFileSync(keyFile(), 'utf8').trim();
  } catch {
    if (!create) return null;
  }
  // The key is written whole to a private name and linked into place, so two runs that start together end up with one key and nobody reads half of it.
  const key = crypto.randomBytes(32).toString('hex');
  const temp = `${keyFile()}.${process.pid}`;
  try {
    fs.mkdirSync(globalDir(), { recursive: true });
    fs.writeFileSync(temp, `${key}\n`, { mode: 0o600 });
    fs.linkSync(temp, keyFile());
    return key;
  } catch (error) {
    if (error.code === 'EEXIST') return fs.readFileSync(keyFile(), 'utf8').trim();
    throw new CliError(`100x could not save its signing key in ${globalDir()} (${error.code ?? error.message}). It signs what its tools measure, and finish refuses a run that is not signed. Make that folder writable, or set X100_HOME to one that is.`);
  } finally {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // The folder was never there, so there is no private copy to remove.
    }
  }
}

export const sign = (content, key) => crypto.createHmac('sha256', key).update(content).digest('hex');

const sealPath = (file) => `${file}.seal`;

// The signature of a file the tool wrote sits beside it, as matrix.json.seal. Any change to the file breaks it.
export function sealFile(file) {
  fs.writeFileSync(sealPath(file), `${sign(fs.readFileSync(file), signingKey({ create: true }))}\n`);
}

// True when the seal beside a file has the shape of a signature, 64 hex digits. It says nothing about whose key made it.
export function sealHasShape(file) {
  try {
    return /^[0-9a-f]{64}$/.test(fs.readFileSync(sealPath(file), 'utf8').trim());
  } catch {
    return false;
  }
}

// missing (no file), unsigned (there, but the tool did not write it or it changed since) or ok.
export function sealState(file) {
  if (!fs.existsSync(file)) return 'missing';
  const key = signingKey({ create: false });
  let given;
  try {
    given = fs.readFileSync(sealPath(file), 'utf8').trim();
  } catch {
    return 'unsigned';
  }
  if (!key || !/^[0-9a-f]{64}$/.test(given)) return 'unsigned';
  return crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(sign(fs.readFileSync(file), key), 'hex')) ? 'ok' : 'unsigned';
}
