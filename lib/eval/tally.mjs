import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../errors.mjs';
import { sameModel } from '../models.mjs';
import { receiptState } from '../receipt.mjs';
import { sign, signingKey } from '../seal.mjs';
import { armFolder, LABELS, leakPatterns, loadConfig, ORDERS, pathWords, paths, readJson, scanForLeaks, SEALED_LENGTH } from './blind.mjs';
import { median, signTest, wilson } from './stats.mjs';
import { are, duration, plural, shellPath } from './words.mjs';

// "Ahead" needs at least 6 decisive pairs and an exact two-sided sign test under 0.05. A clean sweep of 5 gives p = 0.0625, so 5 is never enough.
export const MIN_DECISIVE = 6;
export const ALPHA = 0.05;
const WINNERS = new Set(['A', 'B', 'tie']);
// Words a judge's reason must not hold. The skill, the arm names and the arm folders are the words the leak scan looks for, and
// leakPatterns is the one list of them. These two say the judge went looking for the key or the task files.
const JUDGE_ONLY = [
  { word: 'key.json', pattern: /\bkey\.(?:json|sha256)\b/i },
  { word: 'the tasks folder', pattern: /\btasks\// },
];

// Order o1 shows the first side as A and the second as B. Order o2 shows them the other way round.
const sideFor = (order, winner) => (winner === 'tie' ? 'tie' : (winner === 'A') === (order === 'o1') ? 'first' : 'second');

function readVerdict(dir, id, order) {
  const file = path.join(paths(dir).judge, `${id}-${order}`, 'verdict.json');
  if (!fs.existsSync(file)) return { missing: true };
  try {
    const verdict = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!WINNERS.has(verdict.winner)) return { missing: true, invalid: `winner is ${JSON.stringify(verdict.winner)}, it must be "A", "B" or "tie"` };
    return { winner: verdict.winner, why: String(verdict.why ?? ''), sealed: typeof verdict.sealed === 'string' ? verdict.sealed : null, mtimeMs: fs.statSync(file).mtimeMs };
  } catch (error) {
    return { missing: true, invalid: error.message };
  }
}

// Both orders must name the same side. A pick that follows the place and not the page is a flip, and a flip is a tie.
function decide(item, first, second) {
  const sides = [sideFor('o1', first.winner), sideFor('o2', second.winner)];
  if (sides[0] !== 'tie' && sides[0] === sides[1]) return { outcome: 'win', winner: item[sides[0]], sides };
  if (!sides.includes('tie')) return { outcome: 'flip', sides };
  return { outcome: 'tie', sides };
}

// The labels a pair may put in its first and second place. A real pair holds the two arms, so those come from the key's own arm list.
const CONTROL_LABELS = { planted: ['intact', 'blurred'], identical: ['copy-1', 'copy-2'] };

// The key is read from a file anyone can edit, and its ids become folder names and its labels become the winner, so its shape is checked before it is used.
function parseKey(text) {
  let key;
  try {
    key = JSON.parse(text);
  } catch (error) {
    throw new CliError(`key.json is not valid JSON: ${error.message}`);
  }
  const bad = (why) => new CliError(`key.json is not a key this tool wrote: ${why}. No score is printed.`);
  if (key?.version !== 1) throw bad('its version is not 1');
  if (!Array.isArray(key.arms) || key.arms.length !== 2 || key.arms.some((arm) => typeof arm !== 'string' || arm === '') || key.arms[0] === key.arms[1]) throw bad('arms must be two different names');
  if (!Array.isArray(key.items) || key.items.length === 0) throw bad('items must be a list of pairs');
  const seen = new Set();
  for (const item of key.items) {
    if (typeof item?.id !== 'string' || !/^pair-\d{2,}$/.test(item.id)) throw bad('a pair has no id like pair-01');
    if (seen.has(item.id)) throw bad(`${item.id} is listed twice`);
    seen.add(item.id);
    if (item.kind !== 'real' && !Object.hasOwn(CONTROL_LABELS, item.kind)) throw bad(`${item.id} has kind ${JSON.stringify(item.kind)}, which is not real, planted or identical`);
    if (typeof item.brief !== 'string') throw bad(`${item.id} has no brief`);
    const labels = item.kind === 'real' ? key.arms : CONTROL_LABELS[item.kind];
    if (item.first === item.second || ![item.first, item.second].every((label) => labels.includes(label))) throw bad(`${item.id} must put ${labels.join(' and ')} in its first and second place`);
  }
  return key;
}

