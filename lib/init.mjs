import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COLUMNS, isRunStart, readRows } from './decisions.mjs';
import { CliError } from './errors.mjs';
import { archiveStageTags } from './git.mjs';
import { globalDir, posix } from './paths.mjs';
import { PROMPT_MARKER, PROMPT_MARKER_TEXT, projectTemplate } from './prompt.mjs';

const FRAMEWORKS = {
  next: 3000,
  vite: 5173,
  astro: 4321,
  '@sveltejs/kit': 5173,
  nuxt: 3000,
  'react-scripts': 3000,
  expo: 8081,
  express: 3000,
  fastify: 3000,
  hono: 3000,
  phaser: null,
  'pixi.js': null,
  three: null,
  electron: null,
  'react-native': null,
};

const DEPLOY_FILES = [
  ['vercel.json', 'vercel'],
  ['.vercel', 'vercel'],
  ['netlify.toml', 'netlify'],
  ['wrangler.toml', 'cloudflare'],
  ['wrangler.jsonc', 'cloudflare'],
  ['firebase.json', 'firebase'],
  ['fly.toml', 'fly'],
];

const STATE_TEMPLATE = `# State

Stage: 0 Open
Next: write the prompt in project.md (references/prompt.md), check it with \`100x prompt check\`, then send the short first message
Open risks: none yet

To continue: read project.md, decisions.tsv and this file, then \`git log --oneline -10\`.
`;

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

