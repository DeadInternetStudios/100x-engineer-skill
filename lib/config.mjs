import fs from 'node:fs';
import path from 'node:path';
import DEFAULTS from './config.defaults.json' with { type: 'json' };
import { badJson, CliError } from './errors.mjs';
import { parseOnly } from './helper-lock.mjs';
import { findProjectRoot, globalDir } from './paths.mjs';
import { writeJson } from './write-json.mjs';

export { DEFAULTS };

const SCHEMA = {
  'review.enabled': { type: 'boolean' },
  'review.provider': { type: ['string', 'null'] },
  'review.driverKind': { type: ['string', 'null'] },
  'review.model': { type: ['string', 'null'] },
  'review.command': { type: ['string', 'null'] },
  'review.options': { type: 'object' },
  'review.fallbackModel': { type: ['string', 'null'] },
  'review.fallbackOptions': { type: 'object' },
  'review.timeoutMinutes': { type: 'number', min: 1 },
  'review.rounds': { type: 'number', min: 1, max: 10 },
  'review.grind': { type: 'boolean' },
  'builder.provider': { type: ['string', 'null'] },
  'builder.model': { type: ['string', 'null'] },
  'builder.options': { type: 'object' },
  'quick.provider': { type: ['string', 'null'] },
  'quick.model': { type: ['string', 'null'] },
  'quick.options': { type: 'object' },
  'overnight.provider': { type: ['string', 'null'] },
  'overnight.model': { type: ['string', 'null'] },
  'overnight.options': { type: 'object' },
  'core.enabled': { type: 'boolean' },
  'verify.enabled': { type: 'boolean' },
  'polish.passes': { type: 'number', min: 0, max: 10 },
  'polish.dudPasses': { type: 'number', min: 0, max: 10 },
  'depth.predictedFollowups': { type: 'boolean' },
  'depth.max': { type: 'number', min: 0, max: 12 },
  'variants.count': { type: 'number', min: 1, max: 12 },
  'variants.parallel': { type: 'boolean' },
  'subagents.atOnce': { type: 'number', min: 1, max: 32, whole: true },
  'helper.only': { type: ['string', 'null'], lock: true },
  'helper.ceiling': { type: ['number', 'null'], min: 1, max: 32, whole: true },
  'test.budget': { enum: ['quick-only', 'after-polish', 'full'] },
  'deploy.preview': { enum: ['auto', 'ask', 'off'] },
  'deploy.prod': { enum: ['on-say-so', 'never'] },
  'deploy.previewCommand': { type: ['string', 'null'] },
  'watchdog.mode': { enum: ['schedule', 'off'] },
  'watchdog.intervalMinutes': { type: 'number', min: 1 },
  'morning.windowHours': { type: 'number', min: 1 },
  'budget.tokens': { type: ['number', 'null'], min: 1 },
};

const GLOBAL_ONLY = ['helper.only', 'helper.ceiling'];
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const FREE_FORM = new Set(['review.options', 'review.fallbackOptions', 'builder.options', 'quick.options', 'overnight.options']);
const META = new Set(['version']);

export function isKnownPath(dotted) {
  return dotted in SCHEMA || [...FREE_FORM].some((free) => dotted === free || dotted.startsWith(`${free}.`));
}

export function merge(base, over) {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return over;
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(over)) out[key] = merge(out[key], value);
  return out;
}

export function getPath(object, dotted) {
  return dotted.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), object);
}

export function setPath(object, dotted, value) {
  const keys = dotted.split('.');
  let node = object;
  for (const key of keys.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== 'object' || Array.isArray(node[key])) node[key] = {};
    node = node[key];
  }
  node[keys.at(-1)] = value;
  return object;
}

export function unsetPath(object, dotted) {
  const keys = dotted.split('.');
  let node = object;
  for (const key of keys.slice(0, -1)) {
    if (!node || typeof node[key] !== 'object') return object;
    node = node[key];
  }
  delete node[keys.at(-1)];
  return object;
}