function checkKey(dir) {
  const where = paths(dir);
  const text = fs.readFileSync(where.key, 'utf8');
  const [sealed = null, signature = ''] = fs.existsSync(where.seal) ? fs.readFileSync(where.seal, 'utf8').split('\n').map((line) => line.trim().split(/\s+/)[0]) : [];
  const actual = crypto.createHash('sha256').update(text).digest('hex');
  if ((sealed || null) !== actual) throw new CliError(`The key changed after it was sealed. key.sha256 says ${sealed || 'nothing'} and key.json hashes to ${actual}. No score is printed, because the arms behind A and B can no longer be trusted.`);
  // The hash can be remade by anyone who edits the key. The signature cannot, without the 100x key kept in the global folder.
  const secret = signingKey({ create: false });
  const signed = Boolean(secret) && /^[0-9a-f]{64}$/.test(signature) && crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(actual, secret), 'hex'));
  return { key: parseKey(text), hash: actual, signed };
}

// The model id with the settings the receipt recorded, in a fixed order, so two runs compare as equal only when they ran alike.
const configOf = (m) => [m.ran.trim(), ...Object.entries(m.params ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => `${id} ${value}`)].join(', ');

const runMinutes = (runs, config, arm) => config.briefs.map((b) => runs[`${b.id}/${arm}`]?.minutes).filter((m) => typeof m === 'number');

// A page that says what the mockup skill says about itself gives its arm away, and a scan for names does not see it. A key made after the scan learned
// those words has none of them in a judge's pages, so this is said only for a run made before. A pair whose page says them is set aside from the word,
// because a judge who read them was not blind, and the counts of the pairs left are worked here so the caution, the reason and the report say the same.
function setAside(labelled, total, pairs, arms) {
  const briefs = [...new Set(labelled.map((entry) => entry.brief))];
  const rest = pairs.filter((pair) => !briefs.includes(pair.brief));
  const wins = Object.fromEntries(arms.map((arm) => [arm, rest.filter((pair) => pair.winner === arm).length]));
  const decisive = wins[arms[0]] + wins[arms[1]];
  const pagesBy = Object.fromEntries(arms.map((arm) => [arm, labelled.filter((entry) => entry.arm === arm).length]));
  return { briefs, wins, decisive, p: signTest(wins[arms[0]], wins[arms[1]]), pagesBy, total };
}

function labelCaution(aside, arms) {
  const pages = arms.filter((arm) => aside.pagesBy[arm]).map((arm) => `${aside.pagesBy[arm]} of the ${aside.total} pages of ${arm}`).join(' and ');
  const labelledPages = arms.reduce((sum, arm) => sum + aside.pagesBy[arm], 0);
  const [first, second] = arms;
  const left = aside.decisive === 0 ? 'no decisive pair is left' : `${first} wins ${aside.wins[first]} and ${second} wins ${aside.wins[second]} of the ${plural(aside.decisive, 'decisive pair')} left, p = ${aside.p}`;
  return `${pages} ${labelledPages === 1 ? 'says' : 'say'} "unreviewed" or "mockup" on the page, the words a run that follows the mockup skill may write for itself, so a judge could tell which arm made them (${aside.briefs.slice(0, 3).join(', ')}${aside.briefs.length > 3 ? ', ...' : ''}). ${aside.briefs.length === 1 ? 'That pair is' : `Those ${aside.briefs.length} pairs are`} set aside from the word, and ${left}`;
}

