import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.mjs';

// Everything that starts, finds, signals or opens a process in a way that differs between macOS, Linux and Windows lives here,
// so the commands read the same on all three.
export const isWindows = process.platform === 'win32';

const cmdQuote = (arg) => `"${String(arg).replaceAll('"', '""')}"`;

// Node refuses to start a .cmd or .bat file without a shell (and npm is npm.cmd on Windows), so those go through cmd.exe, quoted as one line.
const needsCmd = (command) => isWindows && (/\.(cmd|bat)$/i.test(command) || ['npm', 'npx'].includes(command.toLowerCase()));

function invocation(command, args, options) {
  if (!needsCmd(command)) return [command, args, options];
  // A bare name such as npm stays unquoted, so cmd finds it on PATH and the script's own %~dp0 is the folder it was found in. A path is quoted.
  const head = /^[\w.-]+$/.test(command) ? command : cmdQuote(command);
  const line = `"${[head, ...args.map(cmdQuote)].join(' ')}"`;
  return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { ...options, windowsVerbatimArguments: true }];
}

export function runProgram(command, args = [], options = {}) {
  const [file, argv, opts] = invocation(command, args, { windowsHide: true, ...options });
  return spawnSync(file, argv, opts);
}

// A POSIX shell. The commands the owner sets for a judge or a prototype are written for sh, with $VARIABLES, and on Windows the one
// that Git for Windows ships (Claude Code and Cursor need Git there too) runs them the same way. X100_SH names another one.
let foundSh;
export function findSh() {
  if (foundSh !== undefined) return foundSh;
  foundSh = null;
  if (process.env.X100_SH && fs.existsSync(process.env.X100_SH)) foundSh = process.env.X100_SH;
  else if (!isWindows) foundSh = 'sh';
  else {
    // An sh.exe on PATH wins. Otherwise the Git for Windows folders are tried, from git.exe on PATH (C:\Program Files\Git\cmd is one folder under the Git root) and from the usual places.
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const roots = new Set(dirs.filter((dir) => fs.existsSync(path.join(dir, 'git.exe'))).map((dir) => path.dirname(dir)));
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) if (base) roots.add(path.join(base, 'Git'));
    const candidates = [...dirs.map((dir) => path.join(dir, 'sh.exe')), ...[...roots].flatMap((root) => [path.join(root, 'usr', 'bin', 'sh.exe'), path.join(root, 'bin', 'sh.exe')])];
    foundSh = candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }
  return foundSh;
}

export const NO_SH = 'This command is written for a POSIX shell, and none was found. Install Git for Windows (it includes sh), or set X100_SH to the path of an sh.exe.';

// The program and arguments that run one command line the way sh -c does. Without sh on Windows, cmd.exe runs it, which understands %VAR% and not $VAR.
export function shellInvocation(script, { requireSh = false } = {}) {
  const sh = findSh();
  if (sh) return { file: sh, args: ['-c', script], options: {} };
  if (requireSh) throw new CliError(NO_SH);
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', script], options: { windowsVerbatimArguments: true } };
}

export function spawnShell(script, options = {}, { requireSh = false } = {}) {
  const { file, args, options: extra } = shellInvocation(script, { requireSh });
  return spawn(file, args, { windowsHide: true, ...extra, ...options, ...(isWindows && file !== (process.env.ComSpec || 'cmd.exe') ? { env: withToolsOnPath(options.env ?? process.env, path.dirname(file)) } : {}) });
}

// sh.exe started from outside Git Bash does not put Git's own tools (sleep, cat, mkdir) on the PATH of the commands it runs. Its folder goes first.
function withToolsOnPath(env, dir) {
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  const current = env[key] ?? '';
  if (current.split(path.delimiter).some((entry) => entry.toLowerCase() === dir.toLowerCase())) return env;
  return { ...env, [key]: `${dir}${path.delimiter}${current}` };
}

// A log file a child writes to for as long as it runs. A handle opened for append on Windows lets only native programs write, and a child
// started by sh (an MSYS program) loses its output, so there the file is opened for writing and moved to its end, which is the same place.
export function openLog(file) {
  if (!isWindows) return fs.openSync(file, 'a');
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return fs.openSync(file, 'w');
  }
  // A log from an earlier run that grew past a megabyte is started over instead of read through.
  if (size > 1 << 20) return fs.openSync(file, 'w');
  const fd = fs.openSync(file, 'r+');
  const chunk = Buffer.alloc(65536);
  while (fs.readSync(fd, chunk, 0, chunk.length, null) > 0);
  return fd;
}

// Windows has no process groups to signal. taskkill /T ends a process and everything it started.
export function killTree(pid) {
  if (isWindows) return spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).status === 0;
  try {
    process.kill(-pid, 'SIGTERM');
    return true;
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
      return true;
    } catch {
      return false;
    }
  }
}

const powershell = (script) => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  return result.status === 0 ? result.stdout.trim() : null;
};

// When a process started, as a string that stays the same for the life of that process. null when the system cannot say.
export function processStart(pid) {
  if (isWindows) return powershell(`(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`) || null;
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

// The command line of a running process, or null.
export function processCommand(pid) {
  if (isWindows) return powershell(`(Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}' -ErrorAction Stop).CommandLine`) || null;
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

// Open a file or an address in the program the system picks for it.
export function openTarget(target) {
  const [file, args] = process.platform === 'darwin' ? ['open', [target]] : isWindows ? ['rundll32.exe', ['url.dll,FileProtocolHandler', target]] : ['xdg-open', [target]];
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}
