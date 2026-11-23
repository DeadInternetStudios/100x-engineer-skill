import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    env: { HOME: home, X100_HOME: path.join(home, '.100x'), X100_SKILLS_DIR: path.join(home, '.agents', 'skills'), PLAYWRIGHT_BROWSERS_PATH: REAL_BROWSER_CACHE, ...(PLAYWRIGHT_BASE ? { X100_PLAYWRIGHT_FROM: PLAYWRIGHT_BASE } : {}) },
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

export function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
