import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLink } from '../lib/links.mjs';
import { findSh } from '../lib/proc.mjs';
import { browserCacheDir, resolvePlaywright } from '../lib/playwright.mjs';

const REAL_BROWSER_CACHE = browserCacheDir();
const PLAYWRIGHT_BASE = resolvePlaywright()?.base;
// Tests that start a gallery in this process point X100_HOME at a sandbox, and Playwright must still resolve there.
if (PLAYWRIGHT_BASE) process.env.X100_PLAYWRIGHT_FROM ??= PLAYWRIGHT_BASE;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(ROOT, 'bin', '100x.mjs');

// Tests that drive a real browser carry this as their skip reason. `npm run test:fast` sets X100_FAST and leaves them out, which is most of the minutes.
export const browserSkip = process.env.X100_FAST ? 'the fast lane leaves out tests that drive a browser' : resolvePlaywright() ? false : 'Playwright is not resolvable here. Run `100x browsers`.';

export function sandbox() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), '100x-test-'));
  const home = path.join(dir, 'home');
  const project = path.join(dir, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  return {
    dir,
    home,
    project,
    env: { HOME: home, USERPROFILE: home, X100_HOME: path.join(home, '.100x'), X100_SKILLS_DIR: path.join(home, '.agents', 'skills'), PLAYWRIGHT_BROWSERS_PATH: REAL_BROWSER_CACHE, ...(PLAYWRIGHT_BASE ? { X100_PLAYWRIGHT_FROM: PLAYWRIGHT_BASE } : {}) },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

// What 100x sets for a helper it starts (a judge, a child) is not the tests' to inherit. A test run from inside a judge would
// otherwise read the judge's own model and window as if the owner had chosen them.
const HELPER_ENV = /^X100_(MODEL|PROVIDER|EFFORT|TASK|BRIEF|FINDINGS|ROOT|OPT_\w+)$/;
const inherited = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !HELPER_ENV.test(name)));

export function cli(args, { cwd = ROOT, env = {} } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, env: { ...inherited(), ...env }, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

// A link to a folder, or to a folder that is gone. Where symlinks are not allowed (Windows without Developer Mode) it is a junction.
export const symlink = (target, linkPath) => makeLink(target, linkPath);

// A link to a file has no such fallback, so a test that needs one carries this as its skip reason.
export const noFileLinks = (() => {
  if (process.env.X100_NO_SYMLINK) return 'X100_NO_SYMLINK is set, so no symlink is made';
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), '100x-link-'));
  try {
    fs.writeFileSync(path.join(dir, 'a'), '');
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'b'), 'file');
    return false;
  } catch (error) {
    return error.code === 'EPERM' ? 'a link to a file needs Developer Mode or an administrator on Windows' : false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

// The POSIX shell the commands in the docs are written for. Windows has one when Git for Windows is installed.
export const SH = findSh();
// bash.exe sits beside sh.exe in Git for Windows. A bare "bash" on Windows can be the one that starts WSL.
export const BASH = process.platform === 'win32' ? (SH ? path.join(path.dirname(SH), 'bash.exe') : 'bash') : 'bash';

// A stand-in program that runs by its name from a PATH folder: a node script, and the launchers that start it. Returns the path that starts it
// on this system, a .cmd on Windows (where the same folder also gets a script for sh, which looks a program up without an extension).
export function fakeBin(dir, name, source) {
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(script, source);
  const sh = path.join(dir, name);
  fs.writeFileSync(sh, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`, { mode: 0o755 });
  if (process.platform !== 'win32') return sh;
  const cmd = path.join(dir, `${name}.cmd`);
  fs.writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  return cmd;
}

export function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
