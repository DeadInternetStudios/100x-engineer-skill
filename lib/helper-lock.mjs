import { CliError } from './errors.mjs';

// helper.only in the global config is "<model id> <parameter>=<value> ...", the one selection a helper on this machine may use. The Cursor SDK names a
// reasoning effort `reasoning_effort` and the window `context`. An app's subagent target names them `effort` or `reasoning_effort` and `contextWindow`.
// This file reads every spelling, so one lock holds for `100x helper run` and for a target handed to an app's subagent tool.
const EXAMPLE = '"claude-opus-5-5 reasoning_effort=max context=300k"';

// Compatibility forms folded (fullwidth letters, ligatures), and spaces and invisible characters (zero-width, soft hyphen) dropped, so 1ｍ and "1 m" and 1m with a hidden character read as 1m.
const clean = (value) => String(value).normalize('NFKC').replace(/[\s\p{Cf}]/gu, '').toLowerCase();
const text = (value) => (value === undefined || value === null || typeof value === 'object' ? null : clean(value) || null);
// contextWindow, context_window and ContextWindow are one parameter.
const fold = (id) => String(id).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
const EFFORT = ['reasoningeffort', 'effort'];
const WINDOW = ['context', 'contextwindow'];

// Every value a selection gives for a kind of parameter, whatever the spelling, so a target that asks for two things is seen asking for both.
const gather = (pairs, names) => [...new Set(pairs.filter(([id]) => names.includes(fold(id))).map(([, value]) => text(value)).filter(Boolean))];
// `odd` names the effort and window settings whose value is present and is not text (a number, a list, an object), which no consumer can be trusted to read the same way.
export const pairsSelection = (pairs) => {
  const efforts = gather(pairs, EFFORT);
  const windows = gather(pairs, WINDOW);
  const odd = pairs.filter(([id, value]) => [...EFFORT, ...WINDOW].includes(fold(id)) && value !== undefined && value !== null && typeof value !== 'string').map(([id]) => String(id));
  const idsOf = (names) => pairs.filter(([id, value]) => names.includes(fold(id)) && text(value) !== null).map(([id]) => String(id));
  return { efforts, windows, odd, effort: efforts[0] ?? null, window: windows[0] ?? null, effortIds: idsOf(EFFORT), windowIds: idsOf(WINDOW) };
};

// The first window of a list that is a million tokens or more, which is MAX mode on Cursor, or that is not a size at all. A window is a number with an optional k or m.
export function maxWindow(windows) {
  for (const window of windows) {
    const size = /^(\d+(?:\.\d+)?)([km])?$/.exec(window);
    if (!size) return { window, readable: false };
    if (Number(size[1]) * ({ k: 1e3, m: 1e6 }[size[2]] ?? 1) >= 1e6) return { window, readable: true };
  }
  return null;
}

export function parseOnly(only) {
  if (typeof only !== 'string') throw new CliError(`helper.only must be a string like ${EXAMPLE}. It is ${JSON.stringify(only)}.`);
  const [id, ...rest] = only.trim().split(/\s+/);
  if (!id) throw new CliError(`helper.only is empty. It must look like ${EXAMPLE}. \`100x config unset helper.only --global\` removes the lock.`);
  const shape = new CliError(`helper.only must look like "<model id> <parameter>=<value> ...", for example ${EXAMPLE}. It is "${only}".`);
  if (id.includes('=')) throw shape;
  const params = rest.map((item) => {
    const at = item.indexOf('=');
    if (at < 1) throw shape;
    const name = item.slice(0, at);
    const value = item.slice(at + 1);
    if (!value) throw new CliError(`helper.only gives ${name} no value. It is "${only}".`);
    return { id: name, value };
  });
  const kinds = params.map((p) => (EFFORT.includes(fold(p.id)) ? 'effort' : WINDOW.includes(fold(p.id)) ? 'context window' : fold(p.id)));
  const twice = kinds.find((kind, at) => kinds.indexOf(kind) !== at);
  if (twice) throw new CliError(`helper.only names the ${twice} twice, so it names no one selection. It is "${only}".`);
  const max = maxWindow(pairsSelection(params.map((p) => [p.id, p.value])).windows);
  if (max) throw new CliError(`helper.only names a ${max.window} context window, which is ${max.readable ? 'MAX mode on Cursor, and a helper never starts in MAX mode' : 'not a size 100x can read'}. Use context=300k.`);
  return { id, params };
}

