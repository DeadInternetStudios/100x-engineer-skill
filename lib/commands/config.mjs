import { parseArgs } from 'node:util';
import * as cfg from '../config.mjs';
import { helperTarget } from '../delegate.mjs';
import { CliError } from '../errors.mjs';
import { GRIND_LIMIT, GRIND_STALL } from '../rounds.mjs';
import { plural } from '../text.mjs';

const usage = `
100x config
100x config print [--sources]
100x config get <path>
100x config set <path> <value> --global | --local
100x config unset <path> --global | --local
100x config path
100x config validate
100x config role <builder|review|fallback|quick|overnight> --model <id> [--provider <instance>] [--option id=value ...] --global | --local
100x config role <builder|fallback|quick|overnight> --clear --global | --local
100x config target <builder|review|fallback|quick|overnight>
100x config preset [lite|medium|standard] --global | --local

\`100x config\` alone says in plain words who judges, who builds and how much polish. \`print\` is every setting as the tool reads it, as JSON.

Layers, lowest to highest. Built-in defaults, ~/.100x/config.json (global), <project>/.100x/config.json (local).
Values are JSON when they parse as JSON, otherwise plain strings. Example.
  100x config set review.model <model-id> --global
  100x config set polish.passes 5 --local

A preset moves a few settings together. \`lite\` is for a small plan: one polish pass, two judge rounds (the code, then
the ship test) and two features built ahead, so a run makes about 3 judge calls and not 8. \`standard\` takes those three
settings back to the usual. \`medium\` is in between: two polish passes, three judge rounds and three features built ahead, about
5 judge calls a run. None of them touches your models, the judge, the one careful test or the proof checks.
  100x config preset lite --global
  100x config preset standard --local

A role is one model and its options. \`role\` writes the whole role in one step, and sets any option the layers below
define but the new model does not take to null, so an old key never reaches the new model. \`target\` prints the
\`target\` object to pass to your app's subagent tool. An empty object means the child uses the thread's own model.
  100x config role review --provider <app-provider> --model <model-id> --option effort=max --option contextWindow=300k --global
  100x config role quick --model <model-id> --local
`;

function parseOptions(list = []) {
  const out = {};
  for (const item of list) {
    const at = item.indexOf('=');
    if (at < 1) throw new CliError(`Option "${item}" must look like id=value, for example effort=max.`);
    const raw = item.slice(at + 1);
    out[item.slice(0, at)] = raw === 'true' ? true : raw === 'false' ? false : raw;
  }
  return out;
}

function scopeOf(values) {
  if (Boolean(values.global) === Boolean(values.local)) throw new CliError('Pick one scope. Use --global or --local.');
  return values.global ? 'global' : 'local';
}

// A setting that changes who looks at the work, or what runs by itself, says so when it is set, where the person or agent
// setting it reads. The report and the final message say the same later. A global setting reaches every project, so its note says that.
function reviewNotes(key, scope) {
  if (key === 'review.command') return ['This command runs by itself, with approvals off and with your permissions. Use it on projects you wrote, never on one someone sent you.'];
  const { defaults, global, effective } = cfg.load();
  const here = scope === 'local';
  const now = here ? effective.review : cfg.merge(defaults, global).review;
  const usual = (dotted) => (here ? cfg.usualValue(dotted) : cfg.getPath(defaults, dotted));
  if (key === 'review.enabled' && now.enabled === false && usual(key) !== false) {
    return [here ? 'Review is off for this project. The report and the final message say that no judge looked at it.' : 'Review is off for every project that does not turn it back on for itself. The report and the final message of each run say that no judge looked at it.'];
  }
  if (key === 'review.grind' && now.grind) {
    const stops = `until a judge says it is ready to ship, until ${GRIND_STALL} ship tests in a row bring nothing better, or until ${GRIND_LIMIT} rounds are held. That can take hours`;
    return [here ? `This project keeps judging past its usual rounds ${stops}.` : `Every project that does not set its own keeps judging past its usual rounds ${stops}.`];
  }
  const rounds = usual('review.rounds');
  if (key === 'review.rounds' && now.rounds < rounds) {
    return [here ? `This project asks for fewer judge rounds than the usual ${rounds}. The report and the final message say so.` : `Every project that does not set its own asks for fewer judge rounds than the usual ${rounds}. The report and the final message of each run say so.`];
  }
  return [];
}

