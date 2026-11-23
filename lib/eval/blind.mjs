import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CliError } from '../errors.mjs';
import { REPO_ROOT } from '../paths.mjs';
import { chromiumBuilds, INSTALL_HINT, resolvePlaywright } from '../playwright.mjs';
import { readReceipt, receiptParams } from '../receipt.mjs';
import { sign, signingKey } from '../seal.mjs';
import { plural } from './words.mjs';

const BIN = path.join(REPO_ROOT, 'bin', '100x.mjs');
export const BRIEFS_FILE = path.join(REPO_ROOT, 'evals', 'briefs.json');
export const PROTOCOL_FILE = path.join(REPO_ROOT, 'evals', 'PROTOCOL.md');

// A bake-off compares two arms on the same briefs. Each pair is judged twice, once with each arm in the A place, from folders that carry
// no arm name. Which arm is which sits in key.json outside those folders, and the key's hash is written down before any verdict.
export const ORDERS = ['o1', 'o2'];
// Where the model that ran was read from: the SDK's result, the app's own log, or the helper's word for itself.
export const MODEL_SOURCES = ['sdk', 'app', 'self'];
export const CONTROL_KINDS = ['planted', 'identical'];
// Names that do not turn up in ordinary prose, so the leak scan can tell a page that names its arm from a page that says "plain".
export const DEFAULT_ARMS = ['skill-off', 'skill-on'];
const ID = /^[a-z0-9][a-z0-9-]*$/;
// Files an arm writes about itself. They differ by arm and they are not the product, so a judge is not given them.
const SKIP_DIRS = new Set(['.git', '.100x', 'node_modules', '.DS_Store']);
const SKIP_FILES = new Set(['RUN.md', 'STATE.md', 'TASK.md', 'MOCKUP.md', '.DS_Store']);
export const notProduct = (name, isDirectory) => (isDirectory ? SKIP_DIRS.has(name) : SKIP_FILES.has(name) || name.endsWith('.log'));
// The scan reads what a file holds, not what its name says. A file with no extension, or an odd one, is read as text unless it has a zero byte in its
// first 8 KB. A binary file is searched for every name byte by byte, and a file too big to read whole is listed as one the scan could not check.
// A name of fewer than 6 characters, which is only "100x", is left out of a compressed picture, where four bytes in a row match by chance about once in 2 billion.
const MAX_SCAN_BYTES = 25 * 1024 * 1024;
const SNIFF_BYTES = 8192;
const SHORT_WORD = 6;
const PICTURE = [[0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x47, 0x49, 0x46, 0x38], [0x52, 0x49, 0x46, 0x46]];
const isPicture = (bytes) => PICTURE.some((magic) => magic.every((byte, index) => bytes[index] === byte));
// How much of the key's hash a verdict quotes. Long enough that no one guesses it, short enough that a judge copies it right.
export const SEALED_LENGTH = 16;
export const VIEWPORTS = ['390x844@2', '1280x800@1'];
const SCREEN_NAMES = ['phone', 'desktop'];

export const paths = (dir) => ({
  config: path.join(dir, 'bakeoff.json'),
  runs: path.join(dir, 'runs.json'),
  key: path.join(dir, 'key.json'),
  seal: path.join(dir, 'key.sha256'),
  leak: path.join(dir, 'leakscan.json'),
  receipts: path.join(dir, 'receipts'),
  judge: path.join(dir, 'judge'),
  arms: path.join(dir, 'arms'),
  tasks: path.join(dir, 'tasks'),
});

export const readJson = (file, what) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CliError(`Could not read ${what} at ${file}: ${error.code === 'ENOENT' ? 'it is not there' : error.message}`);
  }
};
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

export const loadConfig = (dir) => readJson(paths(dir).config, 'the bake-off setup (run 100x eval bakeoff init first)');

