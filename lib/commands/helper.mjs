import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import * as cfg from '../config.mjs';
import { chooseModel, describeModel, modelWords, refuseOutsideLock, requireSdk, resolveSdk, runHelper, SDK_PACKAGE, SDK_VERSION, sdkFailure } from '../cursor-sdk.mjs';
import { globalDir } from '../paths.mjs';
import { findProjectRoot } from '../paths.mjs';
import { INSTALLS, pinned, verifyPinned } from '../pins.mjs';
import { writeReceipt } from '../receipt.mjs';
import { refuseWhenSolo } from '../solo.mjs';
import { recordHelper, refuseWhenSpent, spendLine } from '../spend.mjs';
import { install } from './browsers.mjs';

const usage = `
100x helper setup
100x helper login [--force]
100x helper models [--json]
100x helper run --model <id> (--task <text> | --task-file <file>) [--effort <level>] [--context <size>] [--option <id>=<value>]... [--cwd <dir>] [--minutes <n>] [--out <file>] [--receipt <file>] [--stream] [--json]

Starts a helper (a judge, an arm of a bake-off, a child) through the Cursor SDK, @cursor/sdk. In Cursor this is the only way a helper starts.
The app's Task tool ran Composer for every helper in its own hooks log, whatever model was asked for, and the Cursor command line stops at
"out of fast requests" on an account that has an unlimited slow queue. The SDK runs the account's own queue and says which model ran.

setup   installs @cursor/sdk, exactly version ${SDK_VERSION}, into ~/.100x when nothing on this machine provides it, as 100x browsers does for Playwright.
        The SDK is loaded from ~/.100x or from X100_CURSOR_SDK_FROM and from nowhere else, never from the folder a helper works in.
login   opens the Cursor login page, waits for the owner to approve it and lets the SDK store a key for 90 days in ~/.cursor/sdk. The key is never printed.
        CURSOR_API_KEY works instead of a login. --force logs in again.
models  lists the models this account can use through the SDK, with each one's parameters and values. Use these ids exactly.
run     runs one helper in the foreground until it ends, in --cwd (the current folder by default), with full access to that machine like any
        unattended judge. The task is the helper's whole instruction. --effort and --context set the model's reasoning effort and context
        window, for example --model claude-opus-5-5 --effort max --context 300k. --option sets any other parameter, once for each.
        Names and values the catalog does not list are refused, because a guess could run another configuration without a word.
        helper.only in the global config ("claude-opus-5-5 reasoning_effort=max context=300k") locks every helper on this machine to one selection, and
        nothing a project file or an agent passes can change it. The task tool is off inside a helper, so a helper that needs another one runs this command.
        A helper never starts in MAX mode. On this account every 1m window is a MAX mode variant, and so is the default of a model that has a
        window, so a model with a context window must be given one (--context 300k) and a selection that could mean a MAX variant is refused.
        --minutes cancels the helper at that deadline. --out writes its final answer. --receipt writes what the SDK reported (the model asked for, the model and
        settings that ran, the run, the seconds and tokens) as a file signed with this machine's 100x key, which 100x eval bakeoff mark takes in place
        of a model name typed by hand. --stream prints its text as it comes.
        The result says the model asked for and the model the SDK reports. Exit code 0 when it finished on that model, 2 when it did not finish,
        3 when the SDK reports another model, 1 when it could not start. A run that exits 3 was not a run of the model that was chosen.
        A judge started by 100x review-run is this command in review.command, see skills/100x/references/apps.md.
`;

async function login(values) {
  const { sdk } = requireSdk();
  try {
    const status = await sdk.Cursor.auth.status();
    if (status.status === 'logged-in' && !values.force) {
      console.log(`already logged in${status.email ? ` as ${status.email}` : ''}${status.apiKeyExpiresAtMs ? `. The key expires ${new Date(status.apiKeyExpiresAtMs).toISOString().slice(0, 10)}` : ''}.`);
      return;
    }
    const result = await sdk.Cursor.auth.login({
      apiKeyName: '100x helper',
      signal: AbortSignal.timeout(20 * 60 * 1000),
      onLoginUrl: (url) => console.log(`Open this link and approve it, if the browser did not open by itself:\n${url}`),
    });
    console.log(`logged in${result.email ? ` as ${result.email}` : ''}. The key expires ${new Date(result.apiKeyExpiresAtMs).toISOString().slice(0, 10)}. The SDK keeps it in ~/.cursor/sdk and it is never printed.`);
  } catch (error) {
    throw sdkFailure(error);
  }
}

async function catalog(sdk) {
  try {
    return await sdk.Cursor.models.list();
  } catch (error) {
    throw sdkFailure(error);
  }
}

async function models(values) {
  const { sdk } = requireSdk();
  const list = await catalog(sdk);
  if (values.json) return console.log(JSON.stringify(list, null, 2));
  for (const model of list) console.log(describeModel(model));
  return undefined;
}

function taskText(values) {
  if (!values.task === !values['task-file']) throw new CliError('Give the helper its instruction with exactly one of --task <text> or --task-file <file>.');
  if (values.task) return values.task;
  try {
    return fs.readFileSync(values['task-file'], 'utf8');
  } catch (error) {
    throw new CliError(`Cannot read the task file ${values['task-file']}. ${error.message}`);
  }
}