// Who looks at the work, said the way the report says it.
function judgeWords(review) {
  if (!review.enabled) return 'Nobody. Review is off, so the report and the final message say that no judge looked at it.';
  const rounds = review.grind ? `${plural(review.rounds, 'round')}, then more for as long as no judge says it is ready to ship.` : `Up to ${plural(review.rounds, 'round')} before it ships.`;
  if (review.command) return `A command that runs on this machine${review.model ? `, model ${review.model}` : ''}. ${rounds}`;
  if (review.model) return `${review.model}${review.provider ? ` through ${review.provider}` : ''}. ${rounds}`;
  return `Not chosen yet. Call 100x-setup to pick one. Until then the run asks the agent to pick a model from another vendor, or marks the project UNREVIEWED. ${rounds}`;
}

// What an owner decides with, in the words the report uses. `config print` has every setting.
function plainSummary(loaded) {
  const { review, builder, polish, subagents, morning, budget } = loaded.effective;
  const lines = [
    `Who judges. ${judgeWords(review)}`,
    `Who builds. ${builder.model ?? 'The model of the thread you start it in.'}`,
    `Polish. ${polish.passes === 1 ? '1 pass' : `${polish.passes} passes`} after the build.${['lite', 'medium'].includes(cfg.presetOf(loaded.effective)) ? ` ${cfg.presetOf(loaded.effective) === 'lite' ? 'Lite' : 'Medium'} is on, so about ${cfg.judgeCalls(loaded.effective)} judge calls a run. Tokens the thread itself uses are not counted.` : ''}`,
    `Helpers. At most ${subagents.atOnce} at once.${budget.tokens === null ? '' : ` A run stops starting helpers at ${budget.tokens.toLocaleString('en-US')} tokens.`}`,
    `Report page. The last ${plural(morning.windowHours, 'hour')} of finished runs.`,
    `Files. Yours is ${loaded.files.global}. This project's is ${loaded.files.local ?? 'none, you are not inside a project with .100x'}.`,
  ];
  if (loaded.problems.some((problem) => problem.level === 'error')) lines.push('Problem. A settings file is wrong. `100x config validate` says where.');
  lines.push('', 'Change one with `100x config set <path> <value> --global` (or --local). `100x config print` shows every setting as the tool reads it.');
  return lines.join('\n');
}