// mulberry32, so a seed fixes every draw and a reviewer can redraw it.
export function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, next) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// An arm works in a folder named by its place in the arms list, so the task an arm reads and the path it works in say nothing about which
// arm it is. The first arm named is arm-1.
export const armFolder = (dir, arms, brief, arm) => path.join(paths(dir).arms, brief, `arm-${arms.indexOf(arm) + 1}`);

const TASK = (brief, folder, minutes) => `# Task

${brief.text.trim()}

## Deliver
Make a web prototype in this folder, ${folder}. The entry file is index.html. It has no build step, needs no network and no installed package, and works when index.html is opened as a file. Everything it needs is in this folder.
You have ${minutes} minutes. Stop when they are up and leave the folder as it is. Do not touch any other folder.
Use no skill from your list of installed skills, and open no SKILL.md file except one that a Method section below names.
The page stands as a finished product. Do not write the words "unreviewed" or "mockup" in any file in this folder, and put no label on it about how it was made. If a Method section asks you to mark the work, say so in your final message and in no file here.
Write RUN.md in this folder with one line that says how to open it.
`;

const shell = (text) => `'${text.replaceAll("'", "'\\''")}'`;

// The skill-on arm gets a copy of the skill as it is now, a clean home and the default profile, so a later edit to the repo or the owner's
// own settings cannot change what the arm ran. The copy is outside every folder a judge sees.
const PIN_ITEMS = ['bin', 'lib', 'skills', 'vendor', 'package.json', 'companions.json'];

function gitState() {
  const run = (args) => spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
  const head = run(['rev-parse', 'HEAD']);
  return head.status === 0 ? { commit: head.stdout.trim(), dirty: run(['status', '--porcelain']).stdout.trim() !== '' } : null;
}

export function pinSkill(dir) {
  const folder = path.join(dir, 'pinned');
  fs.mkdirSync(path.join(folder, 'home'), { recursive: true });
  for (const item of PIN_ITEMS) if (fs.existsSync(path.join(REPO_ROOT, item))) fs.cpSync(path.join(REPO_ROOT, item), path.join(folder, item), { recursive: true });
  const playwright = resolvePlaywright()?.base;
  const command = path.join(folder, '100x');
  fs.writeFileSync(command, `#!/bin/sh\nX100_HOME=${shell(path.join(folder, 'home'))}${playwright ? ` X100_PLAYWRIGHT_FROM=${shell(playwright)}` : ''} exec node ${shell(path.join(folder, 'bin', '100x.mjs'))} "$@"\n`, { mode: 0o755 });
  return { folder, command, snapshot: gitState() };
}

const METHOD = (pin) => `Follow the skill in ${path.join(pin.folder, 'skills', '100x-mockup', 'SKILL.md')}. Its 100x command is ${pin.command}, so run that wherever the skill says to run 100x. Read no other SKILL.md file and use no other skill.`;

export const runKeys = (config) => config.briefs.flatMap((b) => config.arms.map((a) => `${b.id}/${a}`));

