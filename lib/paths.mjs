import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