async function run(values) {
  // A solo run never hands work to another model, in the folder the command runs from or the folder the helper would work in.
  refuseWhenSolo(findProjectRoot(process.cwd()), 'a helper');
  refuseWhenSolo(findProjectRoot(path.resolve(values.cwd ?? process.cwd())), 'a helper');
  if (!values.model) throw new CliError('--model <id> is required. `100x helper models` lists the ids this account can use.');
  const task = taskText(values);
  if (!task.trim()) throw new CliError('The task is empty.');
  const cwd = path.resolve(values.cwd ?? process.cwd());
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new CliError(`--cwd ${cwd} is not a folder.`);
  const minutes = values.minutes === undefined ? null : Number(values.minutes);
  if (minutes !== null && !(minutes > 0)) throw new CliError('--minutes takes a number above 0.');
  // A helper that starts inside a project is counted against that run, so a cap in budget.tokens can stop the next one.
  const root = findProjectRoot(process.cwd());
  if (root) refuseWhenSpent(root);
  const { sdk, version } = requireSdk();
  const selection = chooseModel(await catalog(sdk), { id: values.model, effort: values.effort, context: values.context, options: values.option ?? [] });
  refuseOutsideLock(selection, cfg.load().effective.helper.only);
  let result;
  try {
    result = await runHelper(sdk, { selection, task, cwd, minutes, onText: values.stream ? (text) => process.stdout.write(text) : null });
  } catch (error) {
    throw sdkFailure(error);
  }
  if (values.out) {
    fs.mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
    fs.writeFileSync(values.out, `${result.text}\n`);
  }
  if (values.receipt) writeReceipt(path.resolve(values.receipt), result, version);
  if (root) recordHelper(root, { model: result.ran?.id ?? result.requested?.id, status: result.status, seconds: result.seconds, tokens: result.tokens, agentId: result.agentId });
  const exitCode = result.modelCheck === 'mismatch' ? 3 : result.status === 'finished' ? 0 : 2;
  if (values.json) {
    console.log(JSON.stringify({ ...result, sdkVersion: version, exitCode }, null, 2));
  } else {
    if (values.stream) console.log('');
    const why = result.timedOut ? ` at the ${minutes} minute deadline` : result.error ? `: ${result.error}` : '';
    console.log(`helper ${result.status}${why}. ${result.seconds} s${result.tokens ? `, ${result.tokens} tokens` : ''}.`);
    console.log(`asked ${modelWords(result.requested)}`);
    console.log(`ran   ${modelWords(result.ran)}${result.ran ? ', as the SDK reports it' : ''}`);
    console.log(`agent ${result.agentId}  run ${result.runId}${values.out ? `  answer ${values.out}` : ''}${values.receipt ? `  receipt ${values.receipt}` : ''}`);
    console.log(`sdk   ${SDK_PACKAGE} ${version}${version === SDK_VERSION ? '' : `, not the ${SDK_VERSION} this was tested with`}`);
    if (result.modelCheck === 'mismatch') console.log(`Not the model that was asked for: ${result.differences.join('; ')}. This is not a run of the model that was chosen.`);
    const total = root ? spendLine(root) : null;
    if (total) console.log(`spent ${total}`);
    if (result.modelCheck === 'unreported') console.log('The SDK did not report a model, so write "model not verified" wherever the model is recorded. A bake-off will not take this run\'s receipt.');
  }
  if (exitCode) process.exitCode = exitCode;
  return undefined;
}

export default {
  name: 'helper',
  summary: 'Start a helper on a Cursor model through the Cursor SDK.',
  usage,
  async run(argv) {
    const [action, ...rest] = argv;
    const { values } = parseArgs({
      args: rest,
      options: {
        force: { type: 'boolean' },
        json: { type: 'boolean' },
        stream: { type: 'boolean' },
        model: { type: 'string' },
        effort: { type: 'string' },
        context: { type: 'string' },
        option: { type: 'string', multiple: true },
        task: { type: 'string' },
        'task-file': { type: 'string' },
        cwd: { type: 'string' },
        minutes: { type: 'string' },
        out: { type: 'string' },
        receipt: { type: 'string' },
      },
    });
    if (action === 'setup') {
      const there = resolveSdk();
      if (there) return console.log(`already available, ${SDK_PACKAGE} ${there.version}${there.version === SDK_VERSION ? '' : `, not the ${SDK_VERSION} this was tested with`}.`);
      fs.mkdirSync(globalDir(), { recursive: true });
      console.log(`Installing ${SDK_PACKAGE}@${SDK_VERSION} into ${globalDir()}.`);
      install(`Installing ${SDK_PACKAGE}`, 'npm', ['install', '--prefix', globalDir(), '--no-audit', '--no-fund', '--ignore-scripts', '--save-exact', ...INSTALLS.sdk.map(pinned)]);
      const checked = verifyPinned(globalDir(), [SDK_PACKAGE]);
      console.log(`installed ${SDK_PACKAGE}@${SDK_VERSION} into ${globalDir()}. It and the ${checked.length - 1} packages it needs match the hashes pinned in 100x. Run \`100x helper login\` next.`);
      return undefined;
    }
    if (action === 'login') return login(values);
    if (action === 'models') return models(values);
    if (action === 'run') return run(values);
    throw new CliError('100x helper takes setup, login, models or run. Run `100x helper --help`.');
  },
};
