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
  // A relative target is read from the folder that holds the link, as a symlink reads it. A junction needs the whole path.
  const absolute = path.resolve(path.dirname(linkPath), target);
  const folder = isFolder(absolute);
  // A link to a folder that is gone is made the same way, because the links this makes are to skill folders.
  const junctionable = isWindows && (folder || !fs.existsSync(absolute));
  if (!process.env.X100_NO_SYMLINK) {
    try {
      fs.symlinkSync(target, linkPath, folder ? 'dir' : 'file');
      return 'symlink';
    } catch (error) {
      if (!refused(error) || !junctionable) throw error;
    }
  }
  if (!junctionable) throw Object.assign(new Error(`could not link ${linkPath} to ${target}`), { code: 'EPERM' });
  fs.symlinkSync(absolute, linkPath, 'junction');
  return 'junction';
}

// What each kind of link is, said once after a listing of links, so the listing itself stays short.
export const LINK_NOTES = {
  junction: 'junction: a folder link that Windows lets any account make. A symlink needs Developer Mode or an administrator, and this account has neither. A junction works the same for the agent apps.',
  launcher: 'launcher: a small file that runs 100x, because Windows starts a program by its file name and not through a link. 100x.cmd is for cmd and PowerShell, and 100x is for Git Bash.',
};

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