export function initBakeoff(dir, { briefs, arms = DEFAULT_ARMS, seed, notes = {}, minutes = 20, pin = false }) {
  if (!Array.isArray(briefs) || briefs.length === 0) throw new CliError('The briefs file must hold a list of briefs, each with id, title and text.');
  const ids = new Set();
  for (const brief of briefs) {
    if (!ID.test(brief.id ?? '') || !brief.title || !brief.text) throw new CliError(`A brief needs an id of lowercase letters, digits and hyphens, a title and a text. Got ${JSON.stringify(brief).slice(0, 80)}.`);
    if (ids.has(brief.id)) throw new CliError(`Brief id ${brief.id} appears twice.`);
    ids.add(brief.id);
  }
  if (arms.length !== 2 || new Set(arms).size !== 2 || !arms.every((a) => ID.test(a))) throw new CliError('A bake-off compares exactly two arms, named with lowercase letters, digits and hyphens. Got ' + JSON.stringify(arms) + '.');
  if (!Number.isInteger(minutes) || minutes < 1) throw new CliError('--minutes takes a whole number above 0.');
  for (const arm of Object.keys(notes)) if (!arms.includes(arm)) throw new CliError(`--note names ${arm}, which is not one of the arms. The arms are ${arms.join(' and ')}. A method paragraph for an arm that does not exist would be dropped and the arm would run with none.`);
  const where = paths(dir);
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) throw new CliError(`${dir} is a file, not a folder. Name a folder for the bake-off.`);
  if (fs.existsSync(where.config)) throw new CliError(`${dir} already holds a bake-off. Use a new folder.`);
  const drawn = seed ?? crypto.randomInt(1, 2 ** 31);
  fs.mkdirSync(where.tasks, { recursive: true });
  const pinned = pin ? pinSkill(dir) : null;
  const methods = { ...(pinned ? { [arms[1]]: METHOD(pinned) } : {}), ...notes };
  for (const brief of briefs) {
    for (const arm of arms) {
      const folder = armFolder(dir, arms, brief.id, arm);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(where.tasks, `${brief.id}--${arm}.md`), `${TASK(brief, folder, minutes)}${methods[arm] ? `\n## Method\n${methods[arm].trim()}\n` : ''}`);
    }
  }
  // The order the runs are made in is drawn too, so neither arm always goes first and meets the better hour or the fuller quota.
  const order = shuffle(briefs.flatMap((b) => arms.map((a) => `${b.id}/${a}`)), rng(drawn ^ 0x5bd1e995));
  writeJson(where.config, { version: 1, protocol: crypto.createHash('sha256').update(fs.readFileSync(PROTOCOL_FILE)).digest('hex'), arms, briefs, seed: drawn, minutes, order, ...(pinned ? { pinned: { folder: pinned.folder, command: pinned.command, snapshot: pinned.snapshot } } : {}), createdAt: new Date().toISOString() });
  return { seed: drawn, order, pinned, tasks: briefs.flatMap((b) => arms.map((a) => path.join(where.tasks, `${b.id}--${a}.md`))) };
}

// The judge folders exist once the pairs are built, and the key lists them.
export function judgeFolders(dir) {
  const file = paths(dir).key;
  if (!fs.existsSync(file)) return [];
  const items = readJson(file, 'the key').items;
  return Array.isArray(items) ? items.flatMap((item) => ORDERS.map((order) => `${item.id}-${order}`)) : [];
}

