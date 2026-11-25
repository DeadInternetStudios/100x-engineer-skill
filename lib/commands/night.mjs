import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { load } from '../config.mjs';
import { CliError } from '../errors.mjs';
import { blockProject, describeNight, endNight, nextProject, nightStatus, recordStart, splitBriefs, startNight } from '../night.mjs';
import { findProjectRoot } from '../paths.mjs';
import { refuseWhenSolo } from '../solo.mjs';

const usage = `
100x night start --until <when> --brief "<text>" [--brief "<text>" ...] [--mockup "<text>" ...] [--file <briefs>] [--parallel N] [--fill] [--base <dir>]
100x night next [--retry <slug>] [--json]
100x night record <slug> <taskId>
100x night block <slug> <reason>
100x night status [--json]
100x night end

The plan for a night of several briefs. start makes one folder per brief with the brief inside and keeps the wake time.
next prints the child to start now, with the model from the overnight setting, or says why nothing starts. record notes that
a child began. status reads each folder, so a finished prototype shows as finished even if the notes missed it.
A file holds several briefs separated by a line with only ---. --mockup is a brief the owner wants as a mockup: its child calls the 100x-mockup skill, keeps a short clock and has no judge. No word inside a brief makes it one. --until is 07:00, 7am, +8h and the like. At most subagents.atOnce run at once (1 by default, the owner's max N subagents), unless --parallel says fewer.
--fill makes every child use all the time to the wake time, so all briefs must start at once (--parallel at least the number of briefs).
No new child starts in the last 60 minutes. A child that died is retried once with --retry, then blocked.
`;

export default {
  name: 'night',
  summary: 'Plan, feed and read a night of several briefs.',
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { until: { type: 'string' }, brief: { type: 'string', multiple: true }, mockup: { type: 'string', multiple: true }, file: { type: 'string' }, parallel: { type: 'string' }, base: { type: 'string' }, fill: { type: 'boolean' }, retry: { type: 'string' }, json: { type: 'boolean' } },
    });
    const [action, ...rest] = positionals;
    const out = (data, text) => console.log(values.json ? JSON.stringify(data, null, 2) : text);
    // A night hands each brief to a child. A solo run hands nothing to anyone, so it cannot plan or feed one from its own folder.
    if (action === 'start' || action === 'next') refuseWhenSolo(findProjectRoot(process.cwd()), 'a child for a night');
    if (action === 'start') {
      if (!values.until) throw new CliError('Say when you wake up with --until, for example --until 07:00.');
      const briefs = [...(values.brief ?? []), ...(values.file ? splitBriefs(fs.readFileSync(values.file, 'utf8')) : [])];
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const atOnce = load().effective.subagents.atOnce;
      const plan = startNight({ briefs, mockups: values.mockup ?? [], until: values.until, parallel: values.parallel ? Number(values.parallel) : atOnce, atOnce, fill: values.fill, base: path.resolve(values.base ?? `night-${stamp}`) });
      const moved = plan.projects.filter((project) => project.existed).map((project) => `${project.existed} already has files in it, so this brief builds in ${project.slug}. Nothing there was touched.`);
      return out(plan, `${describeNight(nightStatus(plan.id))}\n${moved.length ? `${moved.join('\n')}\n` : ''}Folders are under ${plan.base}. Next: \`100x night next --json\`.`);
    }
    if (action === 'next') {
      const next = nextProject(load().effective, { retry: values.retry });
      return out(next, next.none ? `Nothing to start. ${next.none}.` : `Start ${next.slug}, attempt ${next.attempt}. Pass the delegateTask object to your app's subagent tool. ${next.startInCursor} Then run \`100x night record ${next.slug} <taskId>\`.\n${JSON.stringify(next.delegateTask, null, 2)}`);
    }
    if (action === 'record') {
      if (rest.length < 2) throw new CliError('Usage: 100x night record <slug> <taskId>');
      const project = recordStart(rest[0], rest[1]);
      return out(project, `Recorded. ${project.slug} is running, attempt ${project.attempts}.`);
    }
    if (action === 'block') {
      if (rest.length < 2) throw new CliError('Usage: 100x night block <slug> <reason>');
      const project = blockProject(rest[0], rest.slice(1).join(' '));
      return out(project, `Blocked ${project.slug}. ${project.note}`);
    }
    if (action === 'end') {
      const status = endNight();
      return out(status, describeNight(status));
    }
    if (action === 'status' || action === undefined) {
      const status = nightStatus();
      return out(status, describeNight(status));
    }
    throw new CliError(`Unknown night command "${action}". Use start, next, record, block, status or end.`);
  },
};