export function coerce(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function readJson(file) {
  if (!file || !fs.existsSync(file)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw badJson(file, error, 'the defaults apply again');
  }
  // A file of "x", 5, [] or null is valid JSON and would take down every command that merges it, so it is refused like a typo is.
  if (!plain(parsed)) throw badJson(file, new Error(`The file holds ${parsed === null ? 'null' : Array.isArray(parsed) ? 'an array' : `a ${typeof parsed}`}, and a config file is a JSON object`), 'the defaults apply again');
  return parsed;
}

export function files({ cwd = process.cwd() } = {}) {
  const root = findProjectRoot(cwd);
  return {
    global: path.join(globalDir(), 'config.json'),
    local: root ? path.join(root, '.100x', 'config.json') : null,
    projectRoot: root,
  };
}

export function validate(config) {
  const problems = [];
  for (const [key, rule] of Object.entries(SCHEMA)) {
    const value = getPath(config, key);
    if (value === undefined) continue;
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (rule.enum && !rule.enum.includes(value)) {
      problems.push({ level: 'error', path: key, message: `must be one of ${rule.enum.join(', ')}. Got ${JSON.stringify(value)}.` });
    } else if (rule.type && ![].concat(rule.type).includes(kind)) {
      problems.push({ level: 'error', path: key, message: `must be ${[].concat(rule.type).join(' or ')}. Got ${kind}.` });
    } else if (kind === 'number' && ((rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max))) {
      problems.push({ level: 'error', path: key, message: `must be between ${rule.min ?? '-inf'} and ${rule.max ?? 'inf'}. Got ${value}.` });
    } else if (kind === 'number' && rule.whole && !Number.isInteger(value)) {
      problems.push({ level: 'error', path: key, message: `must be a whole number. Got ${value}.` });
    } else if (rule.lock && kind === 'string') {
      try {
        parseOnly(value);
      } catch (error) {
        problems.push({ level: 'error', path: key, message: error.message.replace(/^helper\.only /, '') });
      }
    }
  }
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const here = prefix ? `${prefix}.${key}` : key;
      if (META.has(here) || FREE_FORM.has(here) || here in SCHEMA) continue;
      const known = Object.keys(SCHEMA).some((schemaKey) => schemaKey.startsWith(`${here}.`));
      if (known && value && typeof value === 'object' && !Array.isArray(value)) walk(value, here);
      else problems.push({ level: 'warn', path: here, message: 'unknown setting, ignored.' });
    }
  };
  walk(config, '');
  return problems;
}

export function load({ cwd = process.cwd() } = {}) {
  const where = files({ cwd });
  const globalConfig = readJson(where.global);
  const localConfig = readJson(where.local);
  const effective = merge(merge(DEFAULTS, globalConfig), localConfig);
  const problems = [];
  // A project file that sets a whole section to a string, a number, an array or null would replace the section and everything the owner put in it, so a
  // section that is not an object goes back to the owner's value.
  for (const section of Object.keys(DEFAULTS)) {
    if (!plain(DEFAULTS[section]) || plain(effective[section])) continue;
    effective[section] = merge(DEFAULTS[section], plain(globalConfig?.[section]) ? globalConfig[section] : {});
    problems.push({ level: 'error', path: section, message: 'must be an object, so the value from the global config or the defaults applies.' });
  }
  // The owner's limits on helpers are a floor under every project, so a project file cannot lift or change them, and the section is never read from it.
  const owner = merge(DEFAULTS.helper, plain(globalConfig?.helper) ? globalConfig.helper : {});
  if (localConfig?.helper !== undefined) {
    for (const key of plain(localConfig.helper) ? Object.keys(localConfig.helper) : ['']) {
      problems.push({ level: 'error', path: key ? `helper.${key}` : 'helper', message: 'is the owner\'s limit on helpers, so it is read only from the global config. Set it with --global.' });
    }
  }
  effective.helper = owner;
  problems.push(...validate(effective));
  // A shell command in a project file would run for anyone who opens that project, so only the owner's global file may set it.
  if (localConfig?.review?.command !== undefined) {
    effective.review.command = globalConfig?.review?.command ?? DEFAULTS.review.command;
    problems.push({ level: 'error', path: 'review.command', message: 'is a shell command, so it is read only from the global config. Set it with --global.' });
  }
  const ceiling = effective.helper?.ceiling;
  if (ceiling && effective.subagents.atOnce > ceiling) {
    problems.push({ level: 'warn', path: 'subagents.atOnce', message: `is ${effective.subagents.atOnce}, above the ceiling of ${ceiling} in helper.ceiling, so ${ceiling} applies.` });
    effective.subagents.atOnce = ceiling;
  }
  return { defaults: DEFAULTS, global: globalConfig, local: localConfig, effective, files: where, problems };
}

// What a setting would be without this project's own file: the owner's global value, or the built-in one.
export function usualValue(dotted, options) {
  const { defaults, global } = load(options);
  return getPath(merge(defaults, global), dotted);
}

