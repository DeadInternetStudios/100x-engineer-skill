import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { armFolder, BRIEFS_FILE, browserReady, buildPairs, DEFAULT_ARMS, initBakeoff, leakPatterns, loadConfig, markRun, ORDERS, pathWords, paths, PROTOCOL_FILE, readJson, runKeys } from '../eval/blind.mjs';
import { freezeRun, loadTriggers, recordHoldoutLook, replayRun, routingReport, scoreRouting, stage, TRIGGERS_FILE } from '../eval/routing.mjs';
import { evalHelp, usage } from '../eval/help.mjs';
import { buildPictures } from '../eval/pictures.mjs';
import { bakeoffScreen } from '../eval/screen.mjs';
import { bakeoffReport, scoreBakeoff } from '../eval/tally.mjs';
import { planText, reachOf } from '../eval/plan.mjs';
import { INSTALL_HINT } from '../playwright.mjs';
import { duration, plural, shellPath, wrap } from '../eval/words.mjs';

function triggers(args) {
  const [action, target] = args._;
  const set = args.values.set ?? 'tune';
  const file = args.values.file ?? TRIGGERS_FILE;
  if (action === 'stage') {
    if (!target) throw new CliError('Say where to write the files: 100x eval triggers stage <dir>.');
    const result = stage(path.resolve(target), { set, file });
    console.log(`Staged ${result.prompts} ${set} messages and ${result.skills} skills in ${path.resolve(target)}. Descriptions ${result.hash}.\nA model answers with answers.json next to ask.md. Then run 100x eval triggers score ${path.join(path.resolve(target), 'answers.json')} --set ${set}.`);
    return;
  }
  if (action === 'score') {
    const min = args.values.min === undefined ? null : Number(args.values.min);
    if (min !== null && !(min >= 0 && min <= 1)) throw new CliError(`--min takes a number from 0 to 1. Got "${args.values.min}".`);
    const report = (result, { look = null, note = null } = {}) => {
      if (min !== null && result.accuracy < min) process.exitCode = 1;
      if (args.values.json) return console.log(JSON.stringify({ ...result, ...(look ? { holdoutLook: look } : {}) }, null, 2));
      console.log(routingReport(result, { look, all: Boolean(args.values.all) }));
      if (note) console.log(note);
      if (min !== null) console.log(`Accuracy ${result.accuracy.toFixed(3)} against --min ${min}. ${result.accuracy < min ? 'Under it.' : 'Meets it.'}`);
    };
    if (args.values.bundle) {
      if (target || args.values.save) throw new CliError('--bundle works a saved run out again. It takes no answers file and no --save.');
      return report(replayRun(readJson(path.resolve(args.values.bundle), 'the saved run'), args.values.bundle), { note: `Worked out again from ${args.values.bundle}. No look at the holdout was recorded.` });
    }
    if (!target) throw new CliError('Say which answers to score: 100x eval triggers score <answers.json>.');
    let answers;
    try {
      answers = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch (error) {
      throw new CliError(`Could not read ${target}: ${error.message}`);
    }
    if (Array.isArray(answers)) {
      const odd = answers.findIndex((a) => !a || typeof a !== 'object' || typeof a.id !== 'string');
      if (odd >= 0) throw new CliError(`${target} entry ${odd + 1} is not { "id": "<message id>", "skill": "<skill name or none>" }. Got ${JSON.stringify(answers[odd])}.`);
      answers = Object.fromEntries(answers.map((a) => [a.id, a.skill]));
    }
    if (!answers || typeof answers !== 'object') throw new CliError(`${target} must map each message id to a skill name or "none".`);
    const prompts = loadTriggers(file);
    const result = scoreRouting(prompts, answers, { set });
    // A file that answers none of the messages is the wrong file or the wrong set. It is refused for every set, and before a holdout look is spent.
    if (result.unanswered === result.prompts) throw new CliError(`None of the ${result.prompts} messages in the ${set} set has an answer in ${target}. Check that the file answers the ${set} set.${set === 'tune' ? '' : ' No look at the holdout was recorded.'}`);
    const look = set === 'tune' ? null : recordHoldoutLook(result);
    if (args.values.save) fs.writeFileSync(path.resolve(args.values.save), `${JSON.stringify(freezeRun({ set, answerer: args.values.model ?? null, triggers: prompts, answers }), null, 2)}\n`);
    return report(result, { look, note: args.values.save ? `Saved this run in ${args.values.save}. 100x eval triggers score --bundle ${args.values.save} works the same numbers out again.` : null });
  }
  throw new CliError(`${action === undefined ? '100x eval triggers needs a command' : `100x eval triggers has no command called ${action}`}: stage or score. Run \`100x eval triggers --help\`.`);
}

// A number a person typed, checked where it comes in. NaN would be written to a file as null and read back as "not recorded".
const numberFlag = (name, value, { integer = false, positive = false } = {}) => {
  if (value === undefined) return undefined;
  const number = Number(value);
  const ok = value.trim() !== '' && Number.isFinite(number) && (positive ? number > 0 : number >= 0) && (!integer || Number.isInteger(number));
  if (!ok) throw new CliError(`--${name} takes ${integer ? 'a whole number' : 'a number'} ${positive ? 'above' : 'of'} 0${positive ? '' : ' or more'}. Got "${value}".`);
  return number;
};

const needDir = (target, action) => {
  if (!target) throw new CliError(`Say which bake-off folder: 100x eval bakeoff ${action} <dir>.`);
  return path.resolve(target);
};

function status(dir) {
  const config = loadConfig(dir);
  const where = paths(dir);
  const runs = fs.existsSync(where.runs) ? readJson(where.runs, 'the run times') : {};
  const order = config.order ?? runKeys(config);
  const built = Object.fromEntries(config.briefs.flatMap((b) => config.arms.map((a) => {
    const folder = armFolder(dir, config.arms, b.id, a);
    return [`${b.id}/${a}`, { folder: path.relative(dir, folder), ready: fs.existsSync(path.join(folder, 'index.html')), run: runs[`${b.id}/${a}`] }];
  })));
  const lines = [`Bake-off in ${dir}. Arms ${config.arms.join(' and ')}, ${plural(config.briefs.length, 'brief')}, seed ${config.seed}. The runs are listed in the order to run them.`];
  for (const key of order) {
    const { ready, folder, run } = built[key];
    lines.push(`  ${key.padEnd(28)} ${ready ? 'index.html there' : `no index.html in ${folder}`}${run?.minutes !== undefined ? `, ${duration(run.minutes)}` : run?.startedAt ? ', running' : ''}`);
  }
  // The commands are printed whole, with this folder's path in them, so the next step can be run as it stands. Only the model is left for the owner, because the owner's rule names it.
  const d = shellPath(dir);
  const model = '--model <model id> --effort <level> --context <size>';
  const receipt = (name) => shellPath(path.join(dir, 'helper-receipts', `${name}.json`));
  if (!fs.existsSync(where.key)) {
    // pairs builds in a folder of its own and moves it into place when the scan passes. A run that was interrupted leaves that folder and no key.
    const interrupted = fs.readdirSync(dir).filter((name) => name.startsWith('.build-'));
    if (interrupted.length) lines.push(`An earlier pairs run was interrupted and left ${interrupted.join(', ')}. No key was sealed. Delete ${interrupted.length === 1 ? 'it' : 'them'} and run pairs again.`);
    const running = order.find((key) => built[key].run?.startedAt && !built[key].run?.finishedAt);
    const todo = order.find((key) => !built[key].ready && !built[key].run?.startedAt);
    const stop = (key) => `100x eval bakeoff mark ${d} ${key} stop --receipt ${receipt(key.replace('/', '--'))}`;
    if (running) lines.push(`Next: ${running} is running. When its helper ends, run:`, `  ${stop(running)}`);
    else if (todo) {
      const name = todo.replace('/', '--');
      lines.push(
        `Next: start ${todo}. Run these in order. \`100x helper models\` lists the model id, level and size to fill in.`,
        `  100x eval bakeoff mark ${d} ${todo} start`,
        `  100x helper run ${model} --task-file ${shellPath(path.join(dir, 'tasks', `${name}.md`))} --cwd ${shellPath(path.join(dir, built[todo].folder))} --minutes ${config.minutes} --receipt ${receipt(name)} --json`,
        `  ${stop(todo)}`,
      );
    } else {
      const failed = order.filter((key) => !built[key].ready && built[key].run?.finishedAt);
      if (failed.length) lines.push(`${failed.join(', ')} ended with no index.html. That is a failed run and it stays in the count.`);
      lines.push(failed.length ? `Next: 100x eval bakeoff pairs ${d} --blank-missing. It shows the judge a blank page for each failed run and the report names it.` : `Next: 100x eval bakeoff pairs ${d}.`);
    }
  } else {
    const key = readJson(where.key, 'the key');
    const total = key.items.length * ORDERS.length;
    const folders = key.items.flatMap((item) => ORDERS.map((order) => `${item.id}-${order}`));
    const waiting = folders.filter((folder) => !fs.existsSync(path.join(where.judge, folder, 'verdict.json')));
    lines.push(`Pairs built and the key is sealed. ${total - waiting.length} of ${total} verdicts are in.`);
    // The pairs that have both verdicts are counted already, so a run that cannot reach the word can stop before the rest of the judges are paid for.
    const reached = waiting.length ? reachOf(dir) : null;
    if (reached) lines.push(wrap(reached, { width: 96, indent: '  ' }));
    if (waiting.length) {
      const [first] = waiting;
      lines.push(
        'Next: point one fresh judge at each folder under judge/ that has no verdict.json, one at a time, and say nothing about which arm is which.',
        wrap(`Waiting: ${waiting.join(', ')}.`, { width: 96, indent: '  ' }),
        `For ${first}, then for each of the others:`,
        `  100x helper run ${model} --cwd ${shellPath(path.join(where.judge, first))} --minutes 30 --receipt ${receipt(first)} --json --task "Open this folder and follow ask.md in it."`,
        `  100x eval bakeoff mark ${d} judge/${first} stop --receipt ${receipt(first)}`,
      );
    } else lines.push(`Next: 100x eval bakeoff score ${d}.`);
  }
  console.log(lines.join('\n'));
}

async function bakeoff(args) {
  const [action, target, runKey, runAction] = args._;
  if (action === 'init') {
    const dir = needDir(target, 'init');
    const file = path.resolve(args.values.briefs ?? BRIEFS_FILE);
    const all = readJson(file, 'the briefs');
    const list = all.briefs ?? all;
    if (!Array.isArray(list)) throw new CliError(`${file} must hold a list of briefs, or an object with a "briefs" list. Each brief is { id, title, text }.`);
    const first = args.values.first === undefined ? list.length : Number(args.values.first);
    if (!Number.isInteger(first) || first < 1 || first > list.length) throw new CliError(`--first takes a whole number from 1 to ${list.length}. Got "${args.values.first}".`);
    const briefs = list.slice(0, first);
    const notes = Object.fromEntries((args.values.note ?? []).map((entry) => {
      const [arm, file] = entry.split('=');
      if (!arm || !file) throw new CliError(`--note takes <arm>=<file>. Got "${entry}".`);
      return [arm, fs.readFileSync(path.resolve(file), 'utf8')];
    }));
    const arms = args.values.arms ? args.values.arms.split(',') : undefined;
    const minutes = numberFlag('minutes', args.values.minutes, { positive: true });
    const result = initBakeoff(dir, { briefs, arms, seed: numberFlag('seed', args.values.seed, { integer: true }), notes, minutes, pin: Boolean(args.values.pin) });
    const words = pathWords(dir, leakPatterns(arms ?? DEFAULT_ARMS));
    console.log(`Bake-off made in ${dir}, seed ${result.seed}. ${result.tasks.length} task files are under tasks/. Each task names the folder its arm works in, arm-1 for ${(arms ?? DEFAULT_ARMS)[0]} and arm-2 for ${(arms ?? DEFAULT_ARMS)[1]}, and that arm leaves index.html there.\nProtocol: ${PROTOCOL_FILE}. Read it before the first arm starts.${result.pinned ? `\nThe skill is pinned in ${result.pinned.folder}${result.pinned.snapshot ? `, from commit ${result.pinned.snapshot.commit.slice(0, 12)}${result.pinned.snapshot.dirty ? ' plus uncommitted changes' : ''}` : ''}. The second arm runs ${result.pinned.command}.` : ''}\nRun the arms one at a time in this order: ${result.order.join(', ')}.${words.length ? `\nHeads up: the path to this folder holds ${words.join(', ')}, and the tasks and the judge see it. Make the bake-off in a neutral folder instead.` : ''}\n${wrap(planText(briefs.length), { width: 110 })}${browserReady() ? '' : `\nBrowsers: none is installed, and the pairs step photographs every page. ${INSTALL_HINT}`}`);
    return;
  }
  if (action === 'mark') {
    const dir = needDir(target, 'mark');
    const done = markRun(dir, { key: runKey, action: runAction, model: args.values.model ?? null, ran: args.values.ran ?? null, source: args.values.source ?? null, tokens: numberFlag('tokens', args.values.tokens, { integer: true }) ?? null, receipt: args.values.receipt ?? null });
    console.log(`${done.key} ${runAction === 'start' ? 'started' : 'stopped'}${done.minutes !== undefined ? `, ${duration(done.minutes)}` : ''}${args.values.receipt ? `. Receipt kept in ${path.join(paths(dir).receipts, `${done.key.replaceAll('/', '__')}.json`)}, ${done.model.ran} ran${Object.keys(done.model.params).length ? ` at ${Object.entries(done.model.params).map(([id, value]) => `${id} ${value}`).join(', ')}` : ''}` : ''}.`);
    return;
  }
  if (action === 'pairs') {
    const dir = needDir(target, 'pairs');
    const result = buildPairs(dir, { capture: !args.values['no-capture'], allow: args.values.allow ?? [], blank: Boolean(args.values['blank-missing']), edits: args.values.edit ?? [], progress: (line) => console.log(line) });
    console.log(`Built ${result.pairs} pairs (${result.packs} judge folders), scanned ${result.scanned} text and ${result.binary} binary files, found no arm name in them${args.values['no-capture'] ? '' : ' or in the text the pages showed when they ran'}. Key sealed, sha256 ${result.hash}.${(args.values.edit ?? []).length ? ` ${plural((args.values.edit ?? []).length, 'hand edit')} recorded, and the score will say so.` : ''}${result.blank.length ? `\n${result.blank.length} run${result.blank.length === 1 ? '' : 's'} left no page, so the judge sees a blank page for ${result.blank.join(', ')}. Log that now. The report names ${result.blank.length === 1 ? 'it' : 'them'}.` : ''}${result.pathWords.length ? `\nHeads up: the path to the judge folders holds ${result.pathWords.join(', ')}, and a judge sees its path. Move the whole folder somewhere neutral before judging, or the report will say it did.` : ''}\nLog that hash now, before any judge starts: 100x log review "bake-off key sealed" "the key is hashed before judging" "sha256 ${result.hash}".\nPoint each judge only at one folder under ${paths(dir).judge}, and ask it to write verdict.json there.`);
    return;
  }
  if (action === 'status') return status(needDir(target, 'status'));
  if (action === 'gallery') {
    const dir = needDir(target, 'gallery');
    if (!args.values.out) throw new CliError('Say where the pictures and the report go: 100x eval bakeoff gallery <dir> --out <folder>.');
    const out = path.resolve(args.values.out);
    const built = await buildPictures(dir, out, { progress: (line) => console.log(line) });
    // Same contract as score: a withheld verdict is not a success.
    if (built.result.verdict.withheld) process.exitCode = 2;
    console.log(bakeoffScreen(built.result, { dir, closing: `Wrote ${plural(built.pictures.length, 'picture')}, ${plural(built.screens, 'full-size screen')} and report.md in ${out}.` }).trimEnd());
    return;
  }
  if (action === 'score') {
    const dir = needDir(target, 'score');
    const result = scoreBakeoff(dir);
    const report = bakeoffReport(result, loadConfig(dir));
    // The counts are the point, so a folder that cannot be written to (a read-only copy, someone else's evidence) still gets them.
    let kept = null;
    let written = null;
    if (!args.values['no-write']) {
      try {
        fs.writeFileSync(path.join(dir, 'report.md'), report);
        fs.writeFileSync(path.join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
        written = path.join(dir, 'report.md');
      } catch (error) {
        kept = `report.md and result.json were not written in ${dir} (${error.code ?? error.message}). The counts above are the same.`;
      }
    }
    // A shell that chains on this command must be able to tell that no verdict was printed.
    if (result.verdict.withheld) process.exitCode = 2;
    console.log(args.values.json ? JSON.stringify(result, null, 2) : bakeoffScreen(result, { dir, written, asked: Boolean(args.values['no-write']) }).trimEnd());
    if (kept) (args.values.json ? console.error : console.log)(kept);
    return;
  }
  throw new CliError(`${action === undefined ? '100x eval bakeoff needs a command' : `100x eval bakeoff has no command called ${action}`}: init, mark, pairs, status, score or gallery. Run \`100x eval bakeoff --help\`.`);
}

export default {
  name: 'eval',
  summary: 'Routing and bake-off evals for the skills.',
  usage,
  help: evalHelp,
  async run(argv) {
    const [area, ...rest] = argv;
    if (area === undefined || area === 'help') return console.log(evalHelp(rest.filter((word) => !word.startsWith('-'))));
    if (area === '--version' || area === '-v') throw new CliError('100x eval has no version of its own. `100x --version` prints it.');
    if (area.startsWith('-')) throw new CliError(`100x eval takes triggers or bakeoff first, and then a command. ${area} has no meaning here. Run \`100x eval --help\`.`);
    const where = `100x eval ${[area, ...rest.filter((word) => !word.startsWith('-')).slice(0, 1)].join(' ')}`;
    const { values, positionals } = parse(where, rest);
    // `help` after the area is the same page as `--help`, the way `help` after `eval` is.
    if (positionals[0] === 'help' && (area === 'triggers' || area === 'bakeoff')) return console.log(evalHelp([area, ...positionals.slice(1)]));
    if (area === 'triggers') return triggers({ values, _: positionals });
    if (area === 'bakeoff') return bakeoff({ values, _: positionals });
    throw new CliError(`100x eval takes triggers or bakeoff, and ${area} is neither. Run \`100x eval --help\`.`);
  },
};

function parse(where, rest) {
  try {
    return parseArgs({
      args: rest,
      allowPositionals: true,
      options: { set: { type: 'string' }, file: { type: 'string' }, min: { type: 'string' }, json: { type: 'boolean' }, briefs: { type: 'string' }, arms: { type: 'string' }, seed: { type: 'string' }, minutes: { type: 'string' }, note: { type: 'string', multiple: true }, model: { type: 'string' }, ran: { type: 'string' }, source: { type: 'string' }, tokens: { type: 'string' }, 'no-capture': { type: 'boolean' }, out: { type: 'string' }, first: { type: 'string' }, pin: { type: 'boolean' }, allow: { type: 'string', multiple: true }, edit: { type: 'string', multiple: true }, save: { type: 'string' }, bundle: { type: 'string' }, 'blank-missing': { type: 'boolean' }, receipt: { type: 'string' }, 'no-write': { type: 'boolean' }, all: { type: 'boolean' } },
    });
  } catch (error) {
    if (!String(error.code ?? '').startsWith('ERR_PARSE_ARGS')) throw error;
    throw new CliError(`${error.message.split('. ')[0]}. The flags ${where} takes are in \`${where} --help\`.`);
  }
}
