import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildStamp } from './build-stamp.mjs';
import { esc, renderGallery, startableAddress, THEME, windowWords } from './gallery.mjs';
import { inProgress } from './in-progress.mjs';
import { galleryFile, globalDir } from './paths.mjs';
import { countLeftOut, readRegistry, select } from './registry.mjs';
import { killTree, openLog, processCommand, spawnShell } from './proc.mjs';
import { refreshReports } from './report-refresh.mjs';
import { runDir } from './run-dir.mjs';

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.tsv': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.js': 'text/javascript',
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connects(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

export async function listening(port) {
  return (await connects(port, '127.0.0.1')) || (await connects(port, '::1'));
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export const infoFile = () => path.join(globalDir(), 'morning', 'server.json');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A pid in server.json can outlive the server and be handed to some other program. Signal it only when its command
// line says it is this gallery server, started as `100x morning --serve` or `100x.mjs morning --serve`.
const SERVER_COMMAND = /(?:^|[\s/\\])100x(?:\.mjs)?"?\s+morning\s.*--serve/;

function isGalleryServer(pid) {
  const command = processCommand(pid);
  return command !== null && SERVER_COMMAND.test(command);
}

export function readInfo() {
  try {
    const info = JSON.parse(fs.readFileSync(infoFile(), 'utf8'));
    return alive(info.pid) && isGalleryServer(info.pid) ? info : null;
  } catch {
    return null;
  }
}

export async function stopServer(info) {
  // Windows ends a process the moment it is signalled, so the server never gets to stop its prototypes. Ending the tree stops them too.
  if (process.platform === 'win32') killTree(info.pid);
  else process.kill(info.pid, 'SIGTERM');
  fs.rmSync(infoFile(), { force: true });
  for (let waited = 0; waited < 3000 && alive(info.pid); waited += 100) await delay(100);
}

// A server keeps the code it started with, so one started from other files than the ones on disk now serves the old page. A server from
// before the stamp existed has none and counts as old. Stopping it also stops the prototypes it started, so the answer says how many.
export async function staleness(info) {
  if (info.build === buildStamp()) return null;
  let running = 0;
  try {
    const answer = await fetch(`${info.url}api/status`, { signal: AbortSignal.timeout(1500) });
    running = Object.values(await answer.json()).filter((held) => held.running).length;
  } catch {
    // It does not answer, so nothing it started can be reached through it.
  }
  return { running };
}

export function createController() {
  const children = new Map();

  async function run(id) {
    const entry = readRegistry().find((candidate) => candidate.id === id);
    if (!entry) return { ok: false, status: 404, error: 'unknown run' };
    if (!fs.existsSync(entry.path)) return { ok: false, status: 410, error: `the project folder is gone, ${entry.path}` };
    const existing = children.get(id);
    if (existing && existing.child.exitCode === null) return { ok: true, url: existing.url };
    // A file or an address online has no port here to wait for, so starting it would only run the command and report a clean exit as a failure.
    if (entry.url && !startableAddress(entry.url)) return { ok: false, status: 422, error: 'its address is not a server on this machine, so the page cannot start it' };

    let url = entry.url;
    let command = entry.runCmd;
    let port = entry.url ? Number(new URL(entry.url).port) || (new URL(entry.url).protocol === 'https:' ? 443 : 80) : null;
    if (entry.portFlag) {
      port = await freePort();
      command = `${entry.runCmd} ${entry.portFlag.replace('{port}', String(port))}`;
      const next = entry.url ? new URL(entry.url) : new URL('http://localhost');
      next.port = String(port);
      url = next.href;
    } else if (port && (await listening(port))) {
      // Something already answers at this address. It may be this run started another way, or a different prototype that took the same
      // port, and the page cannot tell which. So it says it did not start this run, and what answers there is the owner's to open.
      const holder = [...children].find(([otherId, held]) => otherId !== id && held.port === port && held.child.exitCode === null);
      const holderTitle = holder && readRegistry().find((candidate) => candidate.id === holder[0])?.title;
      return holderTitle
        ? { ok: false, status: 409, error: `${holderTitle}, which this page started, is already running at ${url}. Stop it to run ${entry.title}.` }
        : { ok: false, status: 409, error: `Something is already running at ${url}, so this page did not start ${entry.title}. Open it only if that is ${entry.title}.`, openAnyway: url };
    }

    const logFile = path.join(entry.path, '.100x', 'dev.log');
    // The card links the log through the served files, when this run's folder is the one that holds it.
    const log = runDir(entry) === path.dirname(logFile) ? `file/${id}/dev.log` : undefined;
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const fd = openLog(logFile);
    const child = spawnShell(command, {
      cwd: entry.path,
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, ...(port ? { PORT: String(port) } : {}), BROWSER: 'none', NO_COLOR: '1' },
    });
    fs.closeSync(fd);
    children.set(id, { child, url, port });
    child.once('exit', () => children.delete(id));
    child.unref();

    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) return { ok: false, status: 500, error: `the run command exited with code ${child.exitCode}. See ${logFile}`, log };
      if (!port || (await listening(port))) return { ok: true, url };
      await delay(250);
    }
    return { ok: false, status: 504, error: `nothing listened on port ${port} within 45 seconds. See ${logFile}`, log };
  }

  function stop(id) {
    const held = children.get(id);
    if (!held) return false;
    if (!killTree(held.child.pid)) {
      try {
        held.child.kill('SIGTERM');
      } catch {
        // already gone
      }
    }
    children.delete(id);
    return true;
  }

  const stopAll = () => [...children.keys()].forEach(stop);
  const status = () => Object.fromEntries([...children].map(([id, held]) => [id, { running: held.child.exitCode === null, url: held.url }]));
  return { run, stop, stopAll, status };
}

