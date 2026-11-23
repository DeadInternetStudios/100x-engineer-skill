import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError } from './errors.mjs';
import { collectChecks, collectStrings } from './page-checks.mjs';
import { INSTALL_HINT, resolvePlaywright } from './playwright.mjs';
import { sealFile } from './seal.mjs';
import { plural } from './text.mjs';

export const VIEWPORTS = {
  'phone-se': { w: 320, h: 568, dpr: 2 },
  'phone-small': { w: 360, h: 640, dpr: 2 },
  phone: { w: 390, h: 844, dpr: 3 },
  'phone-large': { w: 430, h: 932, dpr: 3 },
  'phone-landscape': { w: 844, h: 390, dpr: 3 },
  'phone-small-landscape': { w: 640, h: 360, dpr: 2 },
  'fold-narrow': { w: 280, h: 653, dpr: 3 },
  tablet: { w: 820, h: 1180, dpr: 2 },
  'tablet-landscape': { w: 1180, h: 820, dpr: 2 },
  'short-desktop': { w: 1024, h: 600, dpr: 1 },
  laptop: { w: 1280, h: 720, dpr: 1 },
  desktop: { w: 1440, h: 900, dpr: 1 },
  'desktop-hd': { w: 1920, h: 1080, dpr: 1 },
  'desktop-qhd': { w: 2560, h: 1440, dpr: 1 },
  ultrawide: { w: 3440, h: 1440, dpr: 1 },
};

export const MATRICES = {
  standard: ['phone', 'phone-small', 'phone-landscape', 'tablet', 'desktop', 'desktop-hd'],
  phone: ['phone-se', 'phone-small', 'phone', 'phone-large', 'phone-landscape', 'phone-small-landscape'],
  tablet: ['tablet', 'tablet-landscape'],
  desktop: ['short-desktop', 'laptop', 'desktop', 'desktop-hd', 'desktop-qhd', 'ultrawide'],
  all: Object.keys(VIEWPORTS),
  'all-rotate': Object.keys(VIEWPORTS),
};

const ORDER = { broken: 0, weak: 1, info: 2 };

// Overnight runs share a machine with other runs. At load average 35 on a 10 core machine, a 4 s limit
// made the same phone screenshot time out in 4 of 12 simultaneous test runs.
const ACTION_TIMEOUT_MS = 10000;
const SHOT_TIMEOUT_MS = 45000;

// An entrance animation that has not ticked yet reads as opacity 0 and transparent. With software rendering on a loaded
// machine the first frame can arrive hundreds of milliseconds late, so a fixed wait is not enough. Loops that never end
// are left alone. The cap keeps a page with one very long animation from stalling the run.
const SETTLE_CAP_MS = 2500;

// page.evaluate has no timeout of its own, and a page whose main thread stops answering would hold the whole run. One viewport gets this long in all.
// `options.viewportTimeoutMs` or the environment variable X100_VIEWPORT_TIMEOUT_MS (milliseconds) changes it.
const VIEWPORT_CAP_MS = 240000;

