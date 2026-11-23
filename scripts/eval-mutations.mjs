#!/usr/bin/env node
// The numbers in a bake-off and a routing score must be right, so the tests that hold them must be able to fail. This plants one bug at a time in a
// throwaway copy of the repo, runs the eval tests, and requires every planted bug to turn them red. A bug that stays green is a hole in the tests.
//   node scripts/eval-mutations.mjs [--list] [--only <name>]... [--help]
// Exit 0 when the tests are green with no bug and red for every bug. Exit 1 otherwise, and 2 for a flag it does not know.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = ['test/eval-routing.test.mjs', 'test/eval-bakeoff.test.mjs', 'test/eval-bakeoff-grid.test.mjs', 'test/eval-bakeoff-guards.test.mjs', 'test/eval-pilot.test.mjs', 'test/eval-screens.test.mjs', 'test/eval-plan.test.mjs', 'test/routing-runner.test.mjs', 'test/eval-report.test.mjs', 'test/helper.test.mjs', 'test/doctor.test.mjs'];

// [name, file, the exact text to find, what to put there, the test files to run (all of TESTS when left out), { browser: true } to run the browser tests too]. The text must occur once, so a refactor that moves it makes this script say so.
export const MUTATIONS = [
  ['sign test counts one tail only', 'lib/eval/stats.mjs', 'Math.min(1, (2 * Number(tail)) / 2 ** n)', 'Math.min(1, Number(tail) / 2 ** n)'],
  ['sign test is not capped at 1', 'lib/eval/stats.mjs', 'Math.min(1, (2 * Number(tail)) / 2 ** n)', '(2 * Number(tail)) / 2 ** n'],
  ['sign test counts ties as a tail of the other side', 'lib/eval/stats.mjs', 'k <= Math.min(wins, losses)', 'k < Math.min(wins, losses)'],
  ['Wilson interval uses z of 1.645', 'lib/eval/stats.mjs', 'z = 1.96', 'z = 1.645'],
  ['median of an even count takes the upper middle', 'lib/eval/stats.mjs', '(sorted[middle - 1] + sorted[middle]) / 2', 'sorted[middle]'],
  ['the minimum of decisive pairs is 5', 'lib/eval/tally.mjs', 'export const MIN_DECISIVE = 6;', 'export const MIN_DECISIVE = 5;'],
  ['the threshold p is 0.1', 'lib/eval/tally.mjs', 'export const ALPHA = 0.05;', 'export const ALPHA = 0.1;'],
  ['a flip counts as a win', 'lib/eval/tally.mjs', "if (!sides.includes('tie')) return { outcome: 'flip', sides };", "if (!sides.includes('tie')) return { outcome: 'win', winner: item[sides[0]], sides };"],
  ['the second order is not swapped', 'lib/eval/tally.mjs', "(winner === 'A') === (order === 'o1')", "winner === 'A'"],
  ['a changed key is accepted', 'lib/eval/tally.mjs', 'if ((sealed || null) !== actual) throw', 'if (false) throw'],
  ['a judge is trusted without the controls', 'lib/eval/tally.mjs', 'const judgeTrusted = planted.length > 0 && identical.length > 0 && controls.every((c) => c.pass);', 'const judgeTrusted = true;'],
  ['the planted control accepts the blurred page', 'lib/eval/tally.mjs', "item.kind === 'planted' ? result.outcome === 'win' && result.winner === 'intact'", "item.kind === 'planted' ? result.outcome === 'win'"],
  ['the identical control accepts a winner', 'lib/eval/tally.mjs', ': result.outcome !== \'win\'', ': true'],
  ['a key sealed after the verdicts is accepted', 'lib/eval/tally.mjs', 'Math.min(...unquotedTimes) < sealedAt', 'false'],
  ['a missing leak scan is accepted', 'lib/eval/tally.mjs', 'if (!leak?.ok) withheld.push', 'if (false) withheld.push'],
  ['the leak scan never refuses', 'lib/eval/blind.mjs', 'if (hits.length) {', 'if (false) {'],
  ['the planted control is not blurred', 'lib/eval/blind.mjs', "if (label === 'blurred') blurCopy(folder);", ''],
  ['both orders show the same side in A', 'lib/eval/blind.mjs', "const sides = order === 'o1' ? { A: item.first, B: item.second } : { A: item.second, B: item.first };", 'const sides = { A: item.first, B: item.second };'],
  ['the arm writes about itself and the judge gets it', 'lib/eval/blind.mjs', "new Set(['RUN.md', 'STATE.md', 'TASK.md', 'MOCKUP.md', '.DS_Store'])", "new Set(['STATE.md', 'TASK.md', 'MOCKUP.md', '.DS_Store'])"],
  ['routing accuracy has the wrong denominator', 'lib/eval/routing.mjs', 'ratio(correct, prompts.length)', 'ratio(correct, prompts.length + 1)'],
  ['routing precision divides by the misses', 'lib/eval/routing.mjs', 'precision: ratio(c.tp, c.tp + c.fp)', 'precision: ratio(c.tp, c.tp + c.fn)'],
  ['routing recall divides by the false alarms', 'lib/eval/routing.mjs', 'recall: ratio(c.tp, c.tp + c.fn)', 'recall: ratio(c.tp, c.tp + c.fp)'],
  ['a blank page is written into the arm folder too', 'lib/eval/blind.mjs', "if (!fs.existsSync(path.join(folder, 'index.html'))) fs.writeFileSync(path.join(folder, 'index.html'), BLANK_PAGE);", "if (!fs.existsSync(path.join(folder, 'index.html'))) { fs.writeFileSync(path.join(folder, 'index.html'), BLANK_PAGE); fs.writeFileSync(path.join(armFolder(dir, config.arms, item.brief, arm), 'index.html'), BLANK_PAGE); }"],
  ['the planted control is made from a page that is missing', 'lib/eval/blind.mjs', 'const plantedFrom = controlFrom(config.briefs[0].id, config.arms[0], have[0]);', 'const plantedFrom = { brief: config.briefs[0].id, arm: config.arms[0] };'],
  ['pairs builds over a run that left no page without being told to', 'lib/eval/blind.mjs', 'if (missing.length && !blank) throw', 'if (false) throw'],
  ['arms on different models are accepted', 'lib/eval/tally.mjs', 'if (ranByArms.length > 1) withheld.push', 'if (false) withheld.push'],
  ['a run on the wrong model is not said in the headline', 'lib/eval/tally.mjs', "const caution = r.cautions.length ? ` Caution: ${r.cautions.join('; ')}.` : '';", "const caution = '';"],
  ['a verdict reason that names the skill is not checked', 'lib/eval/tally.mjs', 'if (named) tainted.push', 'if (false) tainted.push'],
  ['the folder an arm works in is not in the leak list', 'lib/eval/blind.mjs', "{ word: 'an arm folder', pattern: /\\barm-[12]\\b/i }, ...(labels ? LABELS : [])];", '...(labels ? LABELS : [])];'],
  ['an unequal effort is never said', 'lib/eval/tally.mjs', 'if (a === null || b === null || Math.abs(a - b) < 1 || Math.max(a, b) < 2 * Math.min(a, b)) return [];', 'return [];'],
  ['an unequal effort is always said', 'lib/eval/tally.mjs', 'if (a === null || b === null || Math.abs(a - b) < 1 || Math.max(a, b) < 2 * Math.min(a, b)) return [];', 'if (a === null || b === null) return [];'],
  ['a saved routing run is replayed against the prompts file as it is now', 'lib/eval/routing.mjs', "const triggers = { prompts: bundle.prompts.map((prompt) => ({ ...prompt, set: bundle.set })), distractors: [] };", 'const triggers = loadTriggers();'],
  ['scoring the all set is not a look at the holdout', 'lib/commands/eval.mjs', "const look = set === 'tune' ? null : recordHoldoutLook(result);", "const look = set === 'holdout' ? recordHoldoutLook(result) : null;"],
  ['a model the SDK reports under another id is not a mismatch', 'lib/cursor-sdk.mjs', "if (ran.id !== requested.id) differences.push(", "if (false) differences.push("],
  ['a parameter asked for is not compared with the one that ran', 'lib/cursor-sdk.mjs', "if (got[key] !== value) differences.push(", "if (false) differences.push("],
  ['a mismatch exits 0', 'lib/commands/helper.mjs', "result.modelCheck === 'mismatch' ? 3 :", "false ? 3 :"],
  ['a value the catalog does not list is accepted', 'lib/cursor-sdk.mjs', "if (!parameter.values.some((v) => v.value === value)) throw", "if (false) throw"],
  ['a model the catalog does not list is accepted', 'lib/cursor-sdk.mjs', "if (!model) throw new CliError(`${id} is not a model", "if (false) throw new CliError(`${id} is not a model"],
  ['a helper that did not finish exits 0', 'lib/commands/helper.mjs', "result.status === 'finished' ? 0 : 2", "0"],
  ['the deadline does not cancel the helper', 'lib/cursor-sdk.mjs', "if (run.supports('cancel')) run.cancel()", "if (false) run.cancel()"],
  ['a helper is not disposed', 'lib/cursor-sdk.mjs', "await agent[Symbol.asyncDispose]?.();", ""],
  ['a receipt-backed model is reported as typed by hand', 'lib/eval/tally.mjs', "m.backed ? 'receipt from the SDK result'", "false ? 'receipt from the SDK result'"],
  ['replaying a saved holdout run records a look', 'lib/eval/routing.mjs', "  return scoreRouting(triggers, bundle.answers, { set: bundle.set, skills: bundle.skills });\n", "  const scored = scoreRouting(triggers, bundle.answers, { set: bundle.set, skills: bundle.skills });\n  if (bundle.set === 'holdout') recordHoldoutLook(scored);\n  return scored;\n"],
  ['a name inside a binary file passes the leak scan', 'lib/eval/blind.mjs', 'if (!(picture && word.length < SHORT_WORD) && pattern.test(raw))', 'if (false)', ['test/eval-bakeoff-guards.test.mjs']],
  ['a file the scan could not read is accepted', 'lib/eval/blind.mjs', 'if (unscanned.length) {', 'if (false) {', ['test/eval-bakeoff-guards.test.mjs']],
  ['a symbolic link is not flagged', 'lib/eval/blind.mjs', 'if (entry.isSymbolicLink()) {', 'if (false) {', ['test/eval-bakeoff-guards.test.mjs']],
  ['a file over the size the scan reads is accepted', 'lib/eval/blind.mjs', 'if (size > MAX_SCAN_BYTES) {', 'if (false) {', ['test/eval-bakeoff-guards.test.mjs']],
  ['a sealed key needs no signature', 'lib/eval/tally.mjs', 'const signed = Boolean(secret) &&', 'const signed = true ||', ['test/eval-bakeoff-guards.test.mjs']],
  ['the key shape is not checked', 'lib/eval/tally.mjs', 'return { key: parseKey(text), hash: actual, signed };', 'return { key: JSON.parse(text), hash: actual, signed };', ['test/eval-bakeoff-guards.test.mjs']],
  ['the word is shown without the model of every arm run on record', 'lib/eval/tally.mjs', 'if (armUnrecorded.length) withheld.push(', 'if (false) withheld.push(', ['test/eval-bakeoff-guards.test.mjs']],
  ['the word is shown without the judge model on record', 'lib/eval/tally.mjs', 'if (judgeUnrecorded.length) withheld.push(', 'if (false) withheld.push(', ['test/eval-bakeoff-guards.test.mjs']],
  ['judges on two models are accepted', 'lib/eval/tally.mjs', 'if (ranByJudges.length > 1) withheld.push(', 'if (false) withheld.push(', ['test/eval-bakeoff-guards.test.mjs']],
  ['the gallery unblinds before the judging is over', 'lib/eval/pictures.mjs', 'if (result.missing.length || result.voided.length) {', 'if (false) {', ['test/eval-bakeoff-guards.test.mjs']],
  ['a number that is not a number is accepted by init and mark', 'lib/commands/eval.mjs', "const ok = value.trim() !== ''", "const ok = true || value.trim() !== ''", ['test/eval-bakeoff-guards.test.mjs']],
  ['a source that nothing knows is accepted by mark', 'lib/eval/blind.mjs', 'if (source !== null && !MODEL_SOURCES.includes(source))', 'if (false)', ['test/eval-bakeoff-guards.test.mjs']],
  ['an answers file for another set spends a look', 'lib/commands/eval.mjs', "if (result.unanswered === result.prompts) throw", "if (set === 'tune' && result.unanswered === result.prompts) throw", ['test/eval-routing.test.mjs']],
  ['an answer that is not a string is accepted', 'lib/eval/routing.mjs', "if (given !== undefined && given !== null && typeof given !== 'string') fail(", 'if (false) fail(', ['test/eval-routing.test.mjs']],
  ['the SDK is loaded from the folder a helper works in', 'lib/cursor-sdk.mjs', 'const bases = [process.env.X100_CURSOR_SDK_FROM, globalDir()]', 'const bases = [process.env.X100_CURSOR_SDK_FROM, process.cwd(), globalDir()]', ['test/helper.test.mjs']],
  ['the doctor reports the capped count as the count', 'lib/doctor.mjs', 'helpers.length > latest.length ?', 'false ?', ['test/doctor.test.mjs']],
  ["a typed model name backs the word ahead", "lib/eval/tally.mjs", "if (unbacked.length && leads) withheld.push(", "if (false) withheld.push(", ['test/eval-bakeoff-guards.test.mjs']],
  ["a typed model name is no caution when there is no lead", "lib/eval/tally.mjs", "if (unbacked.length && !leads) cautions.push(unbackedText);", "", ['test/eval-bakeoff-guards.test.mjs']],
  ["the judge records are not counted when receipts are checked", "lib/eval/tally.mjs", "const recordNames = [...armNames, ...new Set(judgeNames.map(judgeRecord))]", "const recordNames = [...armNames]", ['test/eval-bakeoff-guards.test.mjs']],
  ["a receipt that was edited is believed", "lib/receipt.mjs", "if (sealState(file) !== 'ok') throw new CliError(", "if (false) throw new CliError(", ['test/helper.test.mjs', 'test/eval-bakeoff-guards.test.mjs']],
  ["a kept receipt that changed still backs its record", "lib/receipt.mjs", "|| crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== sha) return 'typed';", ") return 'typed';", ['test/helper.test.mjs', 'test/eval-bakeoff-guards.test.mjs']],
  ["a kept receipt with the signature of another file still backs its record", "lib/receipt.mjs", "if (sealState(file) === 'ok') return 'backed';", "if (fs.existsSync(`${file}.seal`)) return 'backed';", ['test/eval-bakeoff-guards.test.mjs']],
  ["one receipt can back two runs", "lib/eval/blind.mjs", "if (twin) throw", "if (false) throw", ['test/eval-bakeoff-guards.test.mjs']],
  ["a receipt is taken with a typed name beside it", "lib/eval/blind.mjs", "if (receipt !== null && (model || ran || source || tokens !== null)) throw", "if (false) throw", ['test/eval-bakeoff-guards.test.mjs']],
  ["a receipt is taken at start", "lib/eval/blind.mjs", "if (receipt !== null && action !== 'stop') throw", "if (false) throw", ['test/eval-bakeoff-guards.test.mjs']],
  ["the settings of a receipt are not recorded", "lib/eval/blind.mjs", "params: receiptParams(said),", "params: {},", ['test/eval-bakeoff-guards.test.mjs']],
  ["two settings of one model count as one for the arms", "lib/eval/tally.mjs", "else if (setByArms.length > 1) withheld.push(", "else if (false) withheld.push(", ['test/eval-bakeoff-guards.test.mjs']],
  ["two settings of one model count as one for the judges", "lib/eval/tally.mjs", "else if (setByJudges.length > 1) withheld.push(", "else if (false) withheld.push(", ['test/eval-bakeoff-guards.test.mjs']],
  ["a verdict that quotes the key is placed by its file time anyway", "lib/eval/tally.mjs", "if (verdict.sealed === quoted) {", "if (false) {", ['test/eval-bakeoff-guards.test.mjs']],
  ["a verdict that quotes another key is accepted", "lib/eval/tally.mjs", "if (foreignQuote.length) withheld.push(", "if (false) withheld.push(", ['test/eval-bakeoff-guards.test.mjs']],
  ["ask.md does not carry the key hash", "lib/eval/blind.mjs", "fs.writeFileSync(path.join(pack, 'ask.md'), ASK(brief, sealed, shoot));", "fs.writeFileSync(path.join(pack, 'ask.md'), ASK(brief, '', shoot));", ['test/eval-bakeoff-guards.test.mjs']],
  ["score cannot print when it cannot write", "lib/commands/eval.mjs", "kept = `report.md and result.json were not written in ${dir} (${error.code ?? error.message}). The counts above are the same.`;", "throw error;", ['test/eval-bakeoff-guards.test.mjs']],
  ["--no-write still writes", "lib/commands/eval.mjs", "if (!args.values['no-write']) {", "if (true) {", ['test/eval-bakeoff-guards.test.mjs']],
  ["a note for an arm that is not there is dropped", "lib/eval/blind.mjs", "for (const arm of Object.keys(notes)) if (!arms.includes(arm)) throw", "for (const arm of Object.keys(notes)) if (false) throw", ['test/eval-bakeoff-guards.test.mjs']],
  ["a bake-off is made in a file", "lib/eval/blind.mjs", "if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) throw", "if (false) throw", ['test/eval-bakeoff-guards.test.mjs']],
  ["a briefs file that is not a list is taken as one", "lib/commands/eval.mjs", "if (!Array.isArray(list)) throw new CliError(", "if (false) throw new CliError(", ['test/eval-bakeoff-guards.test.mjs']],
  ["an empty set scores as a number", "lib/eval/routing.mjs", "if (chosen.length === 0) fail(", "if (false) fail(", ['test/eval-routing.test.mjs']],
  ["an answers entry that is not an answer crashes", "lib/commands/eval.mjs", "(a) => !a || typeof a !== 'object' || typeof a.id !== 'string'", "(a) => false", ['test/eval-routing.test.mjs']],
  ["a distractor with a skill's name is staged", "lib/eval/routing.mjs", "if (seenNames.has(distractor.name)) fail(", "if (false) fail(", ['test/eval-routing.test.mjs']],
  ["stage writes into a file", "lib/eval/routing.mjs", "if (fs.existsSync(outDir) && !fs.statSync(outDir).isDirectory()) fail(", "if (false) fail(", ['test/eval-routing.test.mjs']],
  ["a helper writes no receipt", "lib/commands/helper.mjs", "if (values.receipt) writeReceipt(path.resolve(values.receipt), result, version);", "", ['test/helper.test.mjs']],
  ["a withheld score exits 0", "lib/commands/eval.mjs", "if (result.verdict.withheld) process.exitCode = 2;\n    console.log(args.values.json", "console.log(args.values.json", ['test/eval-bakeoff.test.mjs', 'test/eval-screens.test.mjs']],
  ["ask.md promises screenshots that were not taken", "lib/eval/blind.mjs", "ASK(brief, sealed, shoot)", "ASK(brief, sealed, true)", ['test/eval-screens.test.mjs']],
  ["score prints the markdown file in the terminal", "lib/commands/eval.mjs", "bakeoffScreen(result, { dir, written, asked: Boolean(args.values['no-write']) }).trimEnd()", "report", ['test/eval-screens.test.mjs']],
  ["a typo in an answers file is not flagged", "lib/eval/routing.mjs", "if (answered !== null && !listed.has(answered)) unlisted.push({ id: prompt.id, answered });", "", ['test/eval-screens.test.mjs']],
  ["a wrong answer is cut short in the terminal", "lib/eval/routing.mjs", "wrap(`\"${w.text}\"`, { width: 96, indent: '    ' })", "`\"${w.text.slice(0, 87)}...\"`", ['test/eval-screens.test.mjs']],
  ["the list of wrong answers has no cap", "lib/eval/routing.mjs", "answered.slice(0, WRONG_SHOWN)", "answered", ['test/eval-screens.test.mjs']],
  ["status does not name the folders still waiting", "lib/commands/eval.mjs", "wrap(`Waiting: ${waiting.join(', ')}.`, { width: 96, indent: '  ' }),\n", "", ['test/eval-screens.test.mjs']],
  ["a command's own help prints every command", "lib/cli.mjs", "command.help ? command.help(words.filter((word) => !word.startsWith('-'))) : command.usage.trim()", "command.usage.trim()", ['test/eval-screens.test.mjs']],
  ["a count of one is pluralised", "lib/eval/words.mjs", "${count === 1 ? one : many}", "${many}", ['test/eval-screens.test.mjs', 'test/eval-bakeoff-guards.test.mjs']],
  ["a short run is reported in minutes", "lib/eval/words.mjs", "if (minutes < 1) {", "if (false) {", ['test/eval-screens.test.mjs']],
  ["doctor folds no skill rows", "lib/doctor.mjs", "group.length >= 3", "group.length >= 99", ['test/eval-screens.test.mjs']],
  ["doctor ends with no tally", "lib/doctor.mjs", "tally: `${count('fail')} fail, ${count('warn')} warn, ${count('ok')} ok.`", "tally: ''", ['test/eval-screens.test.mjs']],
  ["an unknown flag gets the runtime's own advice", "lib/commands/eval.mjs", "`${error.message.split('. ')[0]}. The flags", "`${error.message}. The flags", ['test/eval-screens.test.mjs']],
  ["eval help is not a synonym for eval --help", "lib/commands/eval.mjs", "if (area === undefined || area === 'help')", "if (area === undefined)", ['test/eval-screens.test.mjs']],
  ["an empty table is printed when no pair is judged", "lib/eval/tally.mjs", "if (r.pairs.length) {\n    lines.push('| pair | brief | result |'", "if (true) {\n    lines.push('| pair | brief | result |'", ['test/eval-screens.test.mjs']],
  ["status ignores an interrupted pairs run", "lib/commands/eval.mjs", "if (interrupted.length) lines.push(", "if (false) lines.push(", ['test/eval-screens.test.mjs']],
  ["the routing example uses ids that do not exist", "lib/eval/routing.mjs", "{ \"${first}\": \"some-skill\", \"${second}\": \"none\" }", "{ \"p-001\": \"some-skill\", \"p-002\": \"none\" }", ['test/eval-screens.test.mjs']],
  ["a leak is only found after the screenshots are taken", "lib/eval/blind.mjs", "    refuse(early.hits, early.unscanned);\n", "", ['test/eval-bakeoff-guards.test.mjs']],
  ["a leak in one page is counted once and not for each judge folder that holds it", "lib/eval/blind.mjs", "(item.copies ?? 1)", "1", ['test/eval-bakeoff-guards.test.mjs']],
  ["the report leaves out the cautions", "lib/eval/tally.mjs", "if (now.cautions.length) lines.push('**Caution:**', '', ...now.cautions.map((caution) => `- ${caution}.`), '');", "", ['test/eval-screens.test.mjs']],
  ["the report opens with the one-sentence headline", "lib/eval/tally.mjs", "const lines = ['# Bake-off report', '', now.counts, '', `**Verdict:** ${now.verdict.text}`, ''];", "const lines = ['# Bake-off report', '', r.headline, ''];", ['test/eval-bakeoff.test.mjs', 'test/eval-screens.test.mjs']],
  ["a flip on the identical page is called a tie", "lib/eval/tally.mjs", "c.outcome === 'flip' ? 'picked by place, not by page'", "c.outcome === 'flip' ? 'no winner'", ['test/eval-screens.test.mjs']],
  ["status prints the arm run without its folder and minutes", "lib/commands/eval.mjs", " --cwd ${shellPath(path.join(dir, built[todo].folder))} --minutes ${config.minutes}", "", ['test/eval-bakeoff.test.mjs']],
  ["status prints no judge command", "lib/commands/eval.mjs", "        `  100x eval bakeoff mark ${d} judge/${first} stop --receipt ${receipt(first)}`,\n", "", ['test/eval-screens.test.mjs']],
  ["a path with a space is not quoted in a printed command", "lib/eval/words.mjs", "(/^[\\w@%+=:,./-]+$/.test(text) ? text :", "(true ? text :", ['test/eval-screens.test.mjs']],
  ["a score with no key does not say what to run next", "lib/eval/tally.mjs", "`No key yet, so there is nothing to score. \\`100x eval bakeoff status ${shellPath(dir)}\\` says what to run next.`", "'No key yet.'", ['test/eval-screens.test.mjs']],
  ["help after the area is not a command", "lib/commands/eval.mjs", "if (positionals[0] === 'help' && (area === 'triggers' || area === 'bakeoff'))", "if (false)", ['test/eval-screens.test.mjs']],
  ["an unknown bake-off command is not named", "lib/commands/eval.mjs", ": `100x eval bakeoff has no command called ${action}`", ": '100x eval bakeoff has no command'", ['test/eval-screens.test.mjs']],
  ["the routing table does not say what its columns count", "lib/eval/routing.mjs", "expected: messages that needed it. answered: times it was picked.", "expected. answered.", ['test/eval-screens.test.mjs']],
  ["a run asked not to write is worded as a failure", "lib/eval/screen.mjs", "asked ? 'Nothing was written, as --no-write asked. Run score without it to get report.md.' : ", "", ['test/eval-bakeoff-guards.test.mjs']],
  ["a tune answers file that answers nothing is scored", "lib/commands/eval.mjs", "if (result.unanswered === result.prompts) throw", "if (set !== 'tune' && result.unanswered === result.prompts) throw", ['test/eval-screens.test.mjs']],
  ["an underscore or a spaced hyphen hides the arm name from the scan", "lib/eval/blind.mjs", "arm.split('-').map(escape).join('\\\\s*[-_]\\\\s*')", "escape(arm)", ['test/eval-bakeoff-guards.test.mjs']],
  ["100x is not searched for in a binary file that is not a picture", "lib/eval/blind.mjs", "!(picture && word.length < SHORT_WORD) && ", "word.length >= SHORT_WORD && ", ['test/eval-bakeoff-guards.test.mjs']],
  ["the plan counts fewer judge runs than there are", "lib/eval/plan.mjs", "const judges = (briefs + 2) * 2;", "const judges = briefs * 2;", ["test/eval-plan.test.mjs"]],
  ["the plan prices the arms once and not for every brief", "lib/eval/plan.mjs", "const tokens = briefs * rates.armTokens +", "const tokens = rates.armTokens +", ["test/eval-plan.test.mjs"]],
  ["the plan asks too little of the decisive pairs", "lib/eval/plan.mjs", "signTest(wins, decisive - wins) < ALPHA) return wins;", "signTest(wins, decisive - wins) < 0.5) return wins;", ["test/eval-plan.test.mjs"]],
  ["reach forgets the pairs still to be judged", "lib/eval/plan.mjs", "const wins = result.wins[arm] + pending;", "const wins = result.wins[arm];", ["test/eval-plan.test.mjs"]],
  ["reach speaks when every pair is in", "lib/eval/plan.mjs", "if (!pending) return null;", "", ["test/eval-plan.test.mjs"]],
  ["status does not say when ahead can no longer be reached", "lib/commands/eval.mjs", "const reached = waiting.length ? reachOf(dir) : null;", "const reached = null;", ["test/eval-plan.test.mjs"]],
  ["init prints no plan", "lib/commands/eval.mjs", "\\n${wrap(planText(briefs.length), { width: 110 })}", "", ["test/eval-plan.test.mjs"]],
  ["the mutation script does not answer --help", "scripts/eval-mutations.mjs", "if (values.help) {\n  console.log(USAGE);", "if (false) {\n  console.log(USAGE);", ["test/eval-screens.test.mjs"]],
  ["init does not record the protocol text it ran under", "lib/eval/blind.mjs", "protocol: crypto.createHash('sha256').update(fs.readFileSync(PROTOCOL_FILE)).digest('hex'), ", "", ['test/eval-bakeoff.test.mjs', 'test/eval-screens.test.mjs']],
  ["a rendered name is not scanned", "lib/eval/blind.mjs", "const shown = taken.rendered.filter(", "const shown = [].filter(", ['test/eval-bakeoff.test.mjs'], { browser: true }],
  ["the key does not record that the pages were run", "lib/eval/blind.mjs", "...(shoot ? { rendered: true } : {}), ", "", ['test/eval-bakeoff.test.mjs'], { browser: true }],
  ["the browser is not checked before the pages are photographed", "lib/eval/blind.mjs", "if (!browserReady()) throw", "if (false) throw", ['test/eval-bakeoff.test.mjs']],
  ["a screenshot error keeps its border characters", "lib/eval/blind.mjs", "line.replace(/[║╔╗╚╝═│┌┐└┘─]/g, '')", "line", ['test/eval-bakeoff-guards.test.mjs']],
  ["a judge on the arms' own model carries no caution", "lib/eval/tally.mjs", "if (shared.length) cautions.push(", "if (false) cautions.push(", ['test/eval-bakeoff.test.mjs', 'test/eval-pilot.test.mjs']],
  ["a judge on another model is cautioned as the arms' own", "lib/eval/tally.mjs", "const shared = judgeRanModels.filter((model) => ranByArms.some((arm) => sameModel(arm, model)));", "const shared = judgeRanModels;", ['test/eval-bakeoff.test.mjs']],
  ["a page that says UNREVIEWED is not refused", "lib/eval/blind.mjs", "{ word: 'unreviewed', pattern: /\\bunreviewed\\b/i }, ", "", ['test/eval-bakeoff-guards.test.mjs']],
  ["a page that says mockup is not refused", "lib/eval/blind.mjs", ", { word: 'mockup', pattern: /\\bmock-?ups?\\b/i }", "", ['test/eval-bakeoff-guards.test.mjs']],
  ["a page that says mockup is not counted as giving its arm away", "lib/eval/tally.mjs", "{ product: true }).hits.length > 0", "{ product: true }).hits.length > 99", ['test/eval-bakeoff-guards.test.mjs']],
  ["the pairs with a label are counted in the pairs left", "lib/eval/tally.mjs", "pairs.filter((pair) => !briefs.includes(pair.brief))", "pairs", ['test/eval-bakeoff-guards.test.mjs']],
  ["a key that scanned the words is cautioned about them anyway", "lib/eval/tally.mjs", "const labelled = key.labels === true ? [] :", "const labelled =", ['test/eval-bakeoff-guards.test.mjs']],
  ["a run made before the words were scanned is voided by them", "lib/eval/tally.mjs", "{ labels: key.labels === true }", "{ labels: true }", ['test/eval-bakeoff-guards.test.mjs']],
  ["the word is worked from every pair although some say the label", "lib/eval/tally.mjs", "const counted = aside ? { wins: aside.wins, decisive: aside.decisive, p: aside.p } : { wins, decisive, p };", "const counted = { wins, decisive, p };", ['test/eval-bakeoff-guards.test.mjs']],
  ["the hand edits are not kept in the leak record", "lib/eval/blind.mjs", "allowed: allow, edits, patterns:", "allowed: allow, patterns:", ['test/eval-bakeoff-guards.test.mjs']],
  ["the score does not say the hand edits", "lib/eval/tally.mjs", "if (edits.length) cautions.push(", "if (edits.length > 99) cautions.push(", ['test/eval-bakeoff-guards.test.mjs']],
  ["an arm is not told to leave the label off its page", "lib/eval/blind.mjs", 'Do not write the words "unreviewed" or "mockup" in any file in this folder', 'You may write the words "unreviewed" or "mockup" in any file in this folder', ['test/eval-bakeoff-guards.test.mjs']],
  ["a helper that ends is not counted in the ledger", "lib/commands/helper.mjs", "if (root) recordHelper(root,", "if (false) recordHelper(root,", ['test/helper.test.mjs']],
  ["the budget does not stop the next helper", "lib/commands/helper.mjs", "if (root) refuseWhenSpent(root);", "", ['test/helper.test.mjs']],
  ["a helper with no token count is not marked in the total", "lib/spend.mjs", "unreported: all.filter((row) => row.tokens === null).length,", "unreported: 0,", ['test/helper.test.mjs']],
  ["a receipt signed on another machine is called typed by hand", "lib/receipt.mjs", "return fs.existsSync(`${file}.seal`) ? 'other-machine' : 'typed';", "return 'typed';", ['test/eval-bakeoff-guards.test.mjs']],
  ["a lead that holds without the pairs that say the label is not ahead", "lib/eval/tally.mjs", "counted.wins[leader] > counted.wins[other]", "wins[leader] > wins[other] && !aside", ['test/eval-bakeoff-guards.test.mjs']],
  ["a rate-limited start counts as one of the three tries", "evals/runners/cursor-sdk.mjs", "        attempt -= 1;\n", "", ['test/routing-runner.test.mjs']],
  ["a run on another model than the one asked for goes on", "evals/runners/cursor-sdk.mjs", "if (last.code === 3) throw new Error", "if (false) throw new Error", ['test/routing-runner.test.mjs']],
  ["a message answered before is asked again", "evals/runners/cursor-sdk.mjs", "let skill = kept(prompt.id);", "let skill = null;", ['test/routing-runner.test.mjs']],
  ["the first skill named in a reply is taken and not the last", "evals/runners/cursor-sdk.mjs", "[...String(text).matchAll(/\\{[^{}]*\\}/g)].reverse()", "[...String(text).matchAll(/\\{[^{}]*\\}/g)]", ['test/routing-runner.test.mjs']],
  ["the routing helper works in a folder with files in it", "evals/runners/cursor-sdk.mjs", "'--cwd', where.empty,", "'--cwd', root,", ['test/routing-runner.test.mjs']],
  ["the routing helper is not told which model to run", "evals/runners/cursor-sdk.mjs", "'--model', values.model, ", "", ['test/routing-runner.test.mjs']],
];

