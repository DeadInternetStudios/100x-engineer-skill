import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { globalDir } from './paths.mjs';
import { PINS } from './pins.mjs';

function candidateBases(cwd) {
  const bases = [];
  if (process.env.X100_PLAYWRIGHT_FROM) bases.push(process.env.X100_PLAYWRIGHT_FROM);
  bases.push(cwd, globalDir());
  return bases;
}

export function resolvePlaywright(cwd = process.cwd()) {
  for (const base of candidateBases(cwd)) {
    try {
      const require = createRequire(path.join(base, 'resolve.js'));
      let dir = path.dirname(require.resolve('playwright'));
      while (!fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
      const playwright = require('playwright');
      if (playwright?.chromium) {
        return { base, root: dir, version: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, playwright };
      }
    } catch {
      // try the next base
    }
  }
  return null;
}

export function browserCacheDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  return process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright') : path.join(os.homedir(), '.cache', 'ms-playwright');
}

export function chromiumBuilds() {
  try {
    return fs.readdirSync(browserCacheDir()).filter((name) => name.startsWith('chromium'));
  } catch {
    return [];
  }
}

export const INSTALL_HINT = `Run \`100x browsers\` once. It installs Playwright ${PINS.playwright.version}, checked against its pinned hash, and the Chromium build that version names into ~/.100x.`;