export function scoreBakeoff(dir, { minDecisive = MIN_DECISIVE } = {}) {
  const where = paths(dir);
  const config = loadConfig(dir);
  if (!fs.existsSync(where.key)) throw new CliError(`No key yet, so there is nothing to score. \`100x eval bakeoff status ${shellPath(dir)}\` says what to run next.`);
  const { key, hash, signed } = checkKey(dir);
  const runs = fs.existsSync(where.runs) ? readJson(where.runs, 'the run times') : {};
  const leak = fs.existsSync(where.leak) ? readJson(where.leak, 'the leak scan') : null;
  const patternsFor = () => leakPatterns(key.arms, leak?.allowed ?? [], { labels: key.labels === true });
  const taint = [...patternsFor(), ...JUDGE_ONLY];

  const [armA, armB] = key.arms;
  const wins = { [armA]: 0, [armB]: 0 };
  let ties = 0;
  let flips = 0;
  const pairs = [];
  const controls = [];
  const missing = [];
  const tainted = [];
  const counts = { A: 0, B: 0, tie: 0 };
  // A verdict that quotes the key's hash was written after the key was sealed, wherever the folder has been copied since. One that does not can
  // only be placed by its file's time, which a copy loses.
  const quoted = hash.slice(0, SEALED_LENGTH);
  const unquotedTimes = [];
  const foreignQuote = [];
  for (const item of key.items) {
    const verdicts = ORDERS.map((order) => readVerdict(dir, item.id, order));
    verdicts.forEach((verdict, index) => {
      if (verdict.missing) missing.push(`${item.id}-${ORDERS[index]}${verdict.invalid ? ` (${verdict.invalid})` : ''}`);
      else {
        counts[verdict.winner] += 1;
        if (verdict.sealed === quoted) {
          // Written after the key was sealed.
        } else if (verdict.sealed) foreignQuote.push(`${item.id}-${ORDERS[index]}`);
        else unquotedTimes.push(verdict.mtimeMs);
        const named = taint.find(({ pattern }) => pattern.test(verdict.why));
        if (named) tainted.push(`${item.id}-${ORDERS[index]} names ${named.word}`);
      }
    });
    if (verdicts.some((verdict) => verdict.missing)) continue;
    const result = decide(item, ...verdicts);
    if (item.kind === 'real') {
      if (result.outcome === 'win') wins[result.winner] += 1;
      else {
        ties += 1;
        if (result.outcome === 'flip') flips += 1;
      }
      pairs.push({ id: item.id, brief: item.brief, ...result, why: verdicts.map((v) => v.why) });
    } else {
      const pass = item.kind === 'planted' ? result.outcome === 'win' && result.winner === 'intact' : result.outcome !== 'win';
      controls.push({ id: item.id, kind: item.kind, pass, outcome: result.outcome, winner: result.winner ?? null });
    }
  }

  const realItems = key.items.filter((item) => item.kind === 'real');
  const decisive = wins[armA] + wins[armB];
  const leader = wins[armB] > wins[armA] ? armB : armA;
  const other = leader === armA ? armB : armA;
  const p = signTest(wins[armA], wins[armB]);
  const interval = wilson(wins[leader], decisive);
  const total = counts.A + counts.B + counts.tie;
  const biased = total >= 4 ? (counts.A / total >= 0.9 ? 'A' : counts.B / total >= 0.9 ? 'B' : null) : null;

  const withheld = [];
  if (missing.length) withheld.push(`${plural(missing.length, 'verdict')} ${are(missing.length)} missing or unreadable (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''}), and a partial count can hide the pairs that went the other way`);
  if (!leak?.ok) withheld.push('the leak scan did not pass, so the blind was not checked');
  if (tainted.length) withheld.push(`${plural(tainted.length, 'verdict')} ${are(tainted.length)} void because the judge's reason names something it must not know (${tainted.slice(0, 3).join(', ')}${tainted.length > 3 ? ', ...' : ''}). Delete each such verdict.json and judge that folder again with a fresh helper`);
  if (!signed) withheld.push("the sealed key has no signature from this machine's 100x key, so the key could have been remade after the verdicts. The key is signed by the machine that built the pairs, so score there. Anywhere else the counts are a recount, and the word is not printed");
  const armNames = config.briefs.flatMap((b) => key.arms.map((arm) => `${b.id}/${arm}`));
  const armUnrecorded = armNames.filter((name) => !runs[name]?.model?.ran?.trim());
  if (armUnrecorded.length) withheld.push(`the model that ran is not recorded for ${armUnrecorded.length} of ${armNames.length} arm runs (${armUnrecorded.slice(0, 3).join(', ')}${armUnrecorded.length > 3 ? ', ...' : ''}), and "ahead" is a claim about the skill and not about a change of model. Record it with mark <key> stop --receipt <file>, the file 100x helper run --receipt wrote`);
  const judgeNames = key.items.flatMap((item) => ORDERS.map((order) => `${item.id}-${order}`));
  const judgeRecord = (name) => (runs[`judge/${name}`] ? `judge/${name}` : 'judge');
  const judgeRan = (name) => runs[judgeRecord(name)]?.model?.ran?.trim();
  const judgeUnrecorded = judgeNames.filter((name) => !judgeRan(name));
  if (judgeUnrecorded.length) withheld.push(`the model that judged is not recorded for ${judgeUnrecorded.length} of ${judgeNames.length} judge folders (${judgeUnrecorded.slice(0, 3).join(', ')}${judgeUnrecorded.length > 3 ? ', ...' : ''}). Record it with mark judge stop --receipt <file> for one judge, or mark judge/<folder> stop --receipt <file> for each folder`);
  // Reasoning effort and context window change what a model does, so two runs of one model id at different settings are two configurations.
  const judgeModels = [...new Set(judgeNames.map(judgeRecord))].map((name) => runs[name]?.model).filter((m) => m?.ran?.trim());
  const ranByJudges = [...new Set(judgeModels.map((m) => m.ran.trim()))];
  const setByJudges = [...new Set(judgeModels.map(configOf))];
  if (ranByJudges.length > 1) withheld.push(`the judges did not all use one model (${ranByJudges.join(' and ')}), so the pairs are not judged alike`);
  else if (setByJudges.length > 1) withheld.push(`the judges did not all use one setting of ${ranByJudges[0]} (${setByJudges.map((text) => text.replace(`${ranByJudges[0]}, `, '')).join(' and ')}), so the pairs are not judged alike`);
  const armModels = config.briefs.flatMap((b) => key.arms.map((arm) => runs[`${b.id}/${arm}`]?.model)).filter(Boolean);
  const ranByArms = [...new Set(armModels.map((m) => m.ran?.trim()).filter(Boolean))];
  const setByArms = [...new Set(armModels.filter((m) => m.ran?.trim()).map(configOf))];
  if (ranByArms.length > 1) withheld.push(`the arm runs did not all use one model (${ranByArms.join(' and ')}), so the pairs compare more than the skill`);
  else if (setByArms.length > 1) withheld.push(`the arm runs did not all use one setting of ${ranByArms[0]} (${setByArms.map((text) => text.replace(`${ranByArms[0]}, `, '')).join(' and ')}), so the pairs compare more than the skill`);
  // A model name that was typed is the helper's word. A record counts as the SDK's word only when a receipt this machine signed backs it.
  const receiptOf = (name) => receiptState(path.join(where.receipts, `${name.replaceAll('/', '__')}.json`), runs[name]?.model?.receipt);
  const backed = (name) => receiptOf(name) === 'backed';
  const recordNames = [...armNames, ...new Set(judgeNames.map(judgeRecord))].filter((name) => runs[name]?.model?.ran?.trim());
  const unbacked = recordNames.filter((name) => receiptOf(name) === 'typed');
  // A receipt whose signature this machine cannot verify is not a typed name: another machine may have signed it, or it may have been changed. The words say both.
  const foreign = recordNames.filter((name) => receiptOf(name) === 'other-machine');
  if (foreignQuote.length) withheld.push(`${plural(foreignQuote.length, 'verdict')} ${foreignQuote.length === 1 ? 'quotes' : 'quote'} a key hash that is not this key's (${foreignQuote.slice(0, 3).join(', ')}${foreignQuote.length > 3 ? ', ...' : ''}), so the key was remade after the judging`);
  const sealedAt = fs.statSync(where.seal).mtimeMs;
  if (unquotedTimes.length && Math.min(...unquotedTimes) < sealedAt) withheld.push("a verdict that does not quote the sealed key's hash is older than key.sha256. Either the key was sealed after the judging, or this folder is a copy, which loses file times. Score in the folder that did the judging, or judge again with the ask.md that pairs wrote, which asks for the hash");
  const planted = controls.filter((c) => c.kind === 'planted');
  const identical = controls.filter((c) => c.kind === 'identical');
  const judgeTrusted = planted.length > 0 && identical.length > 0 && controls.every((c) => c.pass);
  if (!missing.length && !judgeTrusted) {
    const failed = controls.filter((c) => !c.pass).map((c) => (c.kind === 'planted' ? 'did not pick the intact page over its blurred copy in both orders' : 'picked a winner between two identical pages'));
    withheld.push(`judge not trusted: it ${failed.length ? failed.join(' and ') : 'was not given both controls'}`);
  }

  // A page that carries the label the scan learned to look for after this run was built means its judge was not blind, so the word is worked from the pairs left.
  const labelled = key.labels === true ? [] : realItems.flatMap((item) => key.arms.filter((arm) => {
    const folder = armFolder(dir, key.arms, item.brief, arm);
    return fs.existsSync(folder) && scanForLeaks(folder, LABELS, { product: true }).hits.length > 0;
  }).map((arm) => ({ brief: item.brief, arm })));
  const aside = labelled.length ? setAside(labelled, realItems.length, pairs, key.arms) : null;
  const counted = aside ? { wins: aside.wins, decisive: aside.decisive, p: aside.p } : { wins, decisive, p };
  const leads = counted.decisive >= minDecisive && counted.p < ALPHA && counted.wins[leader] > counted.wins[other];
  const unbackedText = `the model of ${unbacked.length} of ${recordNames.length} records (${unbacked.slice(0, 3).join(', ')}${unbacked.length > 3 ? ', ...' : ''}) is typed by hand and no receipt from 100x helper run --receipt backs it`;
  const foreignText = `the receipts behind ${foreign.length} of ${recordNames.length} records (${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? ', ...' : ''}) carry a signature that this machine's 100x key does not verify (signed on another machine, or changed since it was signed), so this machine cannot check them. They are not typed by hand`;
  if (unbacked.length && leads) withheld.push(`${unbackedText}, so a lead for ${leader} would be a claim about a model nobody checked. Record each run with mark <key> stop --receipt <file>`);
  if (foreign.length && leads) withheld.push(`${foreignText}, so a lead for ${leader} cannot be confirmed here. Score on the machine that signed them`);

  // "Not shown" is the one word for everything that is not a proven lead. A withheld verdict is a not shown with the reason that nothing could be said.
  let verdict;
  if (withheld.length) verdict = { word: 'not shown', withheld: true, reasons: withheld };
  else if (leads) verdict = { word: 'ahead', arm: leader, withheld: false, reasons: [] };
  else {
    const n = counted.decisive;
    const kept = aside ? `${plural(aside.briefs.length, 'pair')} ${are(aside.briefs.length)} set aside for a label on the page, so ` : '';
    const why = n < minDecisive
      ? aside ? `${plural(n, 'decisive pair')} ${are(n)} left and ${minDecisive} ${are(minDecisive)} needed` : `${plural(n, 'decisive pair')}, ${minDecisive} ${are(minDecisive)} needed`
      : `p = ${counted.p} over ${aside ? 'the ' : ''}${plural(n, 'decisive pair')}${aside ? ' left' : ''}, not under ${ALPHA}`;
    verdict = { word: 'not shown', withheld: false, reasons: [`${kept}${why}`] };
  }

  const models = {};
  for (const [name, run] of Object.entries(runs)) if (run.model) models[name] = { ...run.model, backed: backed(name), otherMachine: receiptOf(name) === 'other-machine' };
  // Said in the headline, next to the word, so a result from the wrong model is never read without it.
  const cautions = [];
  if (unbacked.length && !leads) cautions.push(unbackedText);
  if (foreign.length && !leads) cautions.push(foreignText);
  const off = armModels.filter((m) => m.requested && m.ran && !sameModel(m.requested, m.ran));
  if (off.length) cautions.push(`${plural(off.length, 'arm run')} did not run the model that was chosen (${[...new Set(off.map((m) => m.ran))].join(' and ')} ran, ${[...new Set(off.map((m) => m.requested))].join(' and ')} was asked for)`);
  const judgeOff = Object.entries(runs).filter(([name, run]) => (name === 'judge' || name.startsWith('judge/')) && run.model?.requested && run.model.ran && !sameModel(run.model.requested, run.model.ran));
  if (judgeOff.length) cautions.push(`${judgeOff.length === 1 && judgeOff[0][0] === 'judge' ? 'the judge ran' : `${plural(judgeOff.length, 'judge record')} ran`} ${[...new Set(judgeOff.map(([, run]) => run.model.ran))].join(' and ')}, not the ${[...new Set(judgeOff.map(([, run]) => run.model.requested))].join(' and ')} that was asked for`);
  // A judge of the arms' own model can share its taste with an arm, and the two controls show only that it can see.
  const judgeRanModels = [...new Set(Object.entries(runs).filter(([name, run]) => (name === 'judge' || name.startsWith('judge/')) && run.model?.ran).map(([, run]) => run.model.ran.trim()))];
  const shared = judgeRanModels.filter((model) => ranByArms.some((arm) => sameModel(arm, model)));
  if (shared.length) cautions.push(`the judge ran ${shared.join(' and ')}, the same model as the arms, so it may prefer its own taste, and the controls show only that it can see`);
  if (aside) cautions.push(labelCaution(aside, key.arms));
  const edits = (leak?.edits ?? []).filter((text) => typeof text === 'string' && text.trim());
  if (edits.length) cautions.push(`${plural(edits.length, 'change')} ${edits.length === 1 ? 'was' : 'were'} made by hand to the arm pages before the judging, to clear the leak scan (${edits.slice(0, 3).map((text) => text.trim()).join('; ')}${edits.length > 3 ? '; ...' : ''}), so a judged page is not exactly what its arm made`);
  const result = {
    arms: key.arms,
    keyHash: hash,
    realPairs: realItems.length,
    wins,
    ties,
    flips,
    decisive,
    leader,
    p,
    interval,
    pairs,
    controls,
    judgeTrusted,
    missing,
    voided: tainted,
    positionBias: biased ? { side: biased, of: total, times: counts[biased] } : null,
    verdict,
    minutes: Object.fromEntries(key.arms.map((arm) => [arm, { median: median(runMinutes(runs, config, arm)), runs: runMinutes(runs, config, arm) }])),
    tokens: Object.fromEntries(key.arms.map((arm) => [arm, config.briefs.map((b) => runs[`${b.id}/${arm}`]?.tokens).filter((t) => typeof t === 'number')])),
    renderScanned: key.rendered === true,
    models,
    cautions,
    blanks: (key.blank ?? []).map(({ brief, arm }) => `${brief}/${arm}`),
    pathWords: pathWords(where.judge, patternsFor()),
    labelsScanned: key.labels === true,
    setAside: aside,
    ranked: [leader, other],
  };
  result.headline = headline(result);
  return result;
}