// Times come from this machine's clock when the arm starts and stops, so an arm's own report of how long it took is never the number.
// The key is "<brief>/<arm>", "judge/<folder>" for one judge's own model record once the pairs are built, or "judge" for one record that covers every judge folder.
export function markRun(dir, { key, action, model = null, ran = null, source = null, tokens = null, receipt = null, now = new Date() }) {
  const config = loadConfig(dir);
  const valid = ['judge', ...judgeFolders(dir).map((folder) => `judge/${folder}`), ...config.briefs.flatMap((b) => config.arms.map((a) => `${b.id}/${a}`))];
  if (!valid.includes(key)) throw new CliError(`${key} is not a run in this bake-off. They are ${valid.join(', ')}.`);
  if (!['start', 'stop'].includes(action)) throw new CliError('mark takes start or stop.');
  if (source !== null && !MODEL_SOURCES.includes(source)) throw new CliError(`--source is ${MODEL_SOURCES.join(', ')}. Got "${source}".`);
  if (receipt !== null && action !== 'stop') throw new CliError('--receipt goes with stop, when the helper has ended and its receipt is written.');
  if (receipt !== null && (model || ran || source || tokens !== null)) throw new CliError('A receipt carries the model asked for, the model that ran, where it came from and the tokens. Give it without --model, --ran, --source or --tokens.');
  const file = paths(dir).runs;
  const runs = fs.existsSync(file) ? readJson(file, 'the run times') : {};
  const entry = runs[key] ?? {};
  if (action === 'start') {
    if (entry.startedAt) throw new CliError(`${key} was already started at ${entry.startedAt}. A second start would hide the first.`);
    entry.startedAt = now.toISOString();
  } else {
    // A judge record is only there to say which model judged, so it needs no start.
    if (!entry.startedAt && !key.startsWith('judge')) throw new CliError(`${key} was never started. Run mark start first.`);
    if (entry.finishedAt) throw new CliError(`${key} already stopped at ${entry.finishedAt}.`);
    entry.finishedAt = now.toISOString();
    if (entry.startedAt) entry.minutes = Math.round(((now - new Date(entry.startedAt)) / 60_000) * 100) / 100;
  }
  if (receipt !== null) {
    const { receipt: said, sha } = readReceipt(path.resolve(receipt));
    // One helper ran one thing. A receipt that backs two records would let one run stand for every arm.
    const twin = Object.entries(runs).find(([name, run]) => name !== key && run.model?.runId === said.runId);
    if (twin) throw new CliError(`This receipt is for run ${said.runId}, which already backs ${twin[0]}. Each run needs a receipt of its own.`);
    const saved = path.join(paths(dir).receipts, `${key.replaceAll('/', '__')}.json`);
    fs.mkdirSync(paths(dir).receipts, { recursive: true });
    fs.copyFileSync(path.resolve(receipt), saved);
    fs.copyFileSync(`${path.resolve(receipt)}.seal`, `${saved}.seal`);
    entry.model = { requested: said.requested.id, ran: said.ran.id, params: receiptParams(said), source: 'sdk', receipt: sha, agentId: said.agentId, runId: said.runId };
    if (typeof said.tokens === 'number') entry.tokens = said.tokens;
  } else {
    if (model || ran || source) entry.model = { ...entry.model, ...(model ? { requested: model } : {}), ...(ran ? { ran } : {}), ...(source ? { source } : {}) };
    if (tokens !== null) entry.tokens = tokens;
  }
  runs[key] = entry;
  writeJson(file, runs);
  return { key, ...entry };
}

function copyProduct(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return !notProduct(name, fs.statSync(source).isDirectory());
    },
  });
}

// The words a judge must never meet: the skill's name, the files it leaves, the words it tells an arm to put on its work, the names of the arms and the folder each arm works in. Every
// arm is told its own folder, arm-1 or arm-2, so that name is the one string an arm is certain to know about itself. A word an arm name
// shares with plain English ("plain") is allowed one by one with --allow, and the scan records what was allowed. "unreviewed" and "mockup" are what the
// 100x-mockup skill uses for itself: its description says a mockup ends UNREVIEWED and says so on its card. In the first run of 20 briefs five runs of that arm wrote
// "UNREVIEWED mockup" on the page, and in four of those five pairs the judge's reasons named it, so the arm was identifiable by content and no name scan had caught it.
const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const LABELS = [{ word: 'unreviewed', pattern: /\bunreviewed\b/i }, { word: 'mockup', pattern: /\bmock-?ups?\b/i }];

// `labels: false` is how a key made before the scan knew these two words is read again, so a finished run is not voided by a rule it was not run under.
export function leakPatterns(arms, allow = [], { labels = true } = {}) {
  const base = [{ word: '100x', pattern: /100x/i }, { word: 'SKILL.md', pattern: /\bSKILL\.md\b/ }, { word: 'STATE.md', pattern: /\bSTATE\.md\b/ }, { word: 'bakeoff', pattern: /\bbake-?off\b/i }, { word: 'an arm folder', pattern: /\barm-[12]\b/i }, ...(labels ? LABELS : [])];
  const named = arms.filter((arm) => !base.some((entry) => entry.pattern.test(arm))).map((arm) => ({ word: arm, pattern: new RegExp(`(?<![A-Za-z0-9])${arm.split('-').map(escape).join('\\s*[-_]\\s*')}(?![A-Za-z0-9])`, 'i') }));
  const allowed = new Set(allow.map((word) => word.toLowerCase()));
  return [...base, ...named].filter((entry) => !allowed.has(entry.word.toLowerCase()));
}

// A judge sees the path it is pointed at. Words in it do not say which arm is which, but they say a skill is part of this.
export const pathWords = (folder, patterns) => patterns.filter((entry) => entry.pattern.test(folder)).map((entry) => entry.word);

