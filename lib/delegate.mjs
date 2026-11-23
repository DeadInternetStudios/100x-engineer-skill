import { CliError } from './errors.mjs';
import { targetFor } from './config.mjs';
import { commandModels, hardCodesMax, isCursorProvider, lockedCommand, lockedTarget, lockSelection, maxWindow, mayBeCursor, optionsSelection, outsideLock, sameId } from './helper-lock.mjs';

// What a target may ask for before it is handed to an app's subagent tool or a judge command. 100x cannot see the catalog here, so it checks what it can
// know offline. A 1m window is a MAX mode variant of every model that lists one on Cursor, and a helper never starts in MAX mode. A target on Cursor, or
// on a provider that might be Cursor, is refused when it asks for 1m or a size it cannot read, when a value is not text, and when it asks for two values of
// one setting. Where helper.only is set, every target is the locked selection whatever its provider, because the lock is one model and its settings for
// every helper on the machine. A target with no model means "the model this thread runs", which nothing can check, so under a lock it becomes the locked
// selection whatever options it carries. Without a lock, a target on a provider that plainly is not Cursor is not 100x's to limit.
const OPTIONS_PATH = { review: 'review.options', fallback: 'review.fallbackOptions', overnight: 'overnight.options' };

export function checkTarget(target, what, { only = null, role = '<role>' } = {}) {
  if (!target) return target;
  const cursor = mayBeCursor(target.providerInstanceId);
  const asked = optionsSelection(target.options);
  if (cursor) {
    if (target.model !== undefined && target.model !== null && typeof target.model !== 'string') throw new CliError(`The ${what} names its model as ${JSON.stringify(target.model)}, and a model is a text id like claude-opus-5-5.`);
    if (asked.odd.length) throw new CliError(`The ${what} gives ${asked.odd.join(' and ')} as something other than text, and an effort or a window is text like "max" or "300k".`);
    const max = maxWindow(asked.windows);
    if (max) {
      const fix = `Run \`100x config role ${role} --model ${target.model ?? '<model>'} --option contextWindow=300k --global\`.${target.providerInstanceId ? '' : ` If this model is not on Cursor, name its provider with \`--provider <app>\` and this check leaves it alone.`}`;
      throw new CliError(max.readable ? `The ${what} is set to a ${max.window} context window, which is MAX mode on Cursor, and a helper never starts in MAX mode. ${fix}` : `The ${what} sets a context window of "${max.window}", which is not a size 100x can read, so it cannot tell it from MAX mode on Cursor. ${fix}`);
    }
  }
  if (only && !target.model) {
    const locked = lockedTarget(only);
    return { ...target, ...locked, providerInstanceId: target.providerInstanceId && isCursorProvider(target.providerInstanceId) ? target.providerInstanceId : locked.providerInstanceId };
  }
  if (cursor) {
    const twice = asked.efforts.length > 1 ? ['effort', asked.efforts, asked.effortIds] : asked.windows.length > 1 ? ['context window', asked.windows, asked.windowIds] : null;
    if (twice) {
      const path = OPTIONS_PATH[role] ?? '<role>.options';
      throw new CliError(`The ${what} sets its ${twice[0]} twice, to ${twice[1].join(' and ')}, so it asks for no one selection. Keep one of ${twice[2].join(', ')} and remove the others with ${twice[2].map((id) => `\`100x config unset ${path}.${id}\``).join(' or ')}, adding --global or --local for the file that holds it.`);
    }
  }
  const outside = outsideLock(target, only);
  if (outside) throw new CliError(`The ${what} ${outside}. \`${lockedCommand(role, only)}\` sets it, or the owner lifts the lock with \`100x config unset helper.only --global\`.`);
  return target;
}

// The target of a role a helper starts on, checked against what a helper may use. A judge with no model set is the locked selection when there is a lock.
export function helperTarget(config, role, what) {
  const only = config.helper?.only ?? null;
  return checkTarget(targetFor(config, role) ?? (only && role === 'review' ? {} : null), what, { only, role });
}

// A judge command that hard-codes a 1m window on Cursor, whatever the role's own setting says.
export function checkCommand(command, provider, what, { only = null } = {}) {
  if (command && mayBeCursor(provider) && hardCodesMax(command)) {
    throw new CliError(`The ${what} command passes --context 1m, which is MAX mode on Cursor, and a helper never starts in MAX mode. Run \`100x config unset review.command --global\` and set the SDK line from \`100x ref apps\`.`);
  }
  const other = only && command ? commandModels(command).find((model) => !sameId(model, lockSelection(only).id)) : null;
  if (other) throw new CliError(`The ${what} command names the model ${other} itself, and helpers on this machine are locked to ${lockSelection(only).id} by helper.only in the global config. Let it read $X100_MODEL, as \`100x ref apps\` shows, or run \`100x config unset review.command --global\`.`);
}

// The app's own subagent tool is the Task tool in Cursor, which ran Composer for every helper whatever model was asked. In Cursor a helper starts through
// the SDK, so every line that says "pass this to your subagent tool" says that too, with the flags this target asks for. A 1m window is never printed.
export function cursorRoute(target) {
  const { effort, window } = optionsSelection(target?.options);
  const flags = [`--model ${target?.model ?? '<model>'}`, effort ? `--effort ${effort}` : null, `--context ${!window || maxWindow([window]) ? '300k' : window}`].filter(Boolean).join(' ');
  return `In Cursor the Task tool is not that tool, so never use it: run \`100x helper run ${flags} --task-file <file> --cwd <folder>\` with block_until_ms 0 instead.`;
}
