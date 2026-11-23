import fs from 'node:fs';
import path from 'node:path';
import { parseDeadline, clockTime } from './clock.mjs';
import { cursorRoute, helperTarget } from './delegate.mjs';
import { CliError } from './errors.mjs';
import { globalDir } from './paths.mjs';
import { modern } from './runfile.mjs';
import { verdictSay } from './text.mjs';

export const MIN_START_MINUTES = 60;
export const MAX_ATTEMPTS = 2;

const nightDir = () => path.join(globalDir(), 'night');
const currentFile = () => path.join(nightDir(), 'current');
const planFile = (id) => path.join(nightDir(), `${id}.json`);
const pad = (n) => String(n).padStart(2, '0');

const FILLER = new Set(['a', 'an', 'the', 'of', 'with', 'for', 'and', 'to', 'about', 'that', 'in', 'on']);

export const slugOf = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((word) => word && !FILLER.has(word)).slice(0, 4).join('-') || 'project';

// Several briefs in one file, separated by a line holding only ---.
export const splitBriefs = (text) => text.split(/^\s*---\s*$/m).map((part) => part.trim()).filter(Boolean);

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const writePlan = (plan) => {
  fs.mkdirSync(nightDir(), { recursive: true });
  fs.writeFileSync(planFile(plan.id), `${JSON.stringify(plan, null, 2)}\n`);
};

const STATES = ['waiting', 'running', 'finished', 'blocked'];

export function loadPlan(id) {
  const name = id ?? (fs.existsSync(currentFile()) ? fs.readFileSync(currentFile(), 'utf8').trim() : null);
  const plan = name ? readJson(planFile(name)) : null;
  if (!plan) throw new CliError('No night is planned. Start one with `100x night start --until 07:00 --brief "..." --brief "..."`.');
  const sound = Array.isArray(plan.projects) && plan.projects.every((p) => typeof p?.slug === 'string' && p.slug && typeof p.dir === 'string' && p.dir && STATES.includes(p.state) && Number.isInteger(p.attempts) && p.attempts >= 0) && !Number.isNaN(Date.parse(plan.until)) && Number.isInteger(plan.parallel) && plan.parallel > 0;
  if (!sound) throw new CliError(`${planFile(name)} is not a night plan this version wrote: it needs a list of projects with a slug, a folder, a state and a number of attempts, an end time and a whole number of children at once. Start the night again with \`100x night start\`.`);
  return plan;
}