// What an old link says. Every restart makes a new address, so a link kept from before leads here, and the page says what to do about it.
const EXPIRED = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This link has expired</title>
<style>${THEME}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:40rem;margin:0 auto;padding:48px 24px}
h1{font:700 2rem/1.1 ui-serif,Georgia,serif;margin:0 0 12px}
code{font:.875rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--panel);border:1px solid var(--line);border-radius:0;padding:2px 8px}
</style>
</head>
<body><main><h1>This link has expired.</h1><p>Call <code>100x-report</code> and you get a new one.</p></main></body>
</html>
`;

const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
};

export async function startServer({ port = 0, hours, all = false } = {}) {
  const token = crypto.randomBytes(12).toString('hex');
  const controller = createController();
  const prefix = `/t/${token}/`;

  const server = http.createServer(async (req, res) => {
    try {
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host ?? '')) return send(res, 403, 'forbidden host');
      const url = new URL(req.url, 'http://local');
      if (url.pathname === prefix.slice(0, -1)) {
        res.writeHead(302, { Location: prefix });
        return res.end();
      }
      if (!url.pathname.startsWith(prefix)) return send(res, 404, EXPIRED, 'text/html; charset=utf-8');
      const route = decodeURIComponent(url.pathname.slice(prefix.length));

      if (req.method === 'GET' && route === '') {
        // The empty page offers every run with ?all=1, so a quiet window is never a dead end.
        const everything = all || !hours || url.searchParams.get('all') === '1';
        const entries = select({ sinceHours: hours, all: everything });
        refreshReports(entries);
        const nothingOlder = everything || (!entries.length && !select({ all: true }).length);
        return send(res, 200, renderGallery(entries, { mode: 'serve', windowLabel: windowWords(hours, everything), all: nothingOlder, leftOut: countLeftOut({ sinceHours: hours, all: everything }), inProgress: inProgress({ sinceHours: hours, all: everything }) }), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && route === 'api/status') return send(res, 200, JSON.stringify(controller.status()), 'application/json');
      if (req.method === 'GET' && route.startsWith('file/')) {
        const [, id, ...rest] = route.split('/');
        const entry = readRegistry().find((candidate) => candidate.id === id);
        if (!entry) return send(res, 404, 'unknown run');
        const base = runDir(entry);
        const target = path.resolve(base, rest.join('/'));
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return send(res, 404, 'not found');
        const real = fs.realpathSync(target);
        if (!real.startsWith(fs.realpathSync(base) + path.sep)) return send(res, 403, 'outside the run folder');
        const content = fs.readFileSync(real);
        // A report links back to the page that lists every run, by the address of that file. Served, the same page is two folders up.
        if (path.basename(real) === 'REPORT.html') return send(res, 200, content.toString('utf8').replaceAll(`href="${esc(pathToFileURL(galleryFile()).href)}"`, 'href="../../"'), TYPES['.html']);
        return send(res, 200, content, TYPES[path.extname(real).toLowerCase()] ?? 'application/octet-stream');
      }
      if (req.method === 'POST' && route.startsWith('api/')) {
        if (req.headers['x-100x'] !== '1') return send(res, 403, 'missing header');
        const [, action, id] = route.split('/');
        if (action === 'run') {
          const result = await controller.run(id);
          return send(res, result.ok ? 200 : result.status, JSON.stringify(result), 'application/json');
        }
        if (action === 'stop') return send(res, 200, JSON.stringify({ ok: controller.stop(id) }), 'application/json');
      }
      return send(res, 404, 'not found');
    } catch (error) {
      return send(res, 500, String(error.message));
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;
  return {
    server,
    port: actual,
    token,
    url: `http://127.0.0.1:${actual}${prefix}`,
    controller,
    close: () =>
      new Promise((resolve) => {
        controller.stopAll();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
