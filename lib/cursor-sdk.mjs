import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CliError } from './errors.mjs';
import { parseOnly, selectionKey } from './helper-lock.mjs';
import { globalDir } from './paths.mjs';

export const SDK_PACKAGE = '@cursor/sdk';
// The version this code was tested against, and the one `100x helper setup` installs. A run prints the version it used.
export const SDK_VERSION = '1.4.2';
export const SDK_HINT = `Run \`100x helper setup\` once. It installs @cursor/sdk@${SDK_VERSION} into ~/.100x.`;
export const LOGIN_HINT = 'Run `100x helper login` once to approve this machine in the browser, or set CURSOR_API_KEY.';

// The parameter that carries each shortcut flag, in the order a model's catalog entry is tried.
const EFFORT_IDS = ['reasoning_effort', 'effort'];
const CONTEXT_IDS = ['context', 'contextWindow'];

// The SDK is loaded from two places only: the folder named in X100_CURSOR_SDK_FROM, and ~/.100x where setup puts it. The folder a helper works in is not one of
// them, because a judge is pointed at a project and anything in that project would then run inside this command with the owner's login.
export function resolveSdk() {
  const bases = [process.env.X100_CURSOR_SDK_FROM, globalDir()].filter(Boolean);
  for (const base of bases) {
    try {
      const require = createRequire(path.join(base, 'resolve.js'));
      let dir = path.dirname(require.resolve(SDK_PACKAGE));
      while (!fs.existsSync(path.join(dir, 'package.json')) || JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name !== SDK_PACKAGE) dir = path.dirname(dir);
      const sdk = require(SDK_PACKAGE);
      if (sdk?.Agent && sdk?.Cursor) return { base, version: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, sdk };
    } catch {
      // try the next base
    }
  }
  return null;
}

export function requireSdk() {
  const found = resolveSdk();
  if (!found) throw new CliError(`The Cursor SDK is not installed. ${SDK_HINT}`);
  return found;
}

// An SDK error that means "not signed in" gets the one command that fixes it. Any other error is passed on as the SDK wrote it.
export function sdkFailure(error) {
  const text = error?.message ?? String(error);
  if (error?.name === 'AuthenticationError' || /api key|unauthori[sz]ed|not logged in|logged.?out/i.test(text)) return new CliError(`The Cursor SDK has no valid login. ${LOGIN_HINT} (${text})`);
  return new CliError(`The Cursor SDK failed before the helper ran: ${text}`);
}

const describeValues = (parameter) => parameter.values.map((v) => v.value).join('|');
const describeModel = (model) => `${model.id}${(model.parameters ?? []).map((p) => `  ${p.id}: ${describeValues(p)}`).join('')}`;
export { describeModel };

function parameterFor(model, ids, flag) {
  const found = (model.parameters ?? []).find((p) => ids.includes(p.id));
  if (!found) throw new CliError(`${model.id} has no parameter for ${flag}. Its parameters are ${(model.parameters ?? []).map((p) => p.id).join(', ') || 'none'}. Use --option <id>=<value> for those.`);
  return found.id;
}

const isWindow = (p) => CONTEXT_IDS.includes(p.id);

// MAX mode is not a switch the owner sets. The account's catalog lists one variant of a model for each combination of its parameters
// and marks the variants that cannot run outside MAX mode: on this account every 1m context window, and the model's own default
// variant, which is a 1m one. A selection that leaves the window open can therefore start in MAX mode without a word. The rule is that
// a helper never starts in MAX mode, and it fails closed: a selection is refused when any variant it could mean is a MAX one, when it
// matches no listed variant at all (the server then picks one, and nothing says it is not a MAX one), and when the model has a window
// but the catalog gives no variants to check it against.
function refuseMaxMode(model, params) {
  const variants = model.variants ?? [];
  const hasWindow = (model.parameters ?? []).some(isWindow);
  const named = params.some(isWindow);
  const matching = (wanted) => variants.filter((v) => wanted.every((p) => (v.params ?? []).some((q) => q.id === p.id && q.value === p.value)));
  const open = matching(params);
  // Every 1m window is a MAX mode variant on this account, so a named 1m is refused even when its variant carries no flag.
  const maxed = open.some((v) => v.isMaxMode) || params.some((p) => isWindow(p) && String(p.value).trim().toLowerCase() === '1m');
  const unlisted = variants.length > 0 && open.length === 0;
  const unknown = hasWindow && variants.length === 0;
  if (!maxed && !unlisted && !unknown) return;
  const windows = [...new Set(matching(params.filter((p) => !isWindow(p))).filter((v) => !v.isMaxMode).flatMap((v) => (v.params ?? []).filter(isWindow).map((p) => p.value)))].filter((value) => String(value).trim().toLowerCase() !== '1m');
  const outside = variants.filter((v) => !v.isMaxMode && !(v.params ?? []).some((p) => isWindow(p) && String(p.value).trim().toLowerCase() === '1m')).slice(0, 3).map((v) => (v.params ?? []).map((p) => `${p.id}=${p.value}`).join(' ')).join('; ');
  const why = unknown
    ? `The account's catalog lists no variants of ${model.id}, so nothing says its context window is not a MAX mode one.`
    : unlisted
      ? `No listed variant of ${model.id} has those parameters, so which one would run is not known.`
      : !hasWindow
        ? 'This selection can run in MAX mode.'
        : named
          ? `The window asked for is a MAX mode variant of ${model.id}.`
          : `It names no context window, and the account's default for ${model.id} is a MAX mode variant.`;
  const fix = unknown
    ? 'Use a model whose catalog entry lists variants. `100x helper models --json` shows which do.'
    : hasWindow && !unlisted
      ? windows.length ? `Name a window that runs outside MAX mode, ${windows.join(' or ')}, for example --context ${windows[0]}.` : `${model.id} has no variant with those parameters that runs outside MAX mode.`
      : outside ? `Variants that run outside MAX mode include ${outside}. \`100x helper models --json\` lists them all.` : `${model.id} has no variant that runs outside MAX mode.`;
  throw new CliError(`Refused: ${why} A helper never starts in MAX mode. ${fix}`);
}