// `mockups` are briefs that run as mockups: a short clock and no judge. That is the owner's call when the night starts, kept on the
// project. No word inside a brief decides it, so "an overnight oats app" and "a mockup tool for designers" stay normal builds.
export function startNight({ briefs, mockups = [], until, parallel = 2, atOnce = null, base, fill = false, now = new Date() }) {
  // The owner's cap on helpers at the same time wins over any parallel ask. Judges are not children of a night, they queue inside each run.
  if (atOnce != null) parallel = Math.min(parallel, atOnce);
  const entries = [...briefs.map((text) => ({ text })), ...mockups.map((text) => ({ text, mode: 'mockup' }))];
  if (entries.length === 0) throw new CliError('Give at least one brief with --brief "<text>", --mockup "<text>" or --file <file>.');
  const deadline = parseDeadline(until, now);
  if (deadline - now < MIN_START_MINUTES * 60000) throw new CliError(`A night needs at least ${MIN_START_MINUTES} minutes. ${clockTime(deadline)} is too close.`);
  if (!Number.isInteger(parallel) || parallel < 1) throw new CliError('--parallel must be a whole number, 1 or more.');
  if (fill && entries.length > parallel) throw new CliError(`--fill needs every brief to start at once, because each one uses the whole night. ${entries.length} briefs, ${parallel} at once. Add --parallel ${entries.length}, or drop --fill.`);
  const id = `night-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const taken = new Set();
  // A folder with files in it is somebody's work, and a child told to build in it would build over it. Take the next free name.
  const hasFiles = (slug) => {
    try {
      return fs.readdirSync(path.join(base, slug)).length > 0;
    } catch {
      return false;
    }
  };
  const projects = entries.map(({ text, mode }) => {
    const wanted = slugOf(text);
    let slug = wanted;
    for (let n = 2; taken.has(slug) || hasFiles(slug); n += 1) slug = `${wanted}-${n}`;
    const existed = hasFiles(wanted) && !taken.has(wanted);
    taken.add(slug);
    const dir = path.join(base, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'brief.md'), `${text}\n`);
    return { slug, dir, state: 'waiting', attempts: 0, ...(mode ? { mode } : {}), ...(existed ? { existed: wanted } : {}) };
  });
  const plan = { id, createdAt: now.toISOString(), until: deadline.toISOString(), parallel, base, ended: false, ...(fill ? { fill: true } : {}), projects };
  writePlan(plan);
  fs.writeFileSync(currentFile(), `${id}\n`);
  return plan;
}

// finished comes from the run itself, so a crashed bookkeeping step cannot hide a finished prototype.
function summarize(project) {
  const done = readJson(path.join(project.dir, '.100x', 'finished.json'));
  if (!done) return { ...project };
  const run = modern(readJson(path.join(project.dir, '.100x', 'run.json')) ?? {});
  return { ...project, state: 'finished', title: run.title ?? project.slug, verdict: run.verdict ?? 'unknown' };
}

export function nightStatus(id, now = new Date()) {
  const plan = loadPlan(id);
  const projects = plan.projects.map(summarize);
  const left = Math.round((Date.parse(plan.until) - now) / 60000);
  const count = (state) => projects.filter((p) => p.state === state).length;
  return {
    id: plan.id,
    ended: plan.ended,
    until: plan.until,
    untilLocal: clockTime(new Date(plan.until)),
    leftMinutes: left,
    parallel: plan.parallel,
    counts: { waiting: count('waiting'), running: count('running'), finished: count('finished'), blocked: count('blocked') },
    projects,
  };
}

// The mockup skill's own rules win over the night rules that every other task gets: its clock is short, and it has no judge.
const MOCKUP_RULE = 'This brief is a mockup, so the deadline and fill rules do not apply. It keeps its own short clock (`100x clock set +15m`), and the run is marked as a mockup. It still ends with `100x finish`, so the owner finds it on the report page.';

export function childTask(plan, project, { resume = false } = {}) {
  const until = clockTime(new Date(plan.until));
  const mockup = project.mode === 'mockup';
  const timing = plan.fill
    ? `Use all the time until ${until}. Run \`100x clock set ${until} --fill\` in the project after \`100x init\`. \`100x finish\` refuses until the work time is over, so after the first working version keep doing rounds from references/fill.md of the 100x skill. If the project still does not work at 80 percent of the time, call the 100x-wrapup skill. Then \`100x finish\`.`
    : `Deadline ${until}. Run \`100x clock set ${until}\` in the project after \`100x init\`. When 20 percent of the time to the deadline is left and the run has not reached finish, stop the remaining stages and call the 100x-wrapup skill, then \`100x finish\`.`;
  // A mockup is minutes of work and never updates STATE.md, so a retried one starts its mockup again. `100x init --fresh` sets the first try's run files aside.
  const first = `Call the ${mockup ? '100x-mockup' : '100x'} skill on the brief in ${project.dir}/brief.md, unattended. Work only in ${project.dir}. Read the brief word for word.`;
  return [
    resume
      ? mockup
        ? `The first try at this mockup ended early. ${first} The folder holds the brief and what the first try left, so build in it, and when \`100x init\` says an earlier run is here, run \`100x init --fresh\`.`
        : `Resume the unfinished 100x run in ${project.dir}. Call the 100x-continue skill and carry on from .100x/STATE.md. Do not run \`100x init\`.`
      : `${first} The folder holds only the brief, so build in it.`,
    `Nobody is awake until ${until}. Ask nothing. Decide, log the decision and keep going.`,
    mockup ? MOCKUP_RULE : timing,
    `Never deploy to production. Never play audio. ${mockup ? 'Start no other agent' : 'The judge of the review is the only other agent you start'}. Arm no watchdog, the thread that started you watches the night. Stop every dev server you start. These are rules for the run, not asks, so note them under Assumptions and keep them out of the Asks ledger.`,
    'End with the output of `100x finish` as your reply.',
  ].join('\n');
}

// The most at once is the night's own number held under the owner's cap as it stands now, so lowering subagents.atOnce or helper.ceiling mid-night counts.
// `next` only reads, and starting is a separate `record`, so two calls before a record would hand out the same child twice and one more than the cap allows.
// A hand-out is held for ten minutes, counts against the cap while it is held, and `record` confirms it.
const HOLD_MINUTES = 10;
const held = (project, now) => Boolean(project.reservedAt) && now - Date.parse(project.reservedAt) < HOLD_MINUTES * 60_000;