async function withDeadline(work, ms, handle, what) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} s and was stopped, because the page stopped answering`)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } catch (error) {
    // Closing the context ends the page, so the work that is still running settles and does not hold the browser.
    await handle.context?.close().catch(() => {});
    work.catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function settleAnimations(page) {
  await page
    .evaluate((cap) => new Promise((resolve) => {
      const deadline = Date.now() + cap;
      const unfinished = () => document.getAnimations().some((animation) => {
        if (animation.playState !== 'running' && animation.playState !== 'pending') return false;
        const timing = animation.effect && animation.effect.getComputedTiming ? animation.effect.getComputedTiming() : null;
        return timing !== null && Number.isFinite(timing.endTime) && timing.iterations !== Infinity;
      });
      const poll = () => (unfinished() && Date.now() < deadline ? setTimeout(poll, 40) : resolve());
      poll();
    }), SETTLE_CAP_MS)
    .catch(() => {});
}

export function parseViewports(list) {
  return list
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = /^(\d{2,5})x(\d{2,5})(?:@(\d+(?:\.\d+)?))?$/.exec(item);
      if (!match) throw new CliError(`Bad viewport "${item}". Use WIDTHxHEIGHT or WIDTHxHEIGHT@DPR, for example 390x844@3.`);
      return { name: 'custom', w: Number(match[1]), h: Number(match[2]), dpr: match[3] ? Number(match[3]) : 1 };
    });
}

export function viewportsFor(matrix) {
  const names = MATRICES[matrix];
  if (!names) throw new CliError(`Unknown matrix "${matrix}". Choose ${Object.keys(MATRICES).join(', ')}, or pass --viewports.`);
  return names.map((name) => ({ name, ...VIEWPORTS[name] }));
}

export function resolveTarget(target, cwd = process.cwd()) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return target;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(target)) return `http://${target}`;
  let file = path.resolve(cwd, target);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) throw new CliError(`${target} is not a URL and no such file exists.`);
  return pathToFileURL(file).href;
}