// `product` leaves out what an arm writes about itself, which a judge is not given, so a folder an arm worked in is read as the judge would meet it.
export function scanForLeaks(folder, patterns, { product = false } = {}) {
  const hits = [];
  const unscanned = [];
  let scanned = 0;
  let binary = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (product && notProduct(entry.name, entry.isDirectory())) continue;
      const file = path.join(current, entry.name);
      const relative = path.relative(folder, file);
      for (const { word, pattern } of patterns) if (pattern.test(relative)) hits.push({ file: relative, line: 0, text: `the file name holds "${word}"` });
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (entry.isSymbolicLink()) {
        unscanned.push({ file: relative, why: 'it is a symbolic link, and the judge would follow it out of this folder' });
        continue;
      }
      const size = fs.statSync(file).size;
      if (size > MAX_SCAN_BYTES) {
        unscanned.push({ file: relative, why: `it is ${Math.round(size / 1024 / 1024)} MB, over the ${MAX_SCAN_BYTES / 1024 / 1024} MB the scan reads` });
        continue;
      }
      const bytes = fs.readFileSync(file);
      if (bytes.subarray(0, SNIFF_BYTES).includes(0)) {
        binary += 1;
        const raw = bytes.toString('latin1');
        const picture = isPicture(bytes);
        for (const { word, pattern } of patterns) if (!(picture && word.length < SHORT_WORD) && pattern.test(raw)) hits.push({ file: relative, line: 0, text: `the binary file holds "${word}"` });
        continue;
      }
      scanned += 1;
      bytes.toString('utf8').split('\n').forEach((text, index) => {
        if (patterns.some(({ pattern }) => pattern.test(text))) hits.push({ file: relative, line: index + 1, text: text.trim().slice(0, 100) });
      });
    }
  };
  walk(folder);
  return { scanned, binary, unscanned, hits };
}

const BLUR = '<style>html{filter:blur(6px)!important}</style>';
// What a judge opens in place of a run that left no page. It names nothing, so it cannot give the run away.
const BLANK_PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Empty</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;color:#666">This page is empty.</body>\n';
function blurCopy(folder) {
  const entry = path.join(folder, 'index.html');
  const html = fs.readFileSync(entry, 'utf8');
  fs.writeFileSync(entry, /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (tag) => `${tag}${BLUR}`) : `${BLUR}${html}`);
}

// The screenshots come from `100x shots`, which also writes the text each page showed once it ran. That text is scanned too, because a name a script
// builds in the page is in the picture and not in the file. The page's title and its attributes are not in that text.
// A cause that Playwright prints inside a box of border characters is cleaned, and a missing browser says what installs it.
export const causeOf = (output) => {
  const lines = output.split('\n').map((line) => line.replace(/[║╔╗╚╝═│┌┐└┘─]/g, '').trim()).filter(Boolean);
  const cause = lines.slice(-3).join(' ');
  return /executable doesn't exist|playwright install|browserType\.launch|not installed|Playwright Team/i.test(output) ? `${cause} ${INSTALL_HINT}` : cause;
};

export const browserReady = () => Boolean(resolvePlaywright(process.cwd())) && chromiumBuilds().length > 0;

function capture(folder, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const result = spawnSync(process.execPath, [BIN, 'shots', path.join(folder, 'index.html'), '--out', outDir, '--viewports', VIEWPORTS.join(',')], { encoding: 'utf8' });
  if (result.status !== 0) throw new CliError(`Could not take the screenshots of ${folder}: ${causeOf(`${result.stderr}\n${result.stdout}`)}`);
  const screens = VIEWPORTS.map((viewport) => {
    const [size, density] = viewport.split('@');
    const file = path.join(outDir, `custom-${size}-${density}x__initial.png`);
    if (!fs.existsSync(file)) throw new CliError(`The screenshots of ${folder} have no ${viewport} picture. Found ${fs.readdirSync(outDir).join(', ')}.`);
    return file;
  });
  const shown = path.join(outDir, 'texts.txt');
  return { screens, rendered: fs.existsSync(shown) ? fs.readFileSync(shown, 'utf8').split('\n').filter(Boolean) : [] };
}

