import fs from 'node:fs';
import { stateFile } from './project.mjs';

export const recordFile = (root) => stateFile(root, 'watchdog.json');

export function tickPrompt(root) {
  return [
    `WATCHDOG TICK for the 100x run in ${root}. This is an automatic message, not a request from the owner.`,
    'If you are working or waiting on a tool right now, ignore this message and carry on. Do not reply to it.',
    `If your last turn ended and the run is not finished, run \`100x status\` in ${root} and follow the first line that fits.`,
    `- Run FINISHED. Delete this scheduled task with your app's own tool, using the id in ${recordFile(root)}, run \`100x watchdog clear\`, and reply with the run summary once.`,
    '- A judge or helper you started has not reported back. Look once: a loop judge is done when its judge.md ends with the Drifting and Better lines, a stage 6 judge is done when .100x/review/findings.md ends with a Verdict section that has a Ready to ship line, and a night child is done when `100x night status` says it ended. Done: carry on with its result. Still running: do nothing, say nothing and end this turn, because its end wakes you. Never start a second one for the same loop.',
    '- Run NOT FINISHED. Read .100x/STATE.md and do what Next says. Nobody is awake. Do not ask the owner anything. Decide, log the decision with `100x log`, and keep going until `100x finish` succeeds.',
    '- The Clock line says to use all the time and work is left. Saying the run is done is wrong. `100x finish` refuses until the work time is over. Start the next round from references/fill.md of the 100x skill.',
    '- Your last turn failed or was interrupted. Log one line saying what went wrong, then continue from STATE.md.',
  ].join('\n');
}

export function record(root, scheduledTaskId, minutes) {
  fs.writeFileSync(recordFile(root), `${JSON.stringify({ scheduledTaskId, intervalMinutes: minutes, createdAt: new Date().toISOString() }, null, 2)}\n`);
}

export function clear(root) {
  const file = recordFile(root);
  const had = fs.existsSync(file);
  fs.rmSync(file, { force: true });
  return had;
}