export function parseSteps(value) {
  if (!value) return [];
  const inline = /^\s*[[{]/.test(value);
  if (!inline && !fs.existsSync(value)) throw new CliError(`Steps file ${value} does not exist. Pass a JSON file or an inline JSON array.`);
  const text = inline ? value : fs.readFileSync(value, 'utf8');
  let steps;
  try {
    steps = JSON.parse(text);
  } catch (error) {
    throw new CliError(`Steps are not valid JSON. ${error.message}`);
  }
  if (!Array.isArray(steps)) throw new CliError('Steps must be a JSON array of objects such as {"click":"text=Start"}.');
  return steps;
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'state';

async function runStep(page, step, context) {
  const [key] = Object.keys(step);
  const value = step[key];
  switch (key) {
    case 'goto':
      await page.goto(new URL(value, context.target).href, { waitUntil: 'load', timeout: context.timeoutMs });
      break;
    case 'click':
      await page.click(value);
      break;
    case 'tap':
      if (context.touch) await page.tap(value);
      else await page.click(value);
      break;
    case 'dblclick':
      await page.dblclick(value);
      break;
    case 'hover':
      await page.hover(value);
      break;
    case 'fill':
      await page.fill(value[0], String(value[1]));
      break;
    case 'press':
      await page.keyboard.press(value);
      break;
    case 'type':
      await page.keyboard.type(String(value), { delay: 20 });
      break;
    case 'wait':
      await page.waitForTimeout(Number(value));
      break;
    case 'waitFor':
      await page.waitForSelector(value, { timeout: 8000 });
      break;
    case 'scroll':
      await page.evaluate((to) => window.scrollTo(0, to === 'bottom' ? document.documentElement.scrollHeight : to === 'top' ? 0 : Number(to)), value);
      break;
    case 'eval':
      await page.evaluate(value);
      break;
    case 'viewport': {
      const [width, height] = String(value).split('x').map(Number);
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400);
      break;
    }
    case 'shot':
      return String(value);
    default:
      throw new Error(`unknown step "${key}"`);
  }
  return null;
}

// The named desktop sizes are never emulated as a touch screen, whatever their height. Any other size is touch when its short side is 820 px or less.
const DESKTOP_SIZES = new Set(['short-desktop', 'laptop', 'desktop', 'desktop-hd', 'desktop-qhd', 'ultrawide']);
export const isTouch = (viewport) => !DESKTOP_SIZES.has(viewport.name) && Math.min(viewport.w, viewport.h) <= 820;

// The context is closed on every way out, so a viewport that throws or is cut off by its deadline leaves no page running beside the next ones.
async function runViewport(browser, viewport, options, handle = {}) {
  const touch = isTouch(viewport);
  const context = await browser.newContext({
    viewport: { width: viewport.w, height: viewport.h },
    deviceScaleFactor: viewport.dpr,
    isMobile: touch,
    hasTouch: touch,
  });
  handle.context = context;
  try {
    return await shootViewport(context, viewport, touch, options);
  } finally {
    await context.close().catch(() => {});
  }
}

async function shootViewport(context, viewport, touch, options) {
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  const buffer = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !/^Failed to load resource/.test(text)) buffer.push({ kind: 'console.error', text: text.slice(0, 240) });
  });
  page.on('pageerror', (error) => buffer.push({ kind: 'pageerror', text: String(error.message).slice(0, 240) }));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? '';
    if (!/ERR_ABORTED/.test(failure)) buffer.push({ kind: 'requestfailed', text: `${request.url().slice(0, 160)} ${failure}`.trim() });
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !/favicon\.ico/.test(response.url())) buffer.push({ kind: `http ${response.status()}`, text: response.url().slice(0, 160) });
  });
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  if (options.initScript) await context.addInitScript({ content: options.initScript });

  const id = `${viewport.name}-${viewport.w}x${viewport.h}-${viewport.dpr}x`;
  const record = { id, name: viewport.name, width: viewport.w, height: viewport.h, dpr: viewport.dpr, touch, states: [] };

  // Two states with one name would write the same screenshot twice. The second gets a number.
  const taken = new Set();
  const unique = (name) => {
    let candidate = name;
    for (let n = 2; taken.has(slug(candidate)); n += 1) candidate = `${name}-${n}`;
    taken.add(slug(candidate));
    return candidate;
  };

  const snap = async (rawName, extra = [], { measure = true } = {}) => {
    const stateName = unique(rawName);
    const file = `${id}__${slug(stateName)}.png`;
    let page_ = { findings: [], examined: {} };
    await settleAnimations(page);
    if (options.checks && measure) {
      page_ = await page.evaluate(collectChecks, { touch, minTap: touch ? 44 : 0, minFont: touch ? 12 : 11, deviceWidth: page.viewportSize().width });
      for (const text of await page.evaluate(collectStrings).catch(() => [])) options.texts?.add(text);
    }
    const events = buffer.splice(0).filter(() => measure).map((event) => ({ check: 'console', severity: 'broken', sel: '', text: '', detail: `${event.kind}. ${event.text}` }));
    const cut = await screenshotTo(page, path.join(options.outDir, file), { fullPage: options.fullPage, dpr: viewport.dpr });
    const tall = cut ? [{ check: 'tallPage', severity: 'info', sel: '', text: '', detail: `the page is ${cut.height} px tall and a picture holds at most ${MAX_SHOT_PIXELS} device pixels, so the full-page shot stops at ${cut.limit} px. Scroll with --steps to shoot the rest` }] : [];
    const findings = [...extra, ...events, ...page_.findings, ...tall].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    const counts = { broken: 0, weak: 0, info: 0 };
    for (const finding of findings) counts[finding.severity] += finding.count ?? 1;
    record.states.push({ name: stateName, shot: file, counts, findings, examined: page_.examined, size: page_.viewport });
  };

  try {
    await page.goto(options.url, { waitUntil: 'load', timeout: options.timeoutMs });
  } catch (error) {
    await snap('initial', [{ check: 'navigation', severity: 'broken', sel: '', text: '', detail: `could not open ${options.url}. ${error.message.split('\n')[0]}` }], { measure: false });
    return record;
  }
  if (options.waitFor) {
    if (/^\d+$/.test(options.waitFor)) await page.waitForTimeout(Number(options.waitFor));
    else await page.waitForSelector(options.waitFor, { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(options.settleMs);
  await snap('initial');

  const stepContext = { target: options.url, timeoutMs: options.timeoutMs, touch };
  for (const [index, step] of options.steps.entries()) {
    try {
      const shot = await runStep(page, step, stepContext);
      if (shot) {
        await page.waitForTimeout(options.settleMs / 2);
        await snap(shot);
      }
    } catch (error) {
      const label = JSON.stringify(step);
      await snap(`step-${index + 1}-failed`, [{ check: 'stepFailed', severity: 'broken', sel: '', text: '', detail: `step ${label} failed. ${error.message.split('\n')[0]}` }]);
      break;
    }
  }
  if (options.resizeTest) {
    await page.setViewportSize({ width: viewport.h, height: viewport.w });
    await page.waitForTimeout(500);
    await snap(`rotated-${viewport.h}x${viewport.w}`);
  }
  return record;
}

// The first full-page capture of a very tall page can fail in the software renderer with "Unable to capture screenshot", and the
// same capture a moment later works. That used to count as a broken viewport. Try again, and only when it still fails cut the
// picture at this many device pixels and say so.
const MAX_SHOT_PIXELS = 16000;
const NO_CAPTURE = /Unable to capture screenshot/;

export async function screenshotTo(page, file, { fullPage, dpr }) {
  const shot = { path: file, fullPage, timeout: SHOT_TIMEOUT_MS };
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.screenshot(shot);
      return null;
    } catch (error) {
      if (!fullPage || !NO_CAPTURE.test(error.message)) throw error;
      if (attempt >= 2) break;
      await page.waitForTimeout(500);
    }
  }
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const limit = Math.floor(MAX_SHOT_PIXELS / dpr);
  await page.screenshot({ ...shot, clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(height, limit) } });
  return { height, limit };
}