export function writeScope(scope, mutate, { cwd = process.cwd() } = {}) {
  const where = files({ cwd });
  const file = scope === 'global' ? where.global : where.local;
  if (!file) throw new CliError('No project .100x folder found here. Run `100x init` first, or use --global.');
  const current = readJson(file);
  const before = JSON.stringify(current);
  mutate(current);
  // A project file may already carry one of these keys, planted or old. Writing something else, or removing the key, must still work, so only a write that
  // changes the key is refused.
  const changed = (dotted) => getPath(current, dotted) !== undefined && JSON.stringify(getPath(JSON.parse(before), dotted)) !== JSON.stringify(getPath(current, dotted));
  if (scope !== 'global' && changed('review.command')) throw new CliError('review.command is a shell command, so it can only be set with --global.');
  for (const dotted of GLOBAL_ONLY) if (scope !== 'global' && changed(dotted)) throw new CliError(`${dotted} is the owner's limit on helpers, so it can only be set with --global.`);
  // A project file is never read for the owner's limits or the judge command, so a bad value planted there is not a reason to refuse a write that does not touch it.
  const problems = validate(merge(DEFAULTS, current)).filter((p) => p.level === 'error' && !(scope !== 'global' && [...GLOBAL_ONLY, 'review.command'].includes(p.path)));
  if (problems.length) throw new CliError(problems.map((p) => `${p.path} ${p.message}`).join('\n'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJson(file, current);
  return file;
}

// A preset is a few settings that move together, so an owner on a small plan asks for one thing and not four. `standard` has no values of its own: it takes the keys back to what is usual.
// Lite keeps the one careful test of the one thing that must not break (test.budget) and the judge in every loop. It does less of everything else: one polish pass, two judge rounds (the code, then the ship test) and two features built ahead.
// Medium sits between them, for a plan with room for more than lite: two polish passes, three judge rounds (the code, the UI and UX, then the ship test) and three features built ahead.
export const PRESETS = {
  lite: { 'polish.passes': 1, 'review.rounds': 2, 'depth.max': 2 },
  medium: { 'polish.passes': 2, 'review.rounds': 3, 'depth.max': 3 },
  standard: null,
};
export const PRESET_KEYS = Object.keys(PRESETS.lite);

// lite, medium, standard (every preset key is as the built-in defaults have it), or custom.
export function presetOf(effective) {
  for (const name of ['lite', 'medium']) {
    if (PRESET_KEYS.every((key) => getPath(effective, key) === PRESETS[name][key])) return name;
  }
  if (PRESET_KEYS.every((key) => getPath(effective, key) === getPath(DEFAULTS, key))) return 'standard';
  return 'custom';
}

// What a report compares a run against. The owner's usual value, except under lite or medium: each is a chosen reduction, and a run that took it must not read as an ordinary one just because the owner set it for every project.
export function reportedUsual(dotted, options) {
  const { defaults, effective } = load(options);
  return ['lite', 'medium'].includes(presetOf(effective)) ? getPath(defaults, dotted) : usualValue(dotted, options);
}

// How many times a fresh judge looks at a normal run: once for each polish pass and once for each review round. A grind adds more, so it is a floor then.
export const judgeCalls = (effective) => effective.polish.passes + effective.review.rounds;

export const ROLES = ['builder', 'review', 'fallback', 'quick', 'overnight'];

// A model that does not take an option has it set to null, so a default or a lower layer cannot leak a stale key into the call.
const liveOptions = (options) => Object.fromEntries(Object.entries(options ?? {}).filter(([, value]) => value !== null && value !== undefined));

// The `target` object for the app's subagent tool, or null when the role is not set. An empty object means the child inherits the thread's model.
// For the builder and the quick jobs it is the model the owner wants this thread to run, which 100x can only check and never switch.
// For the overnight model it is what the children of the overnight skill and of parallel variants start on.
export function targetFor(effective, role) {
  if (role === 'review' || role === 'fallback') {
    const { review } = effective;
    const model = role === 'review' ? review.model : review.fallbackModel;
    if (!model) return null;
    const target = { model };
    if (review.provider) target.providerInstanceId = review.provider;
    if (role === 'review' && review.driverKind) target.driverKind = review.driverKind;
    const options = liveOptions(role === 'review' ? review.options : review.fallbackOptions);
    if (Object.keys(options).length) target.options = options;
    return target;
  }
  const node = effective[role];
  const target = {};
  if (node.provider) target.providerInstanceId = node.provider;
  if (node.model) target.model = node.model;
  const options = liveOptions(node.options);
  if (Object.keys(options).length) target.options = options;
  return target;
}

// Writes one role into one layer. `lower` is the merged config beneath that layer.
export function applyRole(object, role, { provider, model, options = {}, clear = false }, lower) {
  const withNulls = (given, dotted) => {
    const out = { ...given };
    for (const key of Object.keys(getPath(lower, dotted) ?? {})) if (!(key in out)) out[key] = null;
    return out;
  };
  if (role === 'review') {
    if (clear) throw new CliError('The reviewer cannot be cleared. Turn it off with `100x config set review.enabled false --global`.');
    if (provider) setPath(object, 'review.provider', provider);
    setPath(object, 'review.model', model);
    setPath(object, 'review.options', withNulls(options, 'review.options'));
  } else if (role === 'fallback') {
    setPath(object, 'review.fallbackModel', clear ? null : model);
    setPath(object, 'review.fallbackOptions', withNulls(clear ? {} : options, 'review.fallbackOptions'));
  } else {
    const base = role;
    setPath(object, `${base}.provider`, clear ? null : provider ?? null);
    setPath(object, `${base}.model`, clear ? null : model);
    setPath(object, `${base}.options`, withNulls(clear ? {} : options, `${base}.options`));
  }
}