const ASK = (brief, sealed, shot) => `# Judge two prototypes

Two people were given the same job, and each made a web prototype. The folders A and B next to this file hold them.

The job they were given:

${brief.text.trim()}

You are the judge. Your question: which of the two would you rather put in front of strangers, and be proud of?

1. Open A/index.html and B/index.html in a browser. Use each one. ${shot ? 'A screens folder in each holds screenshots of the opening screen on a phone and on a wide desktop.' : 'No screenshots were taken, so the pages are all there is to see.'}
2. Judge what a person sees and does: whether it is made with care, whether it does the job, whether it is clear, whether anything is broken or cut off. Do not judge by the amount of code.
3. Look only inside this folder. Do not look for who made which, and do not look anywhere else on this machine. Do not edit A or B.
4. Write verdict.json in this folder, and only that file:

{ "winner": "A", "why": "two plain sentences about what you saw", "sealed": "${sealed}" }

winner is "A", "B" or "tie". Say tie only when you cannot tell them apart. Be decisive when you can. Copy "sealed" exactly as it is here.
`;

// The same line of the same file arrives once for each judge folder that holds it. One line each, with the count.
const groupBySource = (items, line) => {
  const counts = new Map();
  for (const item of items) counts.set(line(item), (counts.get(line(item)) ?? 0) + (item.copies ?? 1));
  return [...counts].map(([text, count]) => (count > 1 ? `${text}  (in ${count} judge folders)` : text));
};