// One viewport that crashes or times out is a broken finding for that viewport. It must not throw away the others.
function failedViewport(viewport, error) {
  const id = `${viewport.name}-${viewport.w}x${viewport.h}-${viewport.dpr}x`;
  const finding = { check: 'viewportFailed', severity: 'broken', sel: '', text: '', detail: `this viewport could not be checked. ${error.message.split('\n')[0]}` };
  const touch = isTouch(viewport);
  const state = { name: 'failed', shot: null, counts: { broken: 1, weak: 0, info: 0 }, findings: [finding], examined: {} };
  return { id, name: viewport.name, width: viewport.w, height: viewport.h, dpr: viewport.dpr, touch, states: [state] };
}

export function summarize(result) {
  const totals = { broken: 0, weak: 0, info: 0 };
  const byCheck = {};
  let examined = 0;
  let states = 0;
  for (const viewport of result.viewports) {
    for (const state of viewport.states) {
      states += 1;
      examined += state.examined?.elements ?? 0;
      for (const finding of state.findings) {
        totals[finding.severity] += finding.count ?? 1;
        const key = `${finding.severity}:${finding.check}`;
        byCheck[key] = (byCheck[key] ?? 0) + (finding.count ?? 1);
      }
    }
  }
  return { totals, byCheck, states, examined };
}

// A page opened from a file cannot load its own scripts, fonts or data, and the browser says so in the console as a CORS error.
// The fix is not in the page, so the report says so once instead of leaving the agent to read six lines of CORS.
export function fileHint(result) {
  if (!result.target.startsWith('file:')) return null;
  const blocked = result.viewports.some((viewport) => viewport.states.some((state) => state.findings.some((finding) => /from origin 'null'/.test(finding.detail ?? ''))));
  return blocked ? 'The page was opened from a file, and a browser does not let a file load its own scripts, fonts or data. Serve the folder (the project\'s own dev server, or `python3 -m http.server` inside it) and shoot that address.' : null;
}

