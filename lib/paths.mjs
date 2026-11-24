import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A relative path as people write it in text and docs, with / on every system.
export const posix = (p) => p.split(path.sep).join('/');

// pathToFileURL, except that a Windows path with a root and no drive letter, as the README's sample paths are, is kept as written.
export const fileUrl = (p) => (process.platform === 'win32' && /^[\\/](?![\\/])/.test(p) ? `file://${p.replaceAll('\\', '/')}` : pathToFileURL(p).href);

// A path written with / on Windows too, for text an agent reads and a command that is pasted into a shell.
export const slashes = (p) => (process.platform === 'win32' ? p.replaceAll('\\', '/') : p);

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const globalDir = () => process.env.X100_HOME ?? path.join(os.homedir(), '.100x');

// The page that lists every finished run, written by `100x report`. A run's own report links back to it.
export const galleryFile = () => path.join(globalDir(), 'morning', 'index.html');

export const skillsDir = () => process.env.X100_SKILLS_DIR ?? path.join(os.homedir(), '.agents', 'skills');

// The same folder by its real path, because a temp folder or a home folder can sit behind a symlink (macOS /var is /private/var).
function sameFolder(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

export function findProjectRoot(from = process.cwd()) {
  const global = globalDir();
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, '.100x');
    // The folder an install writes into is the home, never a project. Only a home holds the install record, so a stray one that
    // is not this run's home (an older install, or a temp folder that sits under a profile folder, as on Windows) is skipped too.
    if (fs.existsSync(candidate) && !sameFolder(candidate, global) && !fs.existsSync(path.join(candidate, 'install.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function projectFile(...parts) {
  const root = findProjectRoot();
  return root ? path.join(root, '.100x', ...parts) : null;
}