export function buildPairs(dir, { capture: shoot = true, allow = [], blank = false, edits = [], progress = () => {} } = {}) {
  const where = paths(dir);
  const config = loadConfig(dir);
  if (fs.existsSync(where.key)) throw new CliError('The pairs are already built and the key is sealed. A second build would be a second draw, and the first one stays.');
  const runs = config.briefs.flatMap((b) => config.arms.map((arm) => ({ brief: b.id, arm, page: path.join(armFolder(dir, config.arms, b.id, arm), 'index.html') })));
  const missing = runs.filter(({ page }) => !fs.existsSync(page));
  if (missing.length && !blank) throw new CliError(`These arm folders have no index.html yet:\n${missing.map(({ page }) => page).join('\n')}\nA run that is over and left no page failed, and it stays in the count. Run pairs again with --blank-missing to show the judge a blank page in its place, and the report names the run. Do not write the page yourself.`);
  const have = runs.filter(({ page }) => fs.existsSync(page));
  if (have.length === 0) throw new CliError('No arm left a page, so there is nothing to judge.');
  // The controls need a real page. They use the usual one, and the nearest run that has a page when that one is missing.
  const controlFrom = (brief, arm, fallback) => have.find((run) => run.brief === brief && run.arm === arm) ?? fallback;
  const plantedFrom = controlFrom(config.briefs[0].id, config.arms[0], have[0]);
  const identicalFrom = controlFrom(config.briefs.at(-1).id, config.arms[1], have.at(-1));
  const next = rng(config.seed);
  const [armA, armB] = config.arms;
  const items = config.briefs.map((brief) => {
    const swap = next() < 0.5;
    return { kind: 'real', brief: brief.id, first: swap ? armB : armA, second: swap ? armA : armB };
  });
  const flip = () => next() < 0.5;
  const planted = flip();
  items.push({ kind: 'planted', brief: plantedFrom.brief, arm: plantedFrom.arm, first: planted ? 'intact' : 'blurred', second: planted ? 'blurred' : 'intact' });
  const identical = flip();
  items.push({ kind: 'identical', brief: identicalFrom.brief, arm: identicalFrom.arm, first: identical ? 'copy-1' : 'copy-2', second: identical ? 'copy-2' : 'copy-1' });
  const numbered = shuffle(items, next).map((item, index) => ({ id: `pair-${String(index + 1).padStart(2, '0')}`, ...item }));

  // The key and its hash are known before any judge folder is written, because each ask.md quotes the hash for the judge to copy into its verdict.
  // A verdict that quotes it was written after the key was sealed, which a copy of the folder cannot undo the way it undoes file times.
  const keyText = `${JSON.stringify({ version: 1, seed: config.seed, arms: config.arms, items: numbered, labels: true, ...(shoot ? { rendered: true } : {}), ...(missing.length ? { blank: missing.map(({ brief, arm }) => ({ brief, arm })) } : {}) }, null, 2)}\n`;
  const hash = crypto.createHash('sha256').update(keyText).digest('hex');
  const sealed = hash.slice(0, SEALED_LENGTH);
  const patterns = leakPatterns(config.arms, allow);
  // What the scan found is refused the same way whether it comes before the screenshots or after the folders are built.
  const refuse = (hits, unscanned) => {
    if (unscanned.length) {
      const places = groupBySource(unscanned, (item) => `${item.file}  ${item.why}`);
      const shown = places.slice(0, 8).map((place) => `  ${place}`).join('\n');
      throw new CliError(`The blind cannot be checked. The scan could not read ${plural(places.length, 'file')} a judge would be given:\n${shown}${places.length > 8 ? `\n  and ${places.length - 8} more` : ''}\nRemove ${places.length === 1 ? 'it' : 'them'} from the arm folder and run pairs again.`);
    }
    if (hits.length) {
      const places = groupBySource(hits, (hit) => `${hit.file}${hit.line ? `:${hit.line}` : ''}  ${hit.text}`);
      const shown = places.slice(0, 8).map((place) => `  ${place}`).join('\n');
      throw new CliError(`The blind is broken. A judge would see the skill or an arm named in ${plural(places.length, 'place')}:\n${shown}${places.length > 8 ? `\n  and ${places.length - 8} more` : ''}\nRemove ${places.length === 1 ? 'it' : 'them'} from the arm folder and run pairs again. A word that is only plain English can be allowed with --allow <word>.`);
    }
  };
  // Everything is built in a work folder, scanned, and only then moved into place, so a failed scan leaves no key behind.
  const work = fs.mkdtempSync(path.join(dir, '.build-'));
  try {
    // A planted control is the first arm's page beside a blurred copy of itself, and an identical control is the second arm's page twice.
    // Pages that are the same folder share one copy and one set of screenshots.
    const sources = new Map();
    const source = (item, label) => {
      const arm = config.arms.includes(label) ? label : item.arm;
      const id = `${item.brief}-${config.arms.indexOf(arm) + 1}${label === 'blurred' ? '-blurred' : ''}`;
      if (!sources.has(id)) {
        const folder = path.join(work, 'sources', id);
        copyProduct(armFolder(dir, config.arms, item.brief, arm), folder);
        // The blank page goes into the judge's copy and never into the arm's own folder.
        if (!fs.existsSync(path.join(folder, 'index.html'))) fs.writeFileSync(path.join(folder, 'index.html'), BLANK_PAGE);
        if (label === 'blurred') blurCopy(folder);
        const rank = [label === 'blurred' ? 1 : 0, config.briefs.findIndex((b) => b.id === item.brief), config.arms.indexOf(arm)];
        sources.set(id, { id, folder, screens: [], copies: 0, rank, name: `${item.brief}/${arm}`, control: label === 'blurred', origin: path.relative(dir, armFolder(dir, config.arms, item.brief, arm)) });
      }
      return sources.get(id);
    };
    for (const item of numbered) for (const label of [item.first, item.second]) source(item, label).copies += ORDERS.length;

    // The scan of the arm's own pages comes before any screenshot. A leak refuses in seconds, and the screenshots, which take minutes, are not spent on a run that cannot go on.
    const early = { hits: [], unscanned: [] };
    for (const made of sources.values()) {
      const result = scanForLeaks(made.folder, patterns);
      early.hits.push(...result.hits.map((hit) => ({ ...hit, file: path.join(made.origin, hit.file), copies: made.copies })));
      early.unscanned.push(...result.unscanned.map((item) => ({ ...item, file: path.join(made.origin, item.file), copies: made.copies })));
    }
    refuse(early.hits, early.unscanned);

    // Each page is photographed once, however many judge folders hold it, in brief order with the control's copy last.
    if (shoot) {
      if (!browserReady()) throw new CliError(`Pairs need a browser to photograph each page, and none is installed. ${INSTALL_HINT} Or build the pairs with --no-capture, though the gallery will not take them.`);
      const ordered = [...sources.values()].sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
      progress(`Photographing ${plural(ordered.length, 'page')}, a phone and a desktop screen of each. A page takes 15 to 20 seconds.`);
      const started = Date.now();
      ordered.forEach((made, index) => {
        const taken = capture(made.folder, path.join(work, 'shots', made.id));
        made.screens = taken.screens;
        // What the page showed once it ran is scanned for the same names as its files, and a name found there is refused at once, in brief order.
        const shown = taken.rendered.filter((text) => patterns.some(({ pattern }) => pattern.test(text)));
        refuse(shown.map((text) => ({ file: path.join(made.origin, 'index.html (as it rendered)'), line: 0, text: text.slice(0, 100), copies: made.copies })), []);
        progress(`  page ${index + 1} of ${ordered.length}: ${made.control ? `the blurred control, from ${made.name}` : made.name}, ${Math.round((Date.now() - started) / 1000)} s so far`);
      });
    }
    for (const item of numbered) {
      const brief = config.briefs.find((b) => b.id === item.brief);
      for (const order of ORDERS) {
        const pack = path.join(work, 'judge', `${item.id}-${order}`);
        const sides = order === 'o1' ? { A: item.first, B: item.second } : { A: item.second, B: item.first };
        for (const [side, label] of Object.entries(sides)) {
          const from = source(item, label);
          copyProduct(from.folder, path.join(pack, side));
          from.screens.forEach((png, index) => {
            fs.mkdirSync(path.join(pack, side, 'screens'), { recursive: true });
            fs.copyFileSync(png, path.join(pack, side, 'screens', `${SCREEN_NAMES[index]}.png`));
          });
        }
        fs.writeFileSync(path.join(pack, 'ask.md'), ASK(brief, sealed, shoot));
      }
    }
    // The judge folders are scanned again as they stand, with the screenshots and ask.md, because that is what a judge is given.
    const hits = [];
    const unscanned = [];
    let scanned = 0;
    let binary = 0;
    for (const pack of fs.readdirSync(path.join(work, 'judge'))) {
      const result = scanForLeaks(path.join(work, 'judge', pack), patterns);
      scanned += result.scanned;
      binary += result.binary;
      hits.push(...result.hits.map((hit) => ({ ...hit, file: path.join(pack, hit.file) })));
      unscanned.push(...result.unscanned.map((item) => ({ ...item, file: path.join(pack, item.file) })));
    }
    refuse(hits, unscanned);
    fs.renameSync(path.join(work, 'judge'), where.judge);
    writeJson(where.leak, { ok: true, scanned, binary, allowed: allow, edits, patterns: patterns.map((entry) => entry.word), at: new Date().toISOString() });
    // The key is written last, and its hash with it, before any judge has a folder to open.
    fs.writeFileSync(where.key, keyText);
    // The hash alone could be remade by anyone who edits the key, so a signature from this machine's 100x key goes beside it. See lib/seal.mjs for what that does and does not stop.
    fs.writeFileSync(where.seal, `${hash}  key.json\n${sign(hash, signingKey({ create: true }))}  signature\n`);
    return { pairs: numbered.length, packs: numbered.length * ORDERS.length, hash, scanned, binary, pathWords: pathWords(where.judge, patterns), blank: missing.map(({ brief, arm }) => `${brief}/${arm}`) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