function markdown(result) {
  const { totals, byCheck, states, examined } = result.summary;
  const lines = [
    '# Resolution matrix',
    '',
    `Target ${result.target}. Matrix ${result.matrix}. ${result.startedAt}.`,
    `Totals. broken ${totals.broken}, weak ${totals.weak}, info ${totals.info}. Looked at ${examined} elements over ${states} states in ${result.viewports.length} viewports.`,
    ...(result.hint ? ['', `Note. ${result.hint}`] : []),
    '',
    '| Viewport | State | Broken | Weak | Info | Screenshot |',
    '|---|---|---|---|---|---|',
  ];
  for (const viewport of result.viewports) {
    for (const state of viewport.states) lines.push(`| ${viewport.id} | ${state.name} | ${state.counts.broken} | ${state.counts.weak} | ${state.counts.info} | ${state.shot ?? 'none'} |`);
  }
  for (const severity of ['broken', 'weak', 'info']) {
    const rows = [];
    let elements = 0;
    for (const viewport of result.viewports) {
      for (const state of viewport.states) {
        for (const finding of state.findings.filter((f) => f.severity === severity)) {
          elements += finding.count ?? 1;
          rows.push(`- ${viewport.id} / ${state.name} / ${finding.check}${finding.sel ? ` / \`${finding.sel}\`` : ''}${finding.text ? ` "${finding.text}"` : ''}. ${finding.detail}`);
        }
      }
    }
    lines.push('', `## ${severity[0].toUpperCase()}${severity.slice(1)} (${elements})`, '');
    lines.push(...(rows.length ? rows.slice(0, 80) : ['None.']));
    if (rows.length > 80) lines.push(`- ${rows.length - 80} more in matrix.json`);
  }
  lines.push('', '## By check', '', ...Object.entries(byCheck).sort().map(([key, count]) => `- ${key.replace(':', ' ')} ${count}`));
  return `${lines.join('\n')}\n`;
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The sheet is for a person, so a size is named the way they say it, with its pixels after it.
const SIZE_WORDS = {
  'phone-se': 'Small phone',
  'phone-small': 'Phone, small',
  phone: 'Phone',
  'phone-large': 'Large phone',
  'phone-landscape': 'Phone on its side',
  'phone-small-landscape': 'Small phone on its side',
  'fold-narrow': 'Folded phone',
  tablet: 'Tablet',
  'tablet-landscape': 'Tablet on its side',
  'short-desktop': 'Short laptop screen',
  laptop: 'Laptop',
  desktop: 'Desktop',
  'desktop-hd': 'Large desktop',
  'desktop-qhd': 'Very large desktop',
  ultrawide: 'Ultrawide screen',
};
const sizeWords = (viewport) => `${SIZE_WORDS[viewport.name] ?? 'Custom size'}, ${viewport.width} by ${viewport.height}`;
const stateWords = (name) => (name === 'initial' ? 'first screen' : name.replace(/[-_]+/g, ' '));

const SHEET_STYLE = `:root{color-scheme:light dark;--bg:#f4f1ea;--panel:#fffdf8;--ink:#1b1a17;--muted:#645f55;--line:#ddd7c9;--bad:#a3281f}
@media (prefers-color-scheme:dark){:root{--bg:#121110;--panel:#1b1a18;--ink:#f1eee6;--muted:#a8a294;--line:#2d2b27;--bad:#ff9d94}}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}
h1{font:700 1.5rem/1.2 ui-serif,Georgia,"Times New Roman",serif;margin:0 0 4px}
.target,.sum{margin:0;color:var(--muted);font-size:.875rem}
.sum{margin:4px 0 20px}
main{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr));align-items:start}
figure{margin:0;min-width:0}
figure a{display:block}
img{display:block;width:100%;height:auto;max-height:80vh;object-fit:contain;background:var(--panel);border:1px solid var(--line);border-radius:0}
figcaption{padding-top:6px;color:var(--muted);font-size:.875rem}
figcaption strong{color:var(--ink)}
.bad{color:var(--bad);font-weight:700}
a{color:inherit}
a:focus-visible{outline:3px solid var(--ink);outline-offset:2px}`;

function contactSheet(result) {
  const shots = result.viewports.flatMap((viewport) => viewport.states.filter((state) => state.shot).map((state) => ({ viewport, state })));
  const count = (key) => result.viewports.reduce((sum, viewport) => sum + viewport.states.reduce((inner, state) => inner + state.counts[key], 0), 0);
  const cards = shots
    .map(({ viewport, state }) => {
      const words = `${sizeWords(viewport)}, ${stateWords(state.name)}`;
      const counts = `<span${state.counts.broken ? ' class="bad"' : ''}>${state.counts.broken} broken</span>, ${state.counts.weak} weak`;
      return `<figure><a href="${escapeHtml(state.shot)}"><img src="${escapeHtml(state.shot)}" alt="${escapeHtml(words)}" loading="lazy"></a><figcaption><strong>${escapeHtml(sizeWords(viewport))}</strong><br>${escapeHtml(stateWords(state.name))}. ${counts}</figcaption></figure>`;
    })
    .join('\n');
  const states = new Set(shots.map(({ state }) => state.name)).size;
  const lost = result.viewports.filter((viewport) => !viewport.states.some((state) => state.shot)).length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screen sizes</title>
<style>${SHEET_STYLE}</style>
</head>
<body>
<h1>Screen sizes</h1>
<p class="target" title="${escapeHtml(result.target)}">${escapeHtml(result.target)}</p>
<p class="sum">${count('broken')} broken, ${count('weak')} weak, across ${plural(result.viewports.length, 'size')} and ${plural(states, 'state')}.${lost ? ` ${plural(lost, 'size')} could not be opened, so ${lost === 1 ? 'it has' : 'they have'} no picture.` : ''} Open a picture to see it full size.</p>
<main>${cards}</main>
</body>
</html>
`;
}

async function renderSheetPng(browser, outDir) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(outDir, 'contact-sheet.html')).href, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((img) => {
      img.loading = 'eager';
      return img.decode().catch(() => {});
    })));
    await page.screenshot({ path: path.join(outDir, 'contact-sheet.png'), fullPage: true });
  } finally {
    await context.close();
  }
}

export async function runMatrix(options) {
  const found = resolvePlaywright(options.cwd ?? process.cwd());
  if (!found) throw new CliError(`Playwright is not installed anywhere 100x can see. ${INSTALL_HINT}`);
  fs.mkdirSync(options.outDir, { recursive: true });
  const started = Date.now();
  const browser = await found.playwright.chromium.launch({
    headless: true,
    args: ['--mute-audio', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'].filter((arg) => options.sound !== true || arg !== '--mute-audio'),
  });
  const result = { tool: '100x shots', target: options.url, matrix: options.matrixName, startedAt: new Date(started).toISOString(), viewports: [] };
  // Every string the page showed in any viewport or state, once, so the copy can be linted with `100x text lint`.
  const texts = new Set();
  const withTexts = { ...options, texts };
  try {
    for (const viewport of options.viewports) {
      const handle = {};
      const work = runViewport(browser, viewport, withTexts, handle);
      result.viewports.push(await withDeadline(work, options.viewportTimeoutMs ?? (Number(process.env.X100_VIEWPORT_TIMEOUT_MS) || VIEWPORT_CAP_MS), handle, `the ${viewport.name} size`).catch((error) => failedViewport(viewport, error)));
    }
    fs.writeFileSync(path.join(options.outDir, 'contact-sheet.html'), contactSheet(result));
    await renderSheetPng(browser, options.outDir).catch(() => {});
  } finally {
    await browser.close();
  }
  result.durationMs = Date.now() - started;
  result.summary = summarize(result);
  result.hint = fileHint(result);
  if (texts.size) {
    fs.writeFileSync(path.join(options.outDir, 'texts.txt'), `${[...texts].join('\n')}\n`);
    result.strings = texts.size;
  }
  const matrixFile = path.join(options.outDir, 'matrix.json');
  fs.writeFileSync(matrixFile, `${JSON.stringify(result, null, 2)}\n`);
  sealFile(matrixFile);
  fs.writeFileSync(path.join(options.outDir, 'matrix.md'), markdown(result));
  return result;
}