export default {
  name: 'config',
  summary: 'Show or change settings (defaults, global, project).',
  usage,
  async run(argv) {
    const [sub = 'summary', ...rest] = argv;
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        global: { type: 'boolean' },
        local: { type: 'boolean' },
        sources: { type: 'boolean' },
        model: { type: 'string' },
        provider: { type: 'string' },
        option: { type: 'string', multiple: true },
        clear: { type: 'boolean' },
      },
    });
    const loaded = cfg.load();

    if (sub === 'summary') {
      console.log(plainSummary(loaded));
    } else if (sub === 'print') {
      const body = values.sources ? { files: loaded.files, global: loaded.global, local: loaded.local, effective: loaded.effective } : loaded.effective;
      console.log(JSON.stringify(body, null, 2));
    } else if (sub === 'get') {
      const key = positionals[0];
      if (!key) throw new CliError('Usage: 100x config get <path>');
      const value = cfg.getPath(loaded.effective, key);
      if (value === undefined) throw new CliError(`${key} is not set.`);
      console.log(typeof value === 'string' ? value : JSON.stringify(value));
    } else if (sub === 'set') {
      const [key, value] = positionals;
      if (!key || value === undefined) throw new CliError('Usage: 100x config set <path> <value> --global | --local');
      if (!cfg.isKnownPath(key)) throw new CliError(`${key} is not a known setting. Run \`100x config print\` to see them.`);
      const scope = scopeOf(values);
      const file = cfg.writeScope(scope, (object) => cfg.setPath(object, key, cfg.coerce(value)));
      console.log(`wrote ${file}\n${key} = ${JSON.stringify(cfg.getPath(cfg.load().effective, key))}`);
      for (const note of reviewNotes(key, scope)) console.log(note);
    } else if (sub === 'unset') {
      const [key] = positionals;
      if (!key) throw new CliError('Usage: 100x config unset <path> --global | --local');
      const file = cfg.writeScope(scopeOf(values), (object) => cfg.unsetPath(object, key));
      console.log(`wrote ${file}\n${key} = ${JSON.stringify(cfg.getPath(cfg.load().effective, key))}`);
    } else if (sub === 'role') {
      const [role] = positionals;
      if (!cfg.ROLES.includes(role)) throw new CliError(`Usage: 100x config role <${cfg.ROLES.join('|')}> --model <id> ... --global | --local`);
      if (Boolean(values.clear) === Boolean(values.model)) throw new CliError('Give --model <id>, or --clear to go back to the thread\'s own model.');
      const scope = scopeOf(values);
      const lower = scope === 'global' ? cfg.DEFAULTS : cfg.merge(cfg.DEFAULTS, loaded.global);
      const roleSettings = { provider: values.provider, model: values.model, options: parseOptions(values.option), clear: Boolean(values.clear) };
      const file = cfg.writeScope(scope, (object) => cfg.applyRole(object, role, roleSettings, lower));
      const written = cfg.load().effective;
      let shown;
      try {
        shown = JSON.stringify(['review', 'fallback', 'overnight'].includes(role) ? helperTarget(written, role, `${role} role`) : cfg.targetFor(written, role));
      } catch (error) {
        shown = `not a target a helper may start on. ${error.message}`;
      }
      console.log(`wrote ${file}\n${role} = ${shown}`);
    } else if (sub === 'target') {
      const [role] = positionals;
      if (!cfg.ROLES.includes(role)) throw new CliError(`Usage: 100x config target <${cfg.ROLES.join('|')}>`);
      // The builder and the quick jobs are the thread's own model, which 100x only checks. The judges and the overnight children are helpers, so they get what a helper may use.
      console.log(JSON.stringify(['review', 'fallback', 'overnight'].includes(role) ? helperTarget(loaded.effective, role, `${role} role`) : cfg.targetFor(loaded.effective, role)));
    } else if (sub === 'preset') {
      const [name] = positionals;
      if (name === undefined) {
        console.log(`Now. ${cfg.presetOf(loaded.effective)}. About ${cfg.judgeCalls(loaded.effective)} judge calls a run.\n\nlite. 1 polish pass, 2 judge rounds, 2 features built ahead. About 3 judge calls a run and not 8. For a small plan.\nmedium. 2 polish passes, 3 judge rounds, 3 features built ahead. About 5 judge calls a run and not 8. For a plan with some room.\nstandard. 3 polish passes, 5 judge rounds, 5 features built ahead. The usual.\n\nPick one with \`100x config preset <lite|medium|standard> --global\` (or --local).`);
        return undefined;
      }
      if (!(name in cfg.PRESETS)) throw new CliError(`There is no preset "${name}". The presets are ${Object.keys(cfg.PRESETS).slice(0, -1).join(', ')} and ${Object.keys(cfg.PRESETS).at(-1)}.`);
      const scope = scopeOf(values);
      const file = cfg.writeScope(scope, (object) => {
        for (const key of cfg.PRESET_KEYS) {
          if (cfg.PRESETS[name]) cfg.setPath(object, key, cfg.PRESETS[name][key]);
          else cfg.unsetPath(object, key);
        }
      });
      const written = cfg.load().effective;
      const where = scope === 'global' ? 'for every project that does not set its own' : 'for this project';
      console.log(`wrote ${file}`);
      if (name !== 'standard') console.log(`${name === 'lite' ? 'Lite' : 'Medium'} is on ${where}. ${`${written.polish.passes} polish pass${written.polish.passes === 1 ? '' : 'es'}`}, ${plural(written.review.rounds, 'judge round')}, ${plural(written.depth.max, 'feature')} built ahead. About ${cfg.judgeCalls(written)} judge calls a run and not ${cfg.judgeCalls(cfg.DEFAULTS)}.`);
      else console.log(`The usual is back ${where}. ${`${written.polish.passes} polish pass${written.polish.passes === 1 ? '' : 'es'}`}, ${plural(written.review.rounds, 'judge round')}, ${plural(written.depth.max, 'feature')} built ahead.`);
      if (name !== 'standard') console.log('Your models, the judge in every loop and the careful test of the one thing that must not break stay as they were. The report and the final message say that a run took fewer passes and rounds than usual.');
    } else if (sub === 'path') {
      console.log(`global ${loaded.files.global}\nlocal  ${loaded.files.local ?? 'none (not inside a project with .100x)'}`);
    } else if (sub === 'validate') {
      if (!loaded.problems.length) return console.log('config ok');
      for (const p of loaded.problems) console.log(`${p.level} ${p.path} ${p.message}`);
      if (loaded.problems.some((p) => p.level === 'error')) process.exitCode = 1;
    } else {
      throw new CliError(`unknown config command "${sub}". Run \`100x help config\`.`);
    }
    return undefined;
  },
};