export function countsLine(r) {
  const [first, second] = r.ranked;
  const notes = [...(r.flips ? [`${r.flips} flipped with the order`] : []), ...(r.blanks.length ? [`${plural(r.blanks.length, 'run')} left no page`] : [])];
  return `${first} won ${r.wins[first]} of ${plural(r.realPairs, 'pair')}, ${second} won ${r.wins[second]}, ${r.ties} tied${notes.length ? ` (${notes.join(', ')})` : ''}`;
}

// The first thing every reading of a result says, before anything else: the counts, the verdict, and a line for each reason or caution.
// The terminal screen and report.md both start from it, so the two cannot word a verdict differently. `headline` joins the same facts into one sentence for the JSON.
export function standing(r) {
  const verdict = r.verdict.withheld
    ? { text: 'withheld. No verdict can be printed, because:', bullets: r.verdict.reasons }
    : r.verdict.word === 'ahead'
      ? { text: `${r.verdict.arm} is ahead. ${plural(r.decisive, 'decisive pair')}, exact two-sided sign test p = ${r.p}.`, bullets: [] }
      : { text: `not shown. ${r.verdict.reasons[0]}.`, bullets: [] };
  return { counts: `${countsLine(r)}.`, verdict, cautions: r.cautions };
}

export function headline(r) {
  const counts = countsLine(r);
  if (r.verdict.withheld) return `${counts}. Not shown, and no verdict can be printed: ${r.verdict.reasons.join('; ')}.`;
  const caution = r.cautions.length ? ` Caution: ${r.cautions.join('; ')}.` : '';
  if (r.verdict.word === 'ahead') return `${counts}. ${r.verdict.arm} is ahead: ${r.decisive} decisive pairs, exact two-sided sign test p = ${r.p}.${caution}`;
  return `${counts}. Not shown: ${r.verdict.reasons[0]}.${caution}`;
}

