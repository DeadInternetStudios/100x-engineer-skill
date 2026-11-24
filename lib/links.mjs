import fs from 'node:fs';
import path from 'node:path';
import { isWindows } from './proc.mjs';

// Windows lets only an administrator, or a machine in Developer Mode, make a symbolic link. A folder can be linked by a junction without
// either, and a program that has no link to stand on gets a small launcher file instead. X100_NO_SYMLINK=1 asks for the fallbacks on any system.
const refused = (error) => isWindows && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code);

const isFolder = (target) => {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
};

// Makes linkPath point at target and says what it made: 'symlink' or 'junction'. Throws when neither can be made.
export function makeLink(target, linkPath) {
  const folder = isFolder(target);
  if (!process.env.X100_NO_SYMLINK) {
    try {
      fs.symlinkSync(target, linkPath, folder ? 'dir' : 'file');
      return 'symlink';
    } catch (error) {
      if (!refused(error) || !folder) throw error;
    }
  }
  if (!folder || !isWindows) throw Object.assign(new Error(`could not link ${linkPath} to ${target}`), { code: 'EPERM' });
  fs.symlinkSync(target, linkPath, 'junction');
  return 'junction';
}

export const LINK_WORDS = { symlink: 'a symlink', junction: 'a junction, because this account cannot make symlinks (they need Developer Mode or an administrator)', launcher: 'a launcher file, because Windows runs a program by its file name and not by a link' };

// On Windows the 100x program is a pair of launchers, 100x.cmd for cmd and PowerShell and a script named 100x for Git Bash, each running node on the CLI entry.
export const usesLauncher = (target) => isWindows && path.extname(target) === '.mjs';

export function launcherText(linkPath, target) {
  return path.extname(linkPath).toLowerCase() === '.cmd' ? `@echo off\r\nnode "${target}" %*\r\n` : `#!/bin/sh\nexec node "${target.replaceAll('\\', '/')}" "$@"\n`;
}

export function writeLauncher(linkPath, target) {
  fs.writeFileSync(linkPath, launcherText(linkPath, target));
}

// What a launcher is: missing, ok (it runs this target), elsewhere (it runs another 100x.mjs, named in current), or blocked (not ours).
export function launcherState(linkPath, target) {
  let text;
  try {
    text = fs.readFileSync(linkPath, 'utf8');
  } catch (error) {
    return error.code === 'ENOENT' ? { state: 'missing' } : { state: 'blocked', current: 'a file this install cannot read' };
  }
  if (text === launcherText(linkPath, target)) return { state: 'ok' };
  const other = /node "([^"]+100x\.mjs)"/.exec(text)?.[1];
  return other ? { state: 'elsewhere', current: path.normalize(other) } : { state: 'blocked', current: 'a real file' };
}