export function detect(root) {
  const read = (file) => {
    try {
      return fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      return null;
    }
  };
  const exists = (file) => fs.existsSync(path.join(root, file));
  const out = { kind: 'unknown', packageManager: null, scripts: {}, frameworks: [], devCommand: null, urlGuess: null, deployHints: [], playwright: false };
  const packageText = read('package.json');
  if (packageText) {
    let pkg = {};
    try {
      pkg = JSON.parse(packageText);
    } catch {
      pkg = {};
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    out.kind = 'node';
    out.packageManager = exists('pnpm-lock.yaml') ? 'pnpm' : exists('yarn.lock') ? 'yarn' : exists('bun.lock') || exists('bun.lockb') ? 'bun' : 'npm';
    out.scripts = Object.fromEntries(['dev', 'start', 'build', 'test', 'preview'].filter((key) => pkg.scripts?.[key]).map((key) => [key, pkg.scripts[key]]));
    for (const [name, port] of Object.entries(FRAMEWORKS)) {
      if (!deps[name]) continue;
      out.frameworks.push(name);
      if (port && !out.urlGuess) out.urlGuess = `http://localhost:${port}`;
    }
    const script = out.scripts.dev ? 'dev' : out.scripts.start ? 'start' : null;
    if (script) out.devCommand = `${out.packageManager} run ${script}`;
    out.playwright = Boolean(deps.playwright || deps['@playwright/test']);
  } else if (exists('pyproject.toml') || exists('requirements.txt')) {
    out.kind = 'python';
  } else if (exists('index.html')) {
    out.kind = 'static';
    out.devCommand = 'python3 -m http.server 8000';
    out.urlGuess = 'http://localhost:8000';
  }
  for (const [file, name] of DEPLOY_FILES) if (exists(file) && !out.deployHints.includes(name)) out.deployHints.push(name);
  return out;
}

// What one run leaves in .100x. A new brief in the same folder starts without any of it. The decisions log stays, because
// its start rows already mark where each run began, and so does config.json.
const RUN_FILES = ['project.md', PROMPT_MARKER, 'STATE.md', 'run.json', 'finished.json', 'REPORT.md', 'REPORT.html', 'clock.json', 'watchdog.json'];
// audit is there for runs made before 100x dropped the page audit, so an old run is still put aside whole.
const RUN_FOLDERS = ['shots', 'audit', 'review', 'loops', 'must-not-break', 'solo'];

function readState(root, name) {
  try {
    return fs.readFileSync(path.join(root, '.100x', name), 'utf8');
  } catch {
    return '';
  }
}

// A run is here when it logged its start, wrote run.json, or moved STATE.md past "0 Open". The last is for a run whose start row an agent
// wrote by hand, or whose run.json went missing. It is still going, so nothing may hold it to a step it began without.
function earlierRun(root) {
  const stage = /^Stage:[ \t]*(.+)$/im.exec(readState(root, 'STATE.md'))?.[1]?.trim() ?? null;
  const begun = readRows(path.join(root, '.100x', 'decisions.tsv')).some(isRunStart) || readState(root, 'run.json') || (stage && !/^0\b/.test(stage));
  if (!begun) return null;
  return {
    finished: fs.existsSync(path.join(root, '.100x', 'finished.json')),
    stage,
    watchdog: (() => {
      try {
        return JSON.parse(readState(root, 'watchdog.json')).scheduledTaskId ?? null;
      } catch {
        return null;
      }
    })(),
  };
}

function archiveEarlierRun(root, now = new Date()) {
  const state = path.join(root, '.100x');
  const hero = fs.readdirSync(state).filter((name) => /^hero\./.test(name));
  const names = [...RUN_FILES, ...RUN_FOLDERS, ...hero].filter((name) => fs.existsSync(path.join(state, name)));
  if (!names.length) return null;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  let target = path.join(state, 'archive', stamp);
  for (let n = 2; fs.existsSync(target); n += 1) target = path.join(state, 'archive', `${stamp}-${n}`);
  fs.mkdirSync(target, { recursive: true });
  for (const name of names) fs.renameSync(path.join(state, name), path.join(target, name));
  return { dir: posix(path.relative(root, target)), tags: archiveStageTags(root, path.basename(target)) };
}

export function initProject({ dir = process.cwd(), git: useGit = true, track = false, fresh = false } = {}) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) throw new CliError(`${root} does not exist.`);
  if (root === os.homedir() || root === path.parse(root).root || path.join(root, '.100x') === globalDir()) {
    throw new CliError(`Refusing to set up a project in ${root}. Run this inside the project folder.`);
  }
  const earlier = earlierRun(root);
  if (earlier && fresh) {
    const moved = archiveEarlierRun(root);
    earlier.archivedTo = moved?.dir ?? null;
    if (moved?.tags.length) earlier.archivedTags = moved.tags;
  }
  const created = [];
  const ensureDir = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(abs, { recursive: true });
      created.push(rel);
    }
  };
  const ensureFile = (rel, content) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, content);
      created.push(rel);
    }
  };
  for (const sub of ['', 'shots', 'must-not-break', 'review']) ensureDir(path.join('.100x', sub));
  ensureFile('.100x/project.md', projectTemplate(path.basename(root)));
  // This init starts a run when none is here, or when the earlier one was just put aside. A run that is already going is never stamped,
  // so one that began before the prompt step stays judged the way it began, whatever runs `100x init` on it again.
  if (!earlier || fresh) ensureFile(`.100x/${PROMPT_MARKER}`, PROMPT_MARKER_TEXT);
  ensureFile('.100x/decisions.tsv', `${COLUMNS.join('\t')}\n`);
  ensureFile('.100x/STATE.md', STATE_TEMPLATE);

  let inside = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!inside && useGit) {
    git(root, ['init', '-q']);
    inside = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
    if (inside) created.push('git repository');
  }
  let excluded = false;
  if (inside && !track) {
    const exclude = git(root, ['rev-parse', '--git-path', 'info/exclude']);
    if (exclude) {
      const file = path.resolve(root, exclude);
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!text.split('\n').includes('.100x/')) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}.100x/\n`);
      }
      excluded = true;
    }
  }
  const status = inside ? git(root, ['status', '--porcelain']) : null;
  return {
    root,
    created,
    earlier,
    git: {
      present: inside,
      branch: inside ? git(root, ['symbolic-ref', '--short', '-q', 'HEAD']) : null,
      head: inside ? git(root, ['rev-parse', '--short', 'HEAD']) : null,
      clean: inside ? status === '' : null,
      ignoresStateFolder: excluded,
    },
    stack: detect(root),
  };
}
