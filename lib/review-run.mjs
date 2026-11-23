import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkCommand, helperTarget } from './delegate.mjs';
import { CliError } from './errors.mjs';
import { briefFile, findingsFile, loopAskFile, loopFindingsFile, loopTask, reviewDir, reviewTask, checkLoopName } from './review.mjs';
import { plannedRounds, roundStatus } from './rounds.mjs';

const file = (root, name) => path.join(reviewDir(root), name);
const optionName = (id) => `X100_OPT_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

function taskPlan(root, config) {
  const total = plannedRounds(root, config.review);
  const status = roundStatus(root, total);
  return { slot: status.slot ?? total, total, lens: status.lens ?? 'ship' };
}

// The judge as a shell command, so any agent app that has a command line can be the judge. The command reads its settings from
// environment variables, which keeps model names and the task text out of shell quoting.
export function reviewEnv(root, config, { fallback = false, loop = null } = {}) {
  // The command is started with this model and window in its variables, so a target the owner's limits refuse is refused before anything is spawned.
  const target = helperTarget(config, fallback ? 'fallback' : 'review', fallback ? 'fallback judge' : 'judge');
  if (fallback && !target) throw new CliError('No backup judge is set. Set one with `100x config role fallback --model <id> --global`.');
  if (loop) checkLoopName(root, loop);
  const options = target?.options ?? {};
  return {
    X100_MODEL: target?.model ?? '',
    X100_PROVIDER: target?.providerInstanceId ?? '',
    X100_EFFORT: String(options.effort ?? options.reasoning_effort ?? ''),
    ...Object.fromEntries(Object.entries(options).map(([id, value]) => [optionName(id), String(value)])),
    X100_TASK: loop ? loopTask(root, loop) : reviewTask(root, taskPlan(root, config)),
    X100_BRIEF: loop ? loopAskFile(root, loop) : briefFile(root),
    X100_FINDINGS: loop ? loopFindingsFile(root, loop) : findingsFile(root),
    X100_ROOT: root,
    X100_EXIT_FILE: file(root, 'run.exit'),
  };
}

// When a process started, as ps prints it. A pid alone is reused after a reboot or a kill, so the record keeps this beside it.
// null when ps cannot say, and then only the pid is checked.
export const processStart = (pid) => {
  try {
    const text = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return text || null;
  } catch {
    return null;
  }
};

// The judge is started by this user, so a process this user cannot signal is not the judge (EPERM). A live pid whose start time differs from the record's is another process that reused the number.
const alive = (record) => {
  try {
    process.kill(record.pid, 0);
  } catch {
    return false;
  }
  return !record.procStart || processStart(record.pid) === record.procStart;
};

const readRecord = (root) => {
  try {
    return JSON.parse(fs.readFileSync(file(root, 'run.json'), 'utf8'));
  } catch {
    return null;
  }
};

export function reviewStatus(root, now = Date.now()) {
  const record = readRecord(root);
  if (!record) return { state: 'none' };
  const out = { pid: record.pid, model: record.model, startedAt: record.startedAt, minutes: Math.round((now - Date.parse(record.startedAt)) / 60000) };
  const findings = findingsFile(root);
  out.findingsBytes = fs.existsSync(findings) ? fs.statSync(findings).size : 0;
  if (record.stopped) return { ...out, state: 'stopped' };
  if (fs.existsSync(file(root, 'run.exit'))) return { ...out, state: 'exited', code: Number(fs.readFileSync(file(root, 'run.exit'), 'utf8')) };
  if (alive(record)) return { ...out, state: 'running' };
  return { ...out, state: 'died', note: 'the process is gone and left no exit code' };
}

export function startReview(root, config, { fallback = false, loop = null } = {}) {
  const command = config.review.command;
  if (!command) throw new CliError('No judge command is set. Set one in the global config, `100x config set review.command "<command>" --global`, or use your agent app\'s own subagent tool. The 100x-setup skill shows the commands.');
  if (reviewStatus(root).state === 'running') throw new CliError('A judge is already running. Check it with `100x review-run --status`, or end it with `100x review-run --stop`.');
  const env = reviewEnv(root, config, { fallback, loop });
  checkCommand(command, config.review.provider, fallback ? 'fallback judge' : 'judge', { only: config.helper?.only ?? null });
  fs.mkdirSync(reviewDir(root), { recursive: true });
  fs.rmSync(file(root, 'run.exit'), { force: true });
  const log = fs.openSync(file(root, 'run.log'), 'a');
  const script = `${command}\nstatus=$?\nprintf '%s' "$status" > "$X100_EXIT_FILE"\nexit $status`;
  const child = spawn('sh', ['-c', script], { cwd: root, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', log, log] });
  child.on('error', () => {});
  child.unref();
  fs.closeSync(log);
  const record = { pid: child.pid, procStart: processStart(child.pid), startedAt: new Date().toISOString(), model: env.X100_MODEL, role: fallback ? 'fallback' : 'review' };
  fs.writeFileSync(file(root, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, log: file(root, 'run.log'), findings: env.X100_FINDINGS };
}

export function stopReview(root) {
  const record = readRecord(root);
  if (!record) return { state: 'none' };
  // Only a judge that is still the process this record names is signalled. A pid that was reused, or a judge that already exited, is left alone.
  if (!record.stopped && !fs.existsSync(file(root, 'run.exit')) && alive(record)) {
    try {
      process.kill(-record.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  fs.writeFileSync(file(root, 'run.json'), `${JSON.stringify({ ...record, stopped: true }, null, 2)}\n`);
  return { ...reviewStatus(root), state: 'stopped' };
}
