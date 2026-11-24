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
  const line = `"${[command, ...args].map(cmdQuote).join(' ')}"`;
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
    const roots = new Set();
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      if (!dir) continue;
      // C:\Program Files\Git\cmd and C:\Program Files\Git\bin both sit one folder under the Git root.
      if (fs.existsSync(path.join(dir, 'git.exe'))) roots.add(path.dirname(dir));
      for (const name of ['sh.exe']) if (fs.existsSync(path.join(dir, name)) && !/system32/i.test(dir)) foundSh = foundSh ?? path.join(dir, name);
    }
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) if (base) roots.add(path.join(base, 'Git'));
    for (const root of roots) {
      for (const rel of [['usr', 'bin', 'sh.exe'], ['bin', 'sh.exe']]) {
        const candidate = path.join(root, ...rel);
        if (!foundSh && fs.existsSync(candidate)) foundSh = candidate;
      }
    }
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
  return spawn(file, args, { windowsHide: true, ...extra, ...options });
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