const pct = (n) => n.toFixed(3);

// What the judge did with a control, in the words of what it was asked to do. `flip` is a pick by place, which is the right answer for no winner and a wrong one for a blurred page.
export function controlWords(c) {
  const did = c.outcome === 'tie' ? 'no winner' : c.outcome === 'flip' ? 'picked by place, not by page' : c.kind === 'planted' ? `picked the ${c.winner} page in both orders` : 'picked one of two identical pages in both orders';
  return `${c.pass ? 'passed' : 'failed'} (${did})`;
}

export const pairWords = (pair) => (pair.outcome === 'win' ? `${pair.winner} won in both orders` : pair.outcome === 'flip' ? 'flip: each order picked the page in its own A place, counted as a tie' : 'tie');

// Both arms are told the same minutes, and a helper that stops early is not stopped. The medians are printed in the table, and this says when they are far apart.
function effortLimit(r, config) {
  const [a, b] = r.arms.map((arm) => r.minutes[arm].median);
  if (a === null || b === null || Math.abs(a - b) < 1 || Math.max(a, b) < 2 * Math.min(a, b)) return [];
  return [`- The arms did not work equally long. Median time: ${r.arms[0]} ${duration(a)}, ${r.arms[1]} ${duration(b)}, against ${config.minutes} min asked for. The pairs compare what each made in the time it took.`];
}