// The selection the SDK is given, checked against the account's own catalog. A name or value the catalog does not list could
// fall back to another configuration without a word, and which configuration ran is the thing the owner asked to know.
export function chooseModel(catalog, { id, effort, context, options = [] }) {
  const model = catalog.find((m) => m.id === id);
  if (!model) throw new CliError(`${id} is not a model this account can use through the SDK. The catalog has: ${catalog.map((m) => m.id).join(', ')}. \`100x helper models\` lists them with their parameters.`);
  const wanted = [];
  if (effort) wanted.push({ id: parameterFor(model, EFFORT_IDS, '--effort'), value: effort });
  if (context) wanted.push({ id: parameterFor(model, CONTEXT_IDS, '--context'), value: context });
  for (const option of options) {
    const at = option.indexOf('=');
    if (at < 1) throw new CliError(`--option takes <id>=<value>, got "${option}".`);
    wanted.push({ id: option.slice(0, at), value: option.slice(at + 1) });
  }
  const params = [];
  for (const { id: paramId, value } of wanted) {
    const parameter = (model.parameters ?? []).find((p) => p.id === paramId);
    if (!parameter) throw new CliError(`${model.id} has no parameter ${paramId}. It has ${(model.parameters ?? []).map((p) => p.id).join(', ') || 'none'}.`);
    if (!parameter.values.some((v) => v.value === value)) throw new CliError(`${value} is not a value of ${model.id} ${paramId}. Its values are ${describeValues(parameter)}.`);
    if (params.some((p) => p.id === paramId)) throw new CliError(`${paramId} was given twice.`);
    params.push({ id: paramId, value });
  }
  refuseMaxMode(model, params);
  return params.length ? { id: model.id, params } : { id: model.id };
}

// A selection that is not exactly the one helper.only names (see lib/helper-lock.mjs, which reads every spelling of a setting) is refused before anything starts, whatever flags an agent was given.

export function refuseOutsideLock(selection, only) {
  if (!only) return;
  const rule = parseOnly(only);
  if (selectionKey(selection) === selectionKey(rule)) return;
  throw new CliError(`Refused: helpers on this machine are locked to ${modelWords(rule)} by helper.only in the global config, and this asked for ${modelWords(selection)}. \`100x config unset helper.only --global\` lifts the lock, and only the owner does that.`);
}

const paramMap = (selection) => Object.fromEntries((selection?.params ?? []).map((p) => [p.id, p.value]));

// Compare what was asked with what the SDK says ran. Only the parameters that were asked for are compared, because the rest were
// left to the server's default and the result may fill them in.
export function compareModels(requested, ran) {
  if (!ran?.id) return { state: 'unreported', differences: [] };
  const differences = [];
  if (ran.id !== requested.id) differences.push(`model ${requested.id} became ${ran.id}`);
  if (ran.maxMode === true) differences.push('MAX mode was on');
  const got = paramMap(ran);
  for (const [key, value] of Object.entries(paramMap(requested))) if (got[key] !== value) differences.push(`${key} ${value} became ${got[key] ?? 'not reported'}`);
  return { state: differences.length ? 'mismatch' : 'same', differences };
}

export const modelWords = (selection) => (selection?.id ? `${selection.id}${(selection.params ?? []).length ? ` (${selection.params.map((p) => `${p.id} ${p.value}`).join(', ')})` : ''}${selection.maxMode === true ? ', MAX mode' : ''}` : 'not reported');

// One helper, started through the SDK, run to its end. It never reads or prints a key.
export async function runHelper(sdk, { selection, task, cwd, minutes = null, onText = null }) {
  const started = Date.now();
  // The task tool is off inside a helper. A subagent that tool starts has its own model and window, which this check never sees and no receipt records, so a helper that needs another helper runs `100x helper run` itself.
  const agent = await sdk.Agent.create({ model: selection, local: { cwd }, disallowedTools: ['task'] });
  let timer = null;
  let timedOut = false;
  try {
    const run = await agent.send(task);
    if (minutes) {
      timer = setTimeout(() => {
        timedOut = true;
        if (run.supports('cancel')) run.cancel().catch(() => {});
      }, minutes * 60 * 1000);
    }
    for await (const event of run.stream()) {
      if (onText && event.type === 'assistant') for (const block of event.message.content) if (block.type === 'text') onText(block.text);
    }
    const result = await run.wait();
    const comparison = compareModels(selection, result.model);
    return {
      status: timedOut ? 'cancelled' : result.status,
      timedOut,
      text: result.result ?? '',
      error: result.error?.message ?? (typeof result.error === 'string' ? result.error : null),
      requested: selection,
      ran: result.model ?? null,
      modelCheck: comparison.state,
      differences: comparison.differences,
      seconds: Math.round(((result.durationMs ?? Date.now() - started) / 1000) * 10) / 10,
      tokens: result.usage?.totalTokens ?? null,
      reasoningTokens: result.usage?.reasoningTokens ?? null,
      agentId: agent.agentId,
      runId: run.id,
    };
  } finally {
    if (timer) clearTimeout(timer);
    await agent[Symbol.asyncDispose]?.();
  }
}