// The model, effort and window of a lock, or of an object of options (a subagent target's, a role's).
export const lockSelection = (only) => {
  const { id, params } = parseOnly(only);
  return { id, ...pairsSelection(params.map((p) => [p.id, p.value])) };
};
export const optionsSelection = (options) => pairsSelection(options !== null && typeof options === 'object' && !Array.isArray(options) ? Object.entries(options) : []);

// A provider that is Cursor, or that names none, so it might be: the places where a 1m window is MAX mode and where the lock holds.
export const namesCursor = (provider) => String(provider ?? '').toLowerCase().includes('cursor');
// Fail closed: only a plain ASCII name without "cursor" in it is plainly another provider. A number, an object or a name with odd characters might be Cursor.
export const mayBeCursor = (provider) => {
  if (typeof provider !== 'string') return true;
  const name = provider.trim();
  return !name || !/^[a-z][a-z0-9._-]*$/i.test(name) || namesCursor(name);
};
export const isWindowName = (id) => WINDOW.includes(fold(id));

// Two selections are the same when the model and every setting are, whichever way the settings are spelled: reasoning_effort and effort, context and contextWindow.
const kindOf = (id) => (EFFORT.includes(fold(id)) ? 'effort' : WINDOW.includes(fold(id)) ? 'window' : fold(id));
export const selectionKey = ({ id, params }) => `${clean(id)}|${(params ?? []).map((p) => `${kindOf(p.id)}=${clean(p.value)}`).sort().join(',')}`;

// A command that writes a window of a million tokens or more after --context, which is MAX mode on Cursor whatever the settings say. A window that is a variable
// is whatever the target says, and the target was checked.
// Shell quotes, $'..' quoting, $IFS between the flag and its value, and a ; or ) after it are only spelling.
const unquoted = (command) => String(command ?? '').replace(/\$'/g, "'").replace(/["'\\]/g, '').replace(/\$\{IFS\}|\$IFS/g, ' ');
const flagValues = (command, flag) => [...unquoted(command).matchAll(new RegExp(`--${flag}(?:\\s|=)+([^\\s]+)`, 'gi'))].map(([, value]) => value.split(/[;|&()<>`]/)[0]).filter((value) => !/[$`]/.test(value));
export const hardCodesMax = (command) => flagValues(command, 'context').some((value) => maxWindow([clean(value)])?.readable === true);

// The models a command names for itself with a literal --model. A model that is a variable is whatever the target says, and the target was checked.
export const commandModels = (command) => flagValues(command, 'model');
export const sameId = (a, b) => text(a) === text(b);

// The subagent target of the locked selection, for a child or judge that would otherwise inherit whatever model the thread runs.
export function lockedTarget(only) {
  const { id, params } = parseOnly(only);
  const raw = (names) => params.find((p) => names.includes(fold(p.id)))?.value;
  return { providerInstanceId: 'cursor', model: id, options: { reasoning_effort: raw(EFFORT), contextWindow: raw(WINDOW) } };
}

// The command that sets a role to the locked selection.
export function lockedCommand(role, only) {
  const { model, options } = lockedTarget(only);
  const flags = Object.entries(options).filter(([, value]) => value !== undefined).map(([id, value]) => `--option ${id}=${value}`);
  return `100x config role ${role} --provider cursor --model ${model}${flags.length ? ` ${flags.join(' ')}` : ''} --global`;
}

// The locked selection runs on Cursor, so a provider that is named has to be a string that names it.
export const isCursorProvider = (provider) => provider === undefined || provider === null || provider === '' || (typeof provider === 'string' && namesCursor(provider));

// Null when the target is the locked selection, or the reason it is not.
export function outsideLock(target, only) {
  if (!only || !target?.model) return null;
  const lock = lockSelection(only);
  const asked = optionsSelection(target.options);
  // A setting the lock does not name is a setting the target may not name either, which is what `100x helper run` holds a selection to.
  const exactly = (list, want) => (want ? list.length === 1 && list[0] === want : list.length === 0);
  const providerOk = isCursorProvider(target.providerInstanceId);
  if (text(target.model) === text(lock.id) && exactly(asked.efforts, lock.effort) && exactly(asked.windows, lock.window) && providerOk) return null;
  const words = (id, efforts, windows) => `${id}${efforts.length || windows.length ? ` (${[efforts.length ? `effort ${efforts.join(' and ')}` : null, windows.length ? `window ${windows.join(' and ')}` : null].filter(Boolean).join(', ')})` : ''}`;
  return `is ${words(target.model, asked.efforts, asked.windows)}${providerOk ? '' : ` on the provider ${JSON.stringify(target.providerInstanceId)}`}, and helpers on this machine are locked to ${words(lock.id, lock.efforts, lock.windows)} by helper.only in the global config`;
}