// Where a model name came from. A receipt is the SDK's own result in a file this machine signed. Anything typed is the helper's word, whatever it says it read.
const sourceWords = (m) => (m.backed ? 'receipt from the SDK result' : m.otherMachine ? 'receipt this machine cannot verify, signed elsewhere or changed since' : `typed by hand${m.source === 'sdk' ? ', said to be the SDK result' : m.source === 'app' ? ', said to be read from the app' : ', not verified'}`);
const modelWithSettings = (m) => `${m.ran ?? 'not recorded'}${m.params && Object.keys(m.params).length ? ` at ${Object.entries(m.params).map(([id, value]) => `${id} ${value}`).join(', ')}` : ''}`;

export function bakeoffReport(r, config) {
  const [first] = r.ranked;
  const now = standing(r);
  const lines = ['# Bake-off report', '', now.counts, '', `**Verdict:** ${now.verdict.text}`, ''];
  if (now.verdict.bullets.length) lines.push(...now.verdict.bullets.map((reason) => `- ${reason}.`), '');
  if (now.cautions.length) lines.push('**Caution:**', '', ...now.cautions.map((caution) => `- ${caution}.`), '');
  lines.push(`The word is "ahead" only with at least ${MIN_DECISIVE} decisive pairs, p under ${ALPHA}, a judge that passed both controls and a key sealed before the judging.`, '');
  if (r.decisive) lines.push(`${r.setAside ? 'Counting every pair, including the ones set aside: of' : 'Of'} ${plural(r.decisive, 'decisive pair')} ${first} won ${r.wins[first]}. Exact two-sided sign test p = ${r.p}. 95% Wilson interval for that share, ${pct(r.interval[0])} to ${pct(r.interval[1])}.${r.setAside ? ' The word is not worked from this count.' : ''}`, '');
  else lines.push('No pair was decisive, so there is no test to run and no interval.', '');
  if (r.positionBias) lines.push(`Position bias. The judge said ${r.positionBias.side} in ${r.positionBias.times} of ${r.positionBias.of} verdicts, so most pairs read as ties. A judge that follows the place and not the page cannot rank two arms.`, '');
  lines.push('## Pairs', '');
  if (r.pairs.length) {
    lines.push('| pair | brief | result |', '|---|---|---|');
    for (const pair of r.pairs) lines.push(`| ${pair.id} | ${pair.brief} | ${pairWords(pair)} |`);
  } else lines.push(`No pair has both its verdicts yet.${r.missing.length ? ` Missing: ${r.missing.slice(0, 3).join(', ')}${r.missing.length > 3 ? `, and ${r.missing.length - 3} more` : ''}.` : ''}`);
  if (r.blanks.length) lines.push('', '## Runs that left no page', '', `${r.blanks.join(', ')}. A run that ends with no index.html failed, and it stays in the count. A blank page stood in for it in the judge folders, in both orders, and the arm's own folder was not touched.`);
  lines.push('', '## Controls, can the judge see?', '');
  if (r.controls.length) {
    lines.push('| control | what it is | result |', '|---|---|---|');
    for (const c of r.controls) lines.push(`| ${c.id} | ${c.kind === 'planted' ? 'a page beside a blurred copy of itself. The intact page must win in both orders' : 'the same page twice. No winner is the right answer'} | ${controlWords(c)} |`);
  } else lines.push('No control has both its verdicts yet.');
  lines.push('', r.judgeTrusted ? 'The judge passed both controls.' : 'The judge did not pass both controls, or one was missing. It is not trusted, and no verdict is printed from its pairs.', '', '## Time and models', '', '| arm | median time | runs | model asked for | model that ran |', '|---|---|---|---|---|');
  for (const arm of r.arms) {
    const asked = [...new Set(config.briefs.map((b) => r.models[`${b.id}/${arm}`]?.requested).filter(Boolean))].join(', ') || 'not recorded';
    const ran = [...new Set(config.briefs.map((b) => r.models[`${b.id}/${arm}`]).filter(Boolean).map((m) => `${modelWithSettings(m)} (${sourceWords(m)})`))].join(', ') || 'not recorded';
    lines.push(`| ${arm} | ${duration(r.minutes[arm].median)} | ${r.minutes[arm].runs.map(duration).join(', ') || '-'} | ${asked} | ${ran} |`);
  }
  const judgeRecords = Object.entries(r.models).filter(([name]) => name === 'judge' || name.startsWith('judge/')).map(([, m]) => m);
  if (judgeRecords.length) {
    const groups = new Map();
    for (const m of judgeRecords) {
      const text = `Asked for ${m.requested ?? 'not recorded'}, ran ${modelWithSettings(m)}, ${sourceWords(m)}`;
      groups.set(text, (groups.get(text) ?? 0) + 1);
    }
    lines.push('', `Judge model. ${[...groups].map(([text, count]) => `${text}${judgeRecords.length > 1 ? ` (${plural(count, 'record')})` : ''}`).join('; ')}.`);
  }
  const mismatched = Object.entries(r.models).filter(([, m]) => m.requested && m.ran && !sameModel(m.requested, m.ran));
  if (mismatched.length) lines.push('', `Model mismatch. ${mismatched.map(([name, m]) => `${name} asked for ${m.requested} and ran ${m.ran}`).join('. ')}. Those runs were not the model that was chosen.`);
  const tokens = r.arms.map((arm) => `${arm} ${r.tokens[arm].length ? `${r.tokens[arm].join(', ')}` : 'not recorded'}`).join('; ');
  lines.push('', `Tokens per run. ${tokens}.`, '', '## Limits', '');
  lines.push(
    `- ${plural(r.realPairs, 'real pair')}. A sign test cannot go under ${ALPHA} with fewer than ${MIN_DECISIVE} decisive pairs, even when one arm wins every one.`,
    '- One trial per brief and arm. A second run of the same arm can land on the other side.',
    ...effortLimit(r, config),
    '- The judge is a model reading pages. A judge of the same family as an arm can share its taste, and the controls show only that it can see.',
    '- The key sits outside the folders the judge is pointed at, with its hash saved first. A judge on the same machine that goes looking for it can find it.',
    `- The leak scan reads what each file holds and what it is called, and searches a binary file for every name, though a compressed picture is not searched for 100x.${r.labelsScanned ? ' It refuses the words "unreviewed" and "mockup" too, which the mockup skill uses for itself.' : ''} ${r.renderScanned ? 'The pages were photographed, and the text each page showed once it ran was scanned too. The page title and an attribute are not in that text, so a name a script puts there would pass, and so would a picture that shows an arm name.' : 'It does not run a page, so a name that a script builds in the browser would pass it, and so would a picture that shows an arm name.'}`,
    ...(r.pathWords.length ? [`- The path to the judge folders holds ${r.pathWords.join(', ')}. A judge sees its own path, so it could tell that a skill was part of this, though not which arm used it.`] : []),
    '',
  );
  lines.push(`Key hash ${r.keyHash}.${config.protocol ? ` Protocol text hash ${config.protocol.slice(0, 16)}, the hash of evals/PROTOCOL.md when this run was made.` : ''}`, '');
  return lines.join('\n');
}