const closed = (status, plan, running, atOnce) => {
  const most = Math.min(plan.parallel, atOnce ?? Infinity);
  return plan.ended ? { none: 'this night has ended' }
    : !(status.leftMinutes >= MIN_START_MINUTES) ? { none: `only ${status.leftMinutes} minutes left, too late to start another` }
      : running >= most ? { none: `${running} running, the most at once is ${most}` }
        : null;
};

export function nextProject(config, { retry, id, now = new Date() } = {}) {
  const plan = loadPlan(id);
  const status = nightStatus(plan.id, now);
  const target = helperTarget(config, 'overnight', 'overnight model');
  const make = (project, resume) => ({
    slug: project.slug,
    dir: project.dir,
    attempt: project.attempts + 1,
    delegateTask: { title: `100x night. ${project.slug}`, role: 'implementation', isolation: 'shared', mode: 'async', target, task: childTask(plan, project, { resume }) },
    startInCursor: cursorRoute(target),
  });
  if (retry) {
    const project = status.projects.find((p) => p.slug === retry);
    if (!project) throw new CliError(`No project "${retry}" in ${plan.id}. See \`100x night status\`.`);
    if (project.state === 'finished') return { none: 'already finished' };
    if (project.state === 'blocked') return { none: `blocked: ${project.note}. A blocked project is not started again, even with --retry` };
    if (project.attempts >= MAX_ATTEMPTS) return { none: `already tried ${project.attempts} times. Block it with \`100x night block ${retry} "<why>"\`` };
    // A retry is a start like any other: the night's end, its clock and its cap on running children apply. The retried project does not count against the cap, it is the one whose child died.
    if (held(project, now)) return { none: `a start for ${retry} was handed out less than ${HOLD_MINUTES} minutes ago and is not recorded yet. Run \`100x night record ${retry} <taskId>\` for it, or wait` };
    const others = status.counts.running - (project.state === 'running' ? 1 : 0) + status.projects.filter((p) => p.state === 'waiting' && held(p, now)).length;
    return closed(status, plan, others, config.subagents?.atOnce) ?? reserve(plan.id, make(project, true), now);
  }
  const handedOut = status.projects.filter((p) => p.state === 'waiting' && held(p, now)).length;
  const shut = closed(status, plan, status.counts.running + handedOut, config.subagents?.atOnce);
  if (shut) return shut;
  const project = status.projects.find((p) => p.state === 'waiting' && !held(p, now));
  if (!project) return { none: handedOut ? `${handedOut} handed out and not recorded yet` : 'nothing is waiting' };
  return reserve(plan.id, make(project, false), now);
}

function reserve(id, handOut, now) {
  update(id, handOut.slug, (project) => { project.reservedAt = now.toISOString(); });
  return handOut;
}

function update(id, slug, change) {
  const plan = loadPlan(id);
  const project = plan.projects.find((p) => p.slug === slug);
  if (!project) throw new CliError(`No project "${slug}" in ${plan.id}. See \`100x night status\`.`);
  change(project, plan);
  writePlan(plan);
  return project;
}

export const recordStart = (slug, taskId, { id, now = new Date() } = {}) =>
  update(id, slug, (project) => {
    delete project.reservedAt;
    Object.assign(project, { state: 'running', taskId, startedAt: now.toISOString(), attempts: project.attempts + 1 });
  });

export const blockProject = (slug, note, { id } = {}) => update(id, slug, (project) => Object.assign(project, { state: 'blocked', note }));

export function endNight(id) {
  const plan = loadPlan(id);
  plan.ended = true;
  writePlan(plan);
  return nightStatus(plan.id);
}

export function describeNight(status) {
  const hours = Math.floor(Math.max(0, status.leftMinutes) / 60);
  const left = status.leftMinutes <= 0 ? 'time is up' : hours ? `${hours} h ${status.leftMinutes % 60} min left` : `${status.leftMinutes} min left`;
  const lines = [`Night ${status.id} until ${status.untilLocal}, ${left}. Up to ${status.parallel} at once.${status.ended ? ' Ended.' : ''}`];
  const c = status.counts;
  lines.push(`${c.finished} finished, ${c.running} running, ${c.waiting} waiting, ${c.blocked} blocked.`);
  for (const p of status.projects) {
    const extra = p.state === 'finished' ? `${verdictSay(p.verdict)}. ${p.title}` : p.state === 'running' ? `attempt ${p.attempts}, started ${clockTime(new Date(p.startedAt))}` : p.state === 'blocked' ? p.note : '';
    lines.push(`${p.state.padEnd(8)} ${p.slug}${p.mode === 'mockup' ? ' (mockup)' : ''}  ${extra}`.trimEnd());
  }
  return lines.join('\n');
}
