import { parseArgs } from 'node:util';
import { load } from '../config.mjs';
import { CliError } from '../errors.mjs';
import { findProjectRoot } from '../paths.mjs';
import { HOOK_SNIPPET, recentHelpers, verifyHelper } from '../provenance.mjs';

const usage = `
100x review-verify [--requested <model>] [--task-has <text>] [--hours <n>] [--json]
100x review-verify --list [--hours <n>] [--json]
100x review-verify --setup

Says which model the app really ran for the helper you just started, from the app's own record. The helper and the agent can write
any model name in a note, and some apps run a different model than the one they were asked for.
Run it right after a judge or an arm starts. ok means the model asked for is the model that ran. mismatch means another model ran, so the
round was not a review by the model you chose, and it exits 1. unknown means the record cannot say, and it exits 0.
--requested  The model you asked for. Default is the judge in config (review.model).
--task-has   Pick the latest helper whose task text holds this. Default is this project's folder, which every judge task names.
--hours      How far back to read. Default 24.
--list       Show the helpers in the record, newest last.
--setup      Print the one hook that makes Cursor record each helper it starts. Cursor logs a hook's input even when the hook does nothing.
The record is the hooks log in Cursor's logs folder. X100_CURSOR_LOGS points at another folder, and an empty one turns the record off.
`;

const when = (stamp) => (stamp ? ` started ${stamp}` : '');

export default {
  name: 'review-verify',
  summary: 'Check which model the app ran for a helper, from its own log.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { requested: { type: 'string' }, 'task-has': { type: 'string' }, hours: { type: 'string' }, list: { type: 'boolean' }, setup: { type: 'boolean' }, json: { type: 'boolean' } } });
    if (values.setup) {
      console.log(`Add this to ~/.cursor/hooks.json, or add the subagentStart entry to the hooks you already have. The command does nothing, and Cursor logs the input of every hook it runs, which names the model.\n${HOOK_SNIPPET}`);
      return undefined;
    }
    const hours = values.hours === undefined ? 24 : Number(values.hours);
    if (!Number.isFinite(hours) || hours <= 0) throw new CliError(`--hours takes a number above 0. Got "${values.hours}".`);
    const helpers = recentHelpers({ hours });
    if (values.list) {
      if (values.json) return console.log(JSON.stringify(helpers.map(({ at, id, model, type }) => ({ at, id, model, type })), null, 2));
      if (!helpers.length) return console.log('The record holds no helper start. Run `100x review-verify --setup`.');
      for (const helper of helpers) console.log(`${helper.at}  ${String(helper.model).padEnd(26)} ${helper.id}  ${helper.task.slice(0, 60).replace(/\s+/g, ' ')}`);
      return undefined;
    }
    const requested = values.requested ?? load().effective.review.model;
    if (!requested) throw new CliError('Say which model you asked for with --requested <model>. There is no judge model in config to default to.');
    const root = findProjectRoot();
    const result = verifyHelper(helpers, { requested, taskHas: values['task-has'] ?? root });
    if (result.status === 'mismatch') process.exitCode = 1;
    if (values.json) return console.log(JSON.stringify(result, null, 2));
    if (result.status === 'ok') console.log(`ok. The app ran ${result.ran}, the model you asked for (${requested}). Helper ${result.id},${when(result.startedAt)}.`);
    else if (result.status === 'mismatch') {
      console.log(`mismatch. You asked for ${requested}. The app ran ${result.ran}. Helper ${result.id},${when(result.startedAt)}.`);
      console.log(`That round was not a review by ${requested}, and the model that ran is not the one the owner chose. Start the judge another way (a review.command, or an app that honors the model), or say in the review note that ${result.ran} ran it. Do not write ${requested} as the model.`);
    } else {
      console.log(`unknown. ${result.why}. The model is not checked, so write in the review note that the model was not verified by the app.`);
      if (!helpers.length) console.log('Cursor logs a helper start only when a hook is set for it. `100x review-verify --setup` prints the hook.');
    }
    return undefined;
  },
};