const USAGE = `node scripts/eval-mutations.mjs [--list] [--only <name>]... [--help]
  --list   print the planted bugs, one a line
  --only   run only the bug with that name, and repeat the flag for more
  --help   print this
Exit 0 when the tests are green with no bug and red for every bug. 1 when a bug leaves them green, or they are red with no bug. 2 for a flag it does not know.`;
let values;
try {
  ({ values } = parseArgs({ options: { list: { type: 'boolean' }, only: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' } } }));
} catch (error) {
  console.error(`${error.message.split('. ')[0]}.\n${USAGE}`);
  process.exit(2);
}
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const chosen = ([name]) => !values.only || values.only.includes(name);

// The browser tests are skipped by X100_FAST, which keeps the list fast. A bug that only a browser test can see names `{ browser: true }` and runs them.
function runTests(cwd, files = TESTS, browser = false) {
  const env = { ...process.env };
  if (browser) delete env.X100_FAST;
  else env.X100_FAST = '1';
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=3', ...files], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = `${result.stdout}${result.stderr}`;
  const count = (label) => Number(new RegExp(`^ℹ ${label} (\\d+)`, 'm').exec(text)?.[1] ?? NaN);
  const failing = /✖ failing tests:\n+(?:test at [^\n]*\n)?✖ ([^\n(]+)/.exec(text)?.[1]?.trim() ?? null;
  return { status: result.status, pass: count('pass'), fail: count('fail'), first: failing };
}

if (values.list) {
  for (const [name, file] of MUTATIONS) console.log(`${name}  (${file})`);
  process.exit(0);
}

const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-mutations-'));
try {
  fs.cpSync(ROOT, copy, { recursive: true, filter: (source) => !['.git', '.100x', 'node_modules'].includes(path.basename(source)) });
  const base = runTests(copy);
  console.log(`no bug planted: ${base.pass} passing, ${base.fail} failing`);
  if (base.status !== 0) {
    console.log('The tests are red before any bug is planted, so a red run proves nothing. Fix them first.');
    process.exit(1);
  }
  const survived = [];
  for (const [name, file, from, to, files, options] of MUTATIONS.filter(chosen)) {
    const target = path.join(copy, file);
    const original = fs.readFileSync(target, 'utf8');
    const hits = original.split(from).length - 1;
    if (hits !== 1) {
      console.log(`CANNOT PLANT  ${name}: ${JSON.stringify(from.slice(0, 60))} occurs ${hits} times in ${file}, it must occur once`);
      survived.push(name);
      continue;
    }
    fs.writeFileSync(target, original.replace(from, () => to));
    const run = runTests(copy, files, options?.browser);
    fs.writeFileSync(target, original);
    if (run.status === 0) {
      console.log(`SURVIVED  ${name}: the tests stayed green`);
      survived.push(name);
    } else console.log(`caught    ${name}: ${run.fail} failing, first "${run.first ?? 'unknown'}"`);
  }
  const total = MUTATIONS.filter(chosen).length;
  console.log(`\n${total - survived.length} of ${total} planted bugs turned the tests red.${survived.length ? ` Not caught: ${survived.join('; ')}.` : ''}`);
  process.exitCode = survived.length ? 1 : 0;
} finally {
  fs.rmSync(copy, { recursive: true, force: true });
}
